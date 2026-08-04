/**
 * Unit — configuration defaults and merging (pure object logic, no network).
 * Proves that partial config layers over the defaults, including the nested
 * endpoint deep-merge (only the field you set is overridden).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import WalletManagerConcordium from '../../index.js';
import { TEST_SEED } from '../helpers.mjs';

test('defaults apply when no config is given', () => {
  const m = new WalletManagerConcordium(TEST_SEED);
  assert.equal(m._ccd.network, 'Testnet');
  assert.equal(m._ccd.endpoint.host, 'grpc.testnet.concordium.com');
  assert.equal(m._ccd.endpoint.port, 20000);
  assert.equal(m._ccd.endpoint.secure, true);
  m.dispose();
});

test('a partial endpoint override keeps the other endpoint defaults (deep merge)', () => {
  const m = new WalletManagerConcordium(TEST_SEED, { endpoint: { host: 'my-node.example' } });
  assert.equal(m._ccd.endpoint.host, 'my-node.example'); // overridden
  assert.equal(m._ccd.endpoint.port, 20000);             // kept from defaults
  assert.equal(m._ccd.endpoint.secure, true);            // kept from defaults
  m.dispose();
});

test('a top-level config field overrides its default', () => {
  const m = new WalletManagerConcordium(TEST_SEED, { network: 'Mainnet' });
  assert.equal(m._ccd.network, 'Mainnet');
  m.dispose();
});
