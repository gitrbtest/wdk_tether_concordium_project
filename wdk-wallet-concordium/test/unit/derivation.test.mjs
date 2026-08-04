/**
 * Unit — account derivation (offline; uses local WASM key derivation, no node).
 * Proves the WDK-index -> Concordium-coordinate mapping and that keys are
 * deterministic for a given seed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeManager, CONFIG } from '../helpers.mjs';

test('getAccount maps the WDK index onto the credential counter and path', async () => {
  const m = makeManager();
  const a0 = await m.getAccount(0);
  assert.equal(a0.index, 0);
  assert.equal(a0.path, `0/${CONFIG.identityIndex}/0`);

  const a3 = await m.getAccount(3);
  assert.equal(a3.index, 3);
  assert.equal(a3.path, `0/${CONFIG.identityIndex}/3`);
  m.dispose();
});

test('getAccountByPath parses the three coordinates explicitly', async () => {
  const m = makeManager();
  const a = await m.getAccountByPath('0/0/5');
  assert.equal(a.index, 5);
  assert.equal(a.path, '0/0/5');
  m.dispose();
});

test('key derivation is deterministic for a given seed and index', async () => {
  const m1 = makeManager();
  const m2 = makeManager();
  const pub = async (m, i) =>
    Buffer.from((await m.getAccount(i)).keyPair.publicKey).toString('hex');

  assert.equal(await pub(m1, 0), await pub(m2, 0), 'same seed + index -> same public key');
  assert.notEqual(await pub(m1, 0), await pub(m1, 1), 'different index -> different key');
  m1.dispose();
  m2.dispose();
});
