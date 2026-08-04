/**
 * Integration — account recovery against the live testnet wallet-proxy
 * (read-only; no broadcast, nothing spent). Proves the seed can rediscover the
 * known test account purely from its derived public key.
 * Run with:  npm run test:integration
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeManager, KNOWN_ADDRESS } from '../helpers.mjs';

test('findAccountByPublicKey rediscovers the known account from account 0\'s public key', async () => {
  const m = makeManager();
  const a = await m.getAccount(0);
  const pubHex = Buffer.from(a.keyPair.publicKey).toString('hex');

  const accounts = await m.findAccountByPublicKey(pubHex);
  const addresses = accounts.map((x) => x.address);
  assert.ok(
    addresses.includes(KNOWN_ADDRESS),
    `expected ${KNOWN_ADDRESS} among ${JSON.stringify(addresses)}`
  );
  m.dispose();
});

test('recoverAccounts finds the known account by scanning from the seed', async () => {
  const m = makeManager();
  const found = await m.recoverAccounts({ gapLimit: 3, maxIndex: 10 });
  const addresses = found.map((x) => x.address);
  assert.ok(
    addresses.includes(KNOWN_ADDRESS),
    `expected ${KNOWN_ADDRESS} among recovered ${JSON.stringify(addresses)}`
  );
  m.dispose();
});
