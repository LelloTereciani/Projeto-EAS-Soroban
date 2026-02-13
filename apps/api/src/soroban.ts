import crypto from 'node:crypto';
import {
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  scValToNative
} from '@stellar/stellar-sdk';
import { Api, Server } from '@stellar/stellar-sdk/rpc';
import type { Env } from './env.js';

export type SchemaFlags = {
  revocable: boolean;
  expiresAllowed: boolean;
  attesterMode: number; // 0=permissionless, 1=issuer_only
};

export function sha256Hex(input: string) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function sha256Bytes32(input: string) {
  return crypto.createHash('sha256').update(input).digest();
}

function asContractId(env: Env) {
  return env.SOROBAN_CONTRACT_ID;
}

function asNetworkPassphrase(env: Env) {
  return env.SOROBAN_NETWORK_PASSPHRASE === 'TESTNET'
    ? Networks.TESTNET
    : env.SOROBAN_NETWORK_PASSPHRASE === 'PUBLIC'
      ? Networks.PUBLIC
      : env.SOROBAN_NETWORK_PASSPHRASE;
}

async function sendAndPoll(rpc: Server, tx: any) {
  const send = await rpc.sendTransaction(tx);
  if (send.status !== 'PENDING') {
    throw new Error(`sendTransaction status=${send.status} error=${send.errorResult ? send.errorResult.toXDR('base64') : ''}`);
  }
  const res = await rpc.pollTransaction(send.hash, { attempts: 60, sleepStrategy: () => 1000 });
  if (res.status !== 'SUCCESS') {
    throw new Error(`tx failed status=${res.status}`);
  }
  return res;
}

export class EasSoroban {
  readonly rpc: Server;
  readonly contractId: string;
  readonly networkPassphrase: string;

  constructor(env: Env) {
    this.rpc = new Server(env.SOROBAN_RPC_URL);
    this.contractId = asContractId(env);
    this.networkPassphrase = asNetworkPassphrase(env);
  }

  async fundAddress(address: string) {
    return this.rpc.fundAddress(address);
  }

  private async simulate(sourcePublicKey: string, method: string, args: any[]) {
    const account = await this.rpc.getAccount(sourcePublicKey);
    const contract = new Contract(this.contractId);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const sim = await this.rpc.simulateTransaction(tx);
    if (Api.isSimulationError(sim)) throw new Error(`simulate error: ${sim.error}`);
    if (!sim.result) return null;
    return scValToNative(sim.result.retval);
  }

  async getNonce(sourcePublicKey: string, attesterPublicKey: string) {
    const v = await this.simulate(sourcePublicKey, 'get_nonce', [nativeToScVal(attesterPublicKey, { type: 'address' })]);
    return BigInt(v);
  }

  async createSchema(creatorSecret: string, schemaUri: string, flags: SchemaFlags) {
    const kp = Keypair.fromSecret(creatorSecret);
    const account = await this.rpc.getAccount(kp.publicKey());
    const contract = new Contract(this.contractId);

    const schemaUriHash = sha256Bytes32(schemaUri);
    const op = contract.call(
      'create_schema',
      nativeToScVal(kp.publicKey(), { type: 'address' }),
      nativeToScVal(schemaUriHash),
      nativeToScVal(flags.revocable, { type: 'bool' }),
      nativeToScVal(flags.expiresAllowed, { type: 'bool' }),
      nativeToScVal(flags.attesterMode, { type: 'u32' })
    );

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase
    })
      .addOperation(op)
      .setTimeout(30)
      .build();

    const prepared = await this.rpc.prepareTransaction(tx);
    prepared.sign(kp);
    const res = await sendAndPoll(this.rpc, prepared);

    if (!res.returnValue) throw new Error('missing returnValue');
    const schemaId = scValToNative(res.returnValue).toString('hex');
    return { schemaId, schemaUriHash: schemaUriHash.toString('hex') };
  }

  async attest(attesterSecret: string, input: {
    schemaIdHex: string;
    subject: string;
    dataHashHex: string;
    expirationLedger: number | null;
    nonce: bigint;
  }) {
    const kp = Keypair.fromSecret(attesterSecret);
    const account = await this.rpc.getAccount(kp.publicKey());
    const contract = new Contract(this.contractId);

    const schemaId = Buffer.from(input.schemaIdHex, 'hex');
    const dataHash = Buffer.from(input.dataHashHex, 'hex');

    const op = contract.call(
      'attest',
      nativeToScVal(kp.publicKey(), { type: 'address' }),
      nativeToScVal(schemaId),
      nativeToScVal(input.subject, { type: 'address' }),
      nativeToScVal(dataHash),
      input.expirationLedger === null
        ? nativeToScVal(null)
        : nativeToScVal(BigInt(input.expirationLedger), { type: 'u64' }),
      nativeToScVal(input.nonce, { type: 'u64' })
    );

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase
    })
      .addOperation(op)
      .setTimeout(30)
      .build();

    const prepared = await this.rpc.prepareTransaction(tx);
    prepared.sign(kp);
    const res = await sendAndPoll(this.rpc, prepared);

    if (!res.returnValue) throw new Error('missing returnValue');
    const attestationId = scValToNative(res.returnValue).toString('hex');
    return { attestationId };
  }

  async revoke(attesterSecret: string, attestationIdHex: string) {
    const kp = Keypair.fromSecret(attesterSecret);
    const account = await this.rpc.getAccount(kp.publicKey());
    const contract = new Contract(this.contractId);

    const attId = Buffer.from(attestationIdHex, 'hex');

    const op = contract.call('revoke_by', nativeToScVal(kp.publicKey(), { type: 'address' }), nativeToScVal(attId));

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase
    })
      .addOperation(op)
      .setTimeout(30)
      .build();

    const prepared = await this.rpc.prepareTransaction(tx);
    prepared.sign(kp);
    await sendAndPoll(this.rpc, prepared);
  }

  async verify(sourcePublicKey: string, attestationIdHex: string) {
    return this.simulate(sourcePublicKey, 'verify', [nativeToScVal(Buffer.from(attestationIdHex, 'hex'))]);
  }
}
