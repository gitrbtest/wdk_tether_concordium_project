/**
 * Unit — account recovery (offline; wallet-proxy HTTP is faked via `_fetch`).
 * Proves findAccountByPublicKey's request-building, response-parsing and error
 * contract, plus recoverAccounts' scan/gap loop — without any network call.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeManager } from '../helpers.mjs';

/** A minimal fake fetch Response. */
const jsonRes = (body, status = 200) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
});

/** One row in the wallet-proxy /v0/keyAccounts shape (snake_case, as documented). */
const proxyRow = (address) => ({
  address,
  credential_index: 0,
  is_simple_account: true,
  key_index: 0,
  public_key: { schemeId: 'Ed25519', verifyKey: 'ab'.repeat(32) },
});

const KEY = 'ab'.repeat(32); // 64 hex chars

test('findAccountByPublicKey maps the proxy array into camelCase KeyAccount objects', async () => {
  const m = makeManager();
  let calledUrl;
  m._fetch = async (url) => { calledUrl = url; return jsonRes([proxyRow('3ABC')]); };

  const out = await m.findAccountByPublicKey(KEY);
  assert.equal(calledUrl, `${m._ccd.walletProxy}/v0/keyAccounts/${KEY}`);
  assert.deepEqual(out, [{
    address: '3ABC',
    credentialIndex: 0,
    keyIndex: 0,
    isSimpleAccount: true,
    publicKey: { schemeId: 'Ed25519', verifyKey: 'ab'.repeat(32) },
  }]);
  m.dispose();
});

test('findAccountByPublicKey returns [] for an unknown key (HTTP 404)', async () => {
  const m = makeManager();
  m._fetch = async () => jsonRes(null, 404);
  assert.deepEqual(await m.findAccountByPublicKey(KEY), []);
  m.dispose();
});

test('findAccountByPublicKey adds ?onlySimple=y and accepts a Uint8Array key', async () => {
  const m = makeManager();
  let calledUrl;
  m._fetch = async (url) => { calledUrl = url; return jsonRes([]); };

  const bytes = Uint8Array.from(Buffer.from(KEY, 'hex'));
  await m.findAccountByPublicKey(bytes, { onlySimple: true });
  assert.equal(calledUrl, `${m._ccd.walletProxy}/v0/keyAccounts/${KEY}?onlySimple=y`);
  m.dispose();
});

test('findAccountByPublicKey rejects a malformed public key before any fetch', async () => {
  const m = makeManager();
  let fetched = false;
  m._fetch = async () => { fetched = true; return jsonRes([]); };
  await assert.rejects(() => m.findAccountByPublicKey('not-hex'), /32-byte hex/);
  assert.equal(fetched, false, 'should not hit the network on bad input');
  m.dispose();
});

test('findAccountByPublicKey throws on a non-ok HTTP status', async () => {
  const m = makeManager();
  m._fetch = async () => jsonRes(null, 500);
  await assert.rejects(() => m.findAccountByPublicKey(KEY), /HTTP 500/);
  m.dispose();
});

test('recoverAccounts collects hits and stops after gapLimit consecutive empties', async () => {
  const m = makeManager();
  // First two derived keys "own" an account; everything after is empty.
  let call = 0;
  m._fetch = async () => {
    call += 1;
    return call <= 2 ? jsonRes([proxyRow(`3ADDR${call}`)]) : jsonRes([]);
  };

  const found = await m.recoverAccounts({ gapLimit: 3, maxIndex: 20 });
  assert.equal(found.length, 2, 'should recover exactly the two funded indexes');
  assert.equal(found[0].index, 0);
  assert.equal(found[1].index, 1);
  assert.ok(found[0].path.endsWith('/0') && found[1].path.endsWith('/1'));
  // idx0,1 hit; idx2,3,4 empty => 3 consecutive empties => stop at 5 lookups total.
  assert.equal(call, 5, 'should stop scanning after the gap is reached');
  m.dispose();
});
