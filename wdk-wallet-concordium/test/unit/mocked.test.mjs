/**
 * Unit (mocked) — node-calling methods with an injected FAKE client (offline).
 * This is the Mockito-style tier: it proves getBalanceForAddress's parsing and
 * error-mapping logic without spending a real testnet call. Happy paths are also
 * proven for real by the integration tier.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import WalletManagerConcordium from '../../index.js';
import { AccountNotCreatedError } from '../../src/WalletAccountConcordium.js';
import { TEST_SEED, CONFIG, KNOWN_ADDRESS, fakeClient } from '../helpers.mjs';

/** A real account (offline-derived) with its client dependency replaced by a fake. */
async function accountWithFakeClient(client) {
  const manager = new WalletManagerConcordium(TEST_SEED, CONFIG);
  const account = await manager.getAccount(0);
  account._getClient = async () => client;   // inject the fake (dependency was constructor-provided)
  return { account, dispose: () => manager.dispose() };
}

test('getBalanceForAddress returns the microCCD balance reported by the node', async () => {
  const client = fakeClient({
    getAccountInfo: async () => ({ accountAmount: { microCcdAmount: 123456789n } }),
  });
  const { account, dispose } = await accountWithFakeClient(client);
  assert.equal(await account.getBalanceForAddress(KNOWN_ADDRESS), 123456789n);
  dispose();
});

test('getBalanceForAddress maps a "not found" node error to AccountNotCreatedError', async () => {
  const client = fakeClient({
    getAccountInfo: async () => { throw new Error('account not found'); },
  });
  const { account, dispose } = await accountWithFakeClient(client);
  await assert.rejects(() => account.getBalanceForAddress(KNOWN_ADDRESS), AccountNotCreatedError);
  dispose();
});

test('getBalanceForAddress rethrows a non-"not found" error unchanged', async () => {
  const client = fakeClient({
    getAccountInfo: async () => { throw new Error('connection refused'); },
  });
  const { account, dispose } = await accountWithFakeClient(client);
  await assert.rejects(() => account.getBalanceForAddress(KNOWN_ADDRESS), /connection refused/);
  dispose();
});
