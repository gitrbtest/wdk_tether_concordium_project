/**
 * Unit — the error contract (offline; each throw happens before any node round-trip).
 * Proves the module fails clearly and predictably on unsupported operations and
 * bad input.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AccountNotCreatedError } from '../../src/WalletAccountConcordium.js';
import { makeManager } from '../helpers.mjs';

test('getFeeRates throws NotImplementedError (Concordium uses energy-based fees)', async () => {
  const m = makeManager();
  await assert.rejects(() => m.getFeeRates(), /NotImplemented|energy/i);
  m.dispose();
});

test('getAccount with a signer name is not supported yet', async () => {
  const m = makeManager();
  await assert.rejects(() => m.getAccount('some-signer'), /not supported/i);
  m.dispose();
});

test('getAccountByPath rejects a malformed path', async () => {
  const m = makeManager();
  await assert.rejects(() => m.getAccountByPath('not/a/path'), /Invalid Concordium path/i);
  m.dispose();
});

test('AccountNotCreatedError carries the address and a clear message', () => {
  const e = new AccountNotCreatedError('3ABC');
  assert.equal(e.name, 'AccountNotCreatedError');
  assert.equal(e.address, '3ABC');
  assert.match(e.message, /does not exist on-chain/i);
});

test('getCis2Metadata rejects a non-CIS-2 (PLT) ref', async () => {
  const m = makeManager();
  const a = await m.getAccount(0);
  await assert.rejects(() => a.getCis2Metadata('USDT'), /NotImplemented|CIS-2/i);
  m.dispose();
});

test('buildSponsorableTransfer rejects a CIS-2 token (sponsored is PLT-only)', async () => {
  const m = makeManager();
  const a = await m.getAccount(0);
  await assert.rejects(
    () => a.buildSponsorableTransfer({ token: 'cis2:1:0:01', recipient: '3X', amount: 1n, sponsorAddress: '3Y' }),
    /NotImplemented|PLT/i
  );
  m.dispose();
});
