extern crate std;

use super::*;
use proptest::prelude::*;
use soroban_sdk::testutils::EnvTestConfig;
use soroban_sdk::testutils::{Address as _, Ledger as _, LedgerInfo};

fn setup_env(sequence_number: u32) -> Env {
    let mut env = Env::default();
    // Proptest runs tests many times; snapshots are useful for golden tests but
    // extremely noisy here.
    env.set_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
    });
    env.mock_all_auths();
    env.ledger().set(LedgerInfo {
        timestamp: 0,
        protocol_version: 25,
        sequence_number,
        network_id: [0; 32],
        base_reserve: 10,
        min_temp_entry_ttl: 1,
        min_persistent_entry_ttl: 1,
        max_entry_ttl: 100,
    });
    env
}

fn bytes32_from_u8(env: &Env, b: u8) -> BytesN<32> {
    BytesN::from_array(env, &[b; 32])
}

fn assert_panics_with_msg<F: FnOnce() -> R, R>(f: F, msg: &str) {
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f));
    assert!(r.is_err(), "expected panic");
    let err = r.err().unwrap();
    let s = if let Some(s) = err.downcast_ref::<&str>() {
        std::string::String::from(*s)
    } else if let Some(s) = err.downcast_ref::<std::string::String>() {
        s.clone()
    } else {
        std::string::String::new()
    };
    assert!(
        s.contains(msg),
        "panic did not contain expected message. expected={msg:?} got={s:?}"
    );
}

fn assert_panics<F: FnOnce() -> R, R>(f: F) {
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f));
    assert!(r.is_err(), "expected panic");
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 64, .. ProptestConfig::default() })]

    #[test]
    fn prop_nonce_monotonic(n in 1u8..=20u8) {
        let env = setup_env(1);
        let creator = Address::generate(&env);
        let attester = Address::generate(&env);
        let subject = Address::generate(&env);

        let contract_id = env.register(EasContract, ());
        let client = EasContractClient::new(&env, &contract_id);

        let schema_hash = bytes32_from_u8(&env, 7);
        let schema_id = client.create_schema(&creator, &schema_hash, &true, &false, &MODE_PERMISSIONLESS);

        for i in 1..=n {
            let data_hash = bytes32_from_u8(&env, i);
            client.attest(&attester, &schema_id, &subject, &data_hash, &None, &(i as u64));
        }

        let last = client.get_nonce(&attester);
        prop_assert_eq!(last, n as u64);
    }

    #[test]
    fn prop_nonce_independent(n1 in 1u8..=10u8, n2 in 1u8..=10u8) {
        let env = setup_env(1);
        let creator = Address::generate(&env);
        let attester1 = Address::generate(&env);
        let attester2 = Address::generate(&env);
        let subject = Address::generate(&env);

        let contract_id = env.register(EasContract, ());
        let client = EasContractClient::new(&env, &contract_id);

        let schema_hash = bytes32_from_u8(&env, 9);
        let schema_id = client.create_schema(&creator, &schema_hash, &true, &false, &MODE_PERMISSIONLESS);

        for i in 1..=n1 {
            let data_hash = bytes32_from_u8(&env, i);
            client.attest(&attester1, &schema_id, &subject, &data_hash, &None, &(i as u64));
        }
        for i in 1..=n2 {
            let data_hash = bytes32_from_u8(&env, (100u8).wrapping_add(i));
            client.attest(&attester2, &schema_id, &subject, &data_hash, &None, &(i as u64));
        }

        prop_assert_eq!(client.get_nonce(&attester1), n1 as u64);
        prop_assert_eq!(client.get_nonce(&attester2), n2 as u64);
    }

    #[test]
    fn prop_bad_nonce_does_not_advance(pre in 0u8..=10u8) {
        let env = setup_env(1);
        let creator = Address::generate(&env);
        let attester = Address::generate(&env);
        let subject = Address::generate(&env);

        let contract_id = env.register(EasContract, ());
        let client = EasContractClient::new(&env, &contract_id);

        let schema_hash = bytes32_from_u8(&env, 11);
        let schema_id = client.create_schema(&creator, &schema_hash, &true, &false, &MODE_PERMISSIONLESS);

        for i in 1..=pre {
            let data_hash = bytes32_from_u8(&env, i);
            client.attest(&attester, &schema_id, &subject, &data_hash, &None, &(i as u64));
        }

        let before = client.get_nonce(&attester);
        let bad = before + 2;
        assert_panics_with_msg(|| {
            let data_hash = bytes32_from_u8(&env, 200);
            client.attest(&attester, &schema_id, &subject, &data_hash, &None, &bad);
        }, "bad_nonce");
        let after = client.get_nonce(&attester);
        prop_assert_eq!(after, before);
    }

    #[test]
    fn prop_issuer_only_enforced(delta in 0u8..=5u8) {
        let env = setup_env(1);
        let creator = Address::generate(&env);
        let other = Address::generate(&env);
        let subject = Address::generate(&env);

        let contract_id = env.register(EasContract, ());
        let client = EasContractClient::new(&env, &contract_id);

        let schema_hash = bytes32_from_u8(&env, 21);
        let schema_id = client.create_schema(&creator, &schema_hash, &true, &false, &MODE_ISSUER_ONLY);

        assert_panics_with_msg(|| {
            let data_hash = bytes32_from_u8(&env, 22);
            client.attest(&other, &schema_id, &subject, &data_hash, &None, &1u64);
        }, "issuer_only");

        // Creator can attest.
        let data_hash = bytes32_from_u8(&env, 23);
        let _ = client.attest(&creator, &schema_id, &subject, &data_hash, &None, &1u64);

        // Some noise (delta doesn't matter, just ensures multiple cases).
        prop_assert!(delta <= 5);
    }

    #[test]
    fn prop_expiration_boundary(delta in 0u8..=5u8) {
        let env = setup_env(10);
        let creator = Address::generate(&env);
        let attester = Address::generate(&env);
        let subject = Address::generate(&env);

        let contract_id = env.register(EasContract, ());
        let client = EasContractClient::new(&env, &contract_id);

        let schema_hash = bytes32_from_u8(&env, 31);
        let schema_id = client.create_schema(&creator, &schema_hash, &true, &true, &MODE_PERMISSIONLESS);

        let now = env.ledger().sequence();
        let exp = (now as u64) + (delta as u64);
        let data_hash = bytes32_from_u8(&env, 32);
        let att_id = client.attest(&attester, &schema_id, &subject, &data_hash, &Some(exp), &1u64);

        let vr_now = client.verify(&att_id).unwrap();
        if delta == 0 {
            prop_assert!(vr_now.expired);
            prop_assert!(!vr_now.valid);
        } else {
            prop_assert!(!vr_now.expired);
            prop_assert!(vr_now.valid);
        }

        // At now == exp, we consider it expired (>=).
        env.ledger().set(LedgerInfo {
            timestamp: 0,
            protocol_version: 25,
            sequence_number: exp as u32,
            network_id: [0; 32],
            base_reserve: 10,
            min_temp_entry_ttl: 1,
            min_persistent_entry_ttl: 1,
            max_entry_ttl: 100,
        });
        let vr_exp = client.verify(&att_id).unwrap();
        prop_assert!(vr_exp.expired);
        prop_assert!(!vr_exp.valid);
    }

    #[test]
    fn prop_expiration_not_allowed_panics(exp in 0u64..=100u64) {
        let env = setup_env(1);
        let creator = Address::generate(&env);
        let attester = Address::generate(&env);
        let subject = Address::generate(&env);

        let contract_id = env.register(EasContract, ());
        let client = EasContractClient::new(&env, &contract_id);

        let schema_hash = bytes32_from_u8(&env, 41);
        let schema_id = client.create_schema(&creator, &schema_hash, &true, &false, &MODE_PERMISSIONLESS);

        assert_panics_with_msg(|| {
            let data_hash = bytes32_from_u8(&env, 42);
            client.attest(&attester, &schema_id, &subject, &data_hash, &Some(exp), &1u64);
        }, "expiration_not_allowed");
    }
}

#[test]
fn revoke_rules_and_idempotency() {
    let env = setup_env(1);
    let creator = Address::generate(&env);
    let attester = Address::generate(&env);
    let other = Address::generate(&env);
    let subject = Address::generate(&env);

    let contract_id = env.register(EasContract, ());
    let client = EasContractClient::new(&env, &contract_id);

    // Not revocable schema: revoke must panic.
    let schema_hash_nr = bytes32_from_u8(&env, 51);
    let schema_id_nr = client.create_schema(
        &creator,
        &schema_hash_nr,
        &false,
        &false,
        &MODE_PERMISSIONLESS,
    );
    let att_id_nr = client.attest(
        &attester,
        &schema_id_nr,
        &subject,
        &bytes32_from_u8(&env, 52),
        &None,
        &1u64,
    );
    assert_panics(|| client.revoke_by(&attester, &att_id_nr));
    let vr_nr = client.verify(&att_id_nr).unwrap();
    assert!(!vr_nr.revoked);
    assert!(vr_nr.valid);

    // Revocable schema: only attester can revoke, and revocation is idempotent.
    let schema_hash = bytes32_from_u8(&env, 61);
    let schema_id =
        client.create_schema(&creator, &schema_hash, &true, &false, &MODE_PERMISSIONLESS);
    let att_id = client.attest(
        &attester,
        &schema_id,
        &subject,
        &bytes32_from_u8(&env, 62),
        &None,
        &2u64,
    );

    assert_panics(|| client.revoke_by(&other, &att_id));
    client.revoke_by(&attester, &att_id);
    client.revoke_by(&attester, &att_id);

    let vr = client.verify(&att_id).unwrap();
    assert!(vr.revoked);
    assert!(!vr.valid);
}

#[test]
fn verify_unknown_is_none() {
    let env = setup_env(1);
    let contract_id = env.register(EasContract, ());
    let client = EasContractClient::new(&env, &contract_id);
    let unknown = bytes32_from_u8(&env, 99);
    assert!(client.verify(&unknown).is_none());
}

proptest! {
    // "Fuzz-like" randomized scenario. Keeps it small so it stays fast and stable.
    #![proptest_config(ProptestConfig { cases: 32, .. ProptestConfig::default() })]
    #[test]
    fn fuzz_like_random_sequence(ops in proptest::collection::vec(any::<u8>(), 1..80)) {
        let env = setup_env(100);
        let creator = Address::generate(&env);
        let attesters = [
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
        ];
        let subject = Address::generate(&env);

        let contract_id = env.register(EasContract, ());
        let client = EasContractClient::new(&env, &contract_id);

        let schema_hash = bytes32_from_u8(&env, 70);
        let schema_id = client.create_schema(&creator, &schema_hash, &true, &true, &MODE_PERMISSIONLESS);

        #[derive(Clone, Debug)]
        struct ModelAtt {
            attester_idx: usize,
            expiration: Option<u64>,
            revoked: bool,
        }

        let mut ids: std::vec::Vec<BytesN<32>> = std::vec::Vec::new();
        let mut model: std::vec::Vec<ModelAtt> = std::vec::Vec::new();

        for (step, b) in ops.into_iter().enumerate() {
            // Move ledger forward a bit to exercise expiry logic.
            let seq = 100u32 + (step as u32);
            env.ledger().set(LedgerInfo {
                timestamp: 0,
                protocol_version: 25,
                sequence_number: seq,
                network_id: [0; 32],
                base_reserve: 10,
                min_temp_entry_ttl: 1,
                min_persistent_entry_ttl: 1,
                max_entry_ttl: 100,
            });
            let now = seq as u64;

            let op = b % 3;
            let which = ((b >> 2) % 3) as usize;
            let attester = &attesters[which];

            match op {
                // attest
                0 => {
                    let want_bad_nonce = (b & 0x80) != 0;
                    let current_nonce = client.get_nonce(attester);
                    let nonce = if want_bad_nonce { current_nonce + 2 } else { current_nonce + 1 };

                    let expiration = if (b & 0x20) != 0 {
                        Some(now + ((b as u64) % 6))
                    } else {
                        None
                    };

                    let before = client.get_nonce(attester);
                    if want_bad_nonce {
                        assert_panics_with_msg(|| {
                            let _ = client.attest(attester, &schema_id, &subject, &bytes32_from_u8(&env, b), &expiration, &nonce);
                        }, "bad_nonce");
                        let after = client.get_nonce(attester);
                        prop_assert_eq!(after, before);
                    } else {
                        let id = client.attest(attester, &schema_id, &subject, &bytes32_from_u8(&env, b), &expiration, &nonce);
                        ids.push(id);
                        model.push(ModelAtt { attester_idx: which, expiration, revoked: false });
                    }
                }
                // revoke
                1 => {
                    if ids.is_empty() {
                        continue;
                    }
                    let idx = (b as usize) % ids.len();
                    let id = &ids[idx];
                    let entry = &mut model[idx];

                    let use_wrong_revoker = (b & 0x10) != 0;
                    let revoker_idx = if use_wrong_revoker { (entry.attester_idx + 1) % 3 } else { entry.attester_idx };
                    let revoker = &attesters[revoker_idx];

                    if use_wrong_revoker {
                        assert_panics_with_msg(|| client.revoke_by(revoker, id), "not_attester");
                    } else {
                        client.revoke_by(revoker, id);
                        entry.revoked = true;
                    }
                }
                // verify
                _ => {
                    if ids.is_empty() {
                        continue;
                    }
                    let idx = (b as usize) % ids.len();
                    let id = &ids[idx];
                    let expected = &model[idx];

                    let vr = client.verify(id).unwrap();
                    let expired = match expected.expiration {
                        Some(exp) => now >= exp,
                        None => false,
                    };
                    let valid = !expected.revoked && !expired;

                    prop_assert_eq!(vr.expired, expired);
                    prop_assert_eq!(vr.revoked, expected.revoked);
                    prop_assert_eq!(vr.valid, valid);
                }
            }
        }

        // IDs should be unique in the happy-path sequence we generated.
        let mut seen: std::collections::BTreeSet<std::vec::Vec<u8>> = std::collections::BTreeSet::new();
        for id in ids {
            seen.insert(id.to_array().to_vec());
        }
        prop_assert_eq!(seen.len(), model.len());
    }
}
