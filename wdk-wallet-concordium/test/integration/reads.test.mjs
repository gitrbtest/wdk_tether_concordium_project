/**
 * Integration — read operations against the live testnet node.
 * Run with:  npm run test:integration   (needs network; uses the held test tokens)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeManager, KNOWN_ADDRESS, PLT_TOKEN, CIS2_TOKEN } from '../helpers.mjs';

test('getAddress derives the known testnet address', async () => {
  const m = makeManager();
  const a = await m.getAccount(0);
  assert.equal(await a.getAddress(), KNOWN_ADDRESS);
  m.dispose();
});

test('getBalance returns a positive CCD balance', async () => {
  const m = makeManager();
  const a = await m.getAccount(0);
  const bal = await a.getBalance();
  assert.equal(typeof bal, 'bigint');
  assert.ok(bal > 0n, `expected > 0 microCCD, got ${bal}`);
  m.dispose();
});

test('getTokenBalance reads the PLT balance', async () => {
  const m = makeManager();
  const a = await m.getAccount(0);
  const bal = await a.getTokenBalance(PLT_TOKEN);
  assert.ok(bal > 0n, `expected to hold some ${PLT_TOKEN}, got ${bal}`);
  m.dispose();
});

test('getTokenBalance reads the CIS-2 balance (same method, different id)', async () => {
  const m = makeManager();
  const a = await m.getAccount(0);
  const bal = await a.getTokenBalance(CIS2_TOKEN);
  assert.ok(bal > 0n, `expected to hold some ${CIS2_TOKEN}, got ${bal}`);
  m.dispose();
});

test('getCis2Metadata resolves the token name/symbol from its on-chain URL', async () => {
  const m = makeManager();
  const a = await m.getAccount(0);
  const { url, metadata } = await a.getCis2Metadata(CIS2_TOKEN);
  assert.ok(url, 'expected a metadata URL');
  assert.ok(metadata && typeof metadata.symbol === 'string', 'expected a symbol in the metadata JSON');
  m.dispose();
});
