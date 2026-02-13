#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, Env, Symbol};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Schema {
    pub schema_uri_hash: BytesN<32>,
    pub creator: Address,
    pub revocable: bool,
    pub expires_allowed: bool,
    pub attester_mode: u32, // 0=permissionless, 1=issuer_only
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Attestation {
    pub schema_id: BytesN<32>,
    pub attester: Address,
    pub subject: Address,
    pub data_hash: BytesN<32>,
    pub timestamp: u64,          // ledger sequence
    pub expiration: Option<u64>, // ledger sequence
    pub revoked: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerifyResult {
    pub exists: bool,
    pub valid: bool,
    pub revoked: bool,
    pub expired: bool,
    pub schema_id: BytesN<32>,
    pub attester: Address,
    pub subject: Address,
    pub data_hash: BytesN<32>,
    pub timestamp: u64,
    pub expiration: Option<u64>,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Schema(BytesN<32>),
    Attestation(BytesN<32>),
    Nonce(Address),
    NextAttId,
}

const MODE_PERMISSIONLESS: u32 = 0;
const MODE_ISSUER_ONLY: u32 = 1;

fn now_ledger(env: &Env) -> u64 {
    env.ledger().sequence().into()
}

#[allow(deprecated)]
fn emit_schema_created(
    env: &Env,
    schema_id: &BytesN<32>,
    creator: &Address,
    schema_uri_hash: &BytesN<32>,
    revocable: bool,
    expires_allowed: bool,
    attester_mode: u32,
) {
    // Kept in legacy format for compatibility with our current off-chain indexer.
    env.events().publish(
        (Symbol::new(env, "SchemaCreated"),),
        (
            schema_id.clone(),
            creator.clone(),
            schema_uri_hash.clone(),
            revocable,
            expires_allowed,
            attester_mode,
            now_ledger(env),
        ),
    );
}

#[allow(deprecated)]
#[allow(clippy::too_many_arguments)]
fn emit_attested(
    env: &Env,
    attestation_id: &BytesN<32>,
    schema_id: &BytesN<32>,
    attester: &Address,
    subject: &Address,
    data_hash: &BytesN<32>,
    timestamp: u64,
    expiration: Option<u64>,
) {
    // Kept in legacy format for compatibility with our current off-chain indexer.
    env.events().publish(
        (Symbol::new(env, "Attested"),),
        (
            attestation_id.clone(),
            schema_id.clone(),
            attester.clone(),
            subject.clone(),
            data_hash.clone(),
            timestamp,
            expiration,
        ),
    );
}

#[allow(deprecated)]
fn emit_revoked(env: &Env, attestation_id: &BytesN<32>, revoker: &Address) {
    // Kept in legacy format for compatibility with our current off-chain indexer.
    env.events().publish(
        (Symbol::new(env, "Revoked"),),
        (attestation_id.clone(), revoker.clone(), now_ledger(env)),
    );
}

fn next_attestation_id(env: &Env) -> BytesN<32> {
    let k = DataKey::NextAttId;
    let mut n: u64 = env.storage().instance().get(&k).unwrap_or(0);
    n = n.saturating_add(1);
    env.storage().instance().set(&k, &n);

    // Stable 32-byte identifier derived from the counter.
    let mut arr = [0u8; 32];
    arr[24..32].copy_from_slice(&n.to_be_bytes());
    BytesN::from_array(env, &arr)
}

fn require_schema_exists(env: &Env, schema_id: &BytesN<32>) -> Schema {
    env.storage()
        .persistent()
        .get(&DataKey::Schema(schema_id.clone()))
        .unwrap_or_else(|| panic!("schema_not_found"))
}

fn require_attestation_exists(env: &Env, attestation_id: &BytesN<32>) -> Attestation {
    env.storage()
        .persistent()
        .get(&DataKey::Attestation(attestation_id.clone()))
        .unwrap_or_else(|| panic!("attestation_not_found"))
}

#[contract]
pub struct EasContract;

#[contractimpl]
impl EasContract {
    // RF.C.01
    pub fn create_schema(
        env: Env,
        creator: Address,
        schema_uri_hash: BytesN<32>,
        revocable: bool,
        expires_allowed: bool,
        attester_mode: u32,
    ) -> BytesN<32> {
        creator.require_auth();

        if attester_mode != MODE_PERMISSIONLESS && attester_mode != MODE_ISSUER_ONLY {
            panic!("invalid_attester_mode");
        }

        // MVP: schema_id == schema_uri_hash
        let schema_id = schema_uri_hash.clone();
        let key = DataKey::Schema(schema_id.clone());
        if env.storage().persistent().has(&key) {
            panic!("schema_already_exists");
        }

        let schema = Schema {
            schema_uri_hash: schema_uri_hash.clone(),
            creator: creator.clone(),
            revocable,
            expires_allowed,
            attester_mode,
        };
        env.storage().persistent().set(&key, &schema);

        // Event: SchemaCreated(schema_id, creator, schema_uri_hash, revocable, expires_allowed, attester_mode, created_ledger)
        emit_schema_created(
            &env,
            &schema_id,
            &schema.creator,
            &schema.schema_uri_hash,
            schema.revocable,
            schema.expires_allowed,
            schema.attester_mode,
        );

        schema_id
    }

    // Anti-replay helper
    pub fn get_nonce(env: Env, attester: Address) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::Nonce(attester))
            .unwrap_or(0)
    }

    // RF.C.02
    pub fn attest(
        env: Env,
        attester: Address,
        schema_id: BytesN<32>,
        subject: Address,
        data_hash: BytesN<32>,
        expiration: Option<u64>,
        nonce: u64,
    ) -> BytesN<32> {
        attester.require_auth();
        let schema = require_schema_exists(&env, &schema_id);

        if expiration.is_some() && !schema.expires_allowed {
            panic!("expiration_not_allowed");
        }

        if schema.attester_mode == MODE_ISSUER_ONLY && attester != schema.creator {
            panic!("issuer_only");
        }

        // Monotonic nonce per attester.
        let nonce_key = DataKey::Nonce(attester.clone());
        let current_nonce: u64 = env.storage().persistent().get(&nonce_key).unwrap_or(0);
        if nonce != current_nonce.saturating_add(1) {
            panic!("bad_nonce");
        }
        env.storage().persistent().set(&nonce_key, &nonce);

        let attestation_id = next_attestation_id(&env);
        let key = DataKey::Attestation(attestation_id.clone());

        let timestamp = now_ledger(&env);
        let attestation = Attestation {
            schema_id: schema_id.clone(),
            attester: attester.clone(),
            subject: subject.clone(),
            data_hash: data_hash.clone(),
            timestamp,
            expiration,
            revoked: false,
        };
        env.storage().persistent().set(&key, &attestation);

        // Event: Attested(attestation_id, schema_id, attester, subject, data_hash, timestamp, expiration)
        emit_attested(
            &env,
            &attestation_id,
            &schema_id,
            &attester,
            &subject,
            &data_hash,
            timestamp,
            attestation.expiration,
        );

        attestation_id
    }

    // RF.C.03
    pub fn revoke_by(env: Env, revoker: Address, attestation_id: BytesN<32>) {
        revoker.require_auth();
        let mut att = require_attestation_exists(&env, &attestation_id);

        if revoker != att.attester {
            panic!("not_attester");
        }

        let schema = require_schema_exists(&env, &att.schema_id);
        if !schema.revocable {
            panic!("not_revocable");
        }

        if att.revoked {
            return;
        }

        att.revoked = true;
        env.storage()
            .persistent()
            .set(&DataKey::Attestation(attestation_id.clone()), &att);

        // Event: Revoked(attestation_id, revoker, timestamp)
        emit_revoked(&env, &attestation_id, &revoker);
    }

    // RF.C.04
    pub fn verify(env: Env, attestation_id: BytesN<32>) -> Option<VerifyResult> {
        let att: Option<Attestation> = env
            .storage()
            .persistent()
            .get(&DataKey::Attestation(attestation_id));

        let att = att?;

        let now = now_ledger(&env);
        let expired = match att.expiration {
            Some(exp) => now >= exp,
            None => false,
        };
        let revoked = att.revoked;
        let valid = !revoked && !expired;

        Some(VerifyResult {
            exists: true,
            valid,
            revoked,
            expired,
            schema_id: att.schema_id,
            attester: att.attester,
            subject: att.subject,
            data_hash: att.data_hash,
            timestamp: att.timestamp,
            expiration: att.expiration,
        })
    }

    pub fn get_schema(env: Env, schema_id: BytesN<32>) -> Schema {
        require_schema_exists(&env, &schema_id)
    }

    pub fn get_attestation(env: Env, attestation_id: BytesN<32>) -> Attestation {
        require_attestation_exists(&env, &attestation_id)
    }

    pub fn version(env: Env) -> Symbol {
        Symbol::new(&env, "v0.1")
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::EnvTestConfig;
    use soroban_sdk::testutils::{Address as _, Ledger as _, LedgerInfo};

    #[test]
    fn schema_attest_verify_revoke() {
        let mut env = Env::default();
        env.set_config(EnvTestConfig {
            capture_snapshot_at_drop: false,
        });
        env.mock_all_auths();
        env.ledger().set(LedgerInfo {
            timestamp: 0,
            protocol_version: 25,
            sequence_number: 1,
            network_id: [0; 32],
            base_reserve: 10,
            min_temp_entry_ttl: 1,
            min_persistent_entry_ttl: 1,
            max_entry_ttl: 100,
        });

        let creator = Address::generate(&env);
        let attester = Address::generate(&env);
        let subject = Address::generate(&env);

        let contract_id = env.register(EasContract, ());
        let client = EasContractClient::new(&env, &contract_id);

        let schema_hash = BytesN::from_array(&env, &[7u8; 32]);
        let schema_id = client.create_schema(&creator, &schema_hash, &true, &false, &0u32);
        assert_eq!(schema_id, schema_hash);

        let data_hash = BytesN::from_array(&env, &[9u8; 32]);
        let att_id = client.attest(&attester, &schema_id, &subject, &data_hash, &None, &1u64);

        let vr = client.verify(&att_id).unwrap();
        assert!(vr.exists);
        assert!(vr.valid);
        assert!(!vr.revoked);
        assert!(!vr.expired);

        client.revoke_by(&attester, &att_id);
        let vr2 = client.verify(&att_id).unwrap();
        assert!(vr2.exists);
        assert!(!vr2.valid);
        assert!(vr2.revoked);
    }

    #[test]
    #[should_panic(expected = "issuer_only")]
    fn issuer_only_enforced() {
        let mut env = Env::default();
        env.set_config(EnvTestConfig {
            capture_snapshot_at_drop: false,
        });
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let attester = Address::generate(&env);
        let subject = Address::generate(&env);

        let contract_id = env.register(EasContract, ());
        let client = EasContractClient::new(&env, &contract_id);

        let schema_hash = BytesN::from_array(&env, &[1u8; 32]);
        let schema_id = client.create_schema(&creator, &schema_hash, &true, &false, &1u32);

        let data_hash = BytesN::from_array(&env, &[2u8; 32]);
        client.attest(&attester, &schema_id, &subject, &data_hash, &None, &1u64);
    }

    #[test]
    #[should_panic(expected = "bad_nonce")]
    fn bad_nonce_rejected() {
        let mut env = Env::default();
        env.set_config(EnvTestConfig {
            capture_snapshot_at_drop: false,
        });
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let attester = Address::generate(&env);
        let subject = Address::generate(&env);

        let contract_id = env.register(EasContract, ());
        let client = EasContractClient::new(&env, &contract_id);

        let schema_hash = BytesN::from_array(&env, &[3u8; 32]);
        let schema_id = client.create_schema(&creator, &schema_hash, &true, &false, &0u32);

        let data_hash = BytesN::from_array(&env, &[4u8; 32]);
        // First nonce must be 1.
        client.attest(&attester, &schema_id, &subject, &data_hash, &None, &2u64);
    }
}

#[cfg(test)]
mod security_tests;
