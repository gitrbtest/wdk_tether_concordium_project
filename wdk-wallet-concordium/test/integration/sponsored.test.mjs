/**
 * Integration — sponsored transactions.
 * Construction (build + all four sign methods) always runs; the actual on-chain
 * submission is a WRITE test, gated behind WRITE=1 (it spends a sponsor fee).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeManager, KNOWN_ADDRESS, PLT_TOKEN, RUN_WRITE, submissionStatus } from '../helpers.mjs';
import { TransactionRejectedError } from '../../index.js';

const sponsorable = (a) => a.buildSponsorableTransfer({
  token: PLT_TOKEN, recipient: KNOWN_ADDRESS, amount: 1n, sponsorAddress: KNOWN_ADDRESS,
});

test('build + all four sign methods produce signable JSON, in both orders', async () => {
  const m = makeManager();
  const a = await m.getAccount(0);

  // Order A: sponsor first (3 -> 2)
  let txA = await sponsorable(a);
  txA = await a.signAsSponsorToBeSigned(txA);   // (3)
  txA = await a.signAsAccountPreSponsored(txA);  // (2)
  assert.ok(txA && typeof txA === 'object', 'order A produced a fully-signed signable');

  // Order B: account first (1 -> 4)
  let txB = await sponsorable(a);
  txB = await a.signAsAccountToBeSponsored(txB);  // (1)
  txB = await a.signAsSponsorSigned(txB);         // (4)
  assert.ok(txB && typeof txB === 'object', 'order B produced a fully-signed signable');

  m.dispose();
});

test('sponsored submission finalizes with outcome: success (WRITE=1)', { skip: !RUN_WRITE }, async () => {
  const m = makeManager();
  const a = await m.getAccount(0);
  let tx = await sponsorable(a);
  tx = await a.signAsSponsorToBeSigned(tx);
  tx = await a.signAsAccountPreSponsored(tx);
  const { hash } = await a.submitSponsored(tx);
  const status = await submissionStatus(hash);
  assert.equal(status.outcome, 'success', `expected success, got ${status.outcome} (${status.rejectReason || ''})`);
  m.dispose();
});

test('submitSponsored throws TransactionRejectedError for an unheld token (WRITE=1)', { skip: !RUN_WRITE }, async () => {
  const m = makeManager();
  const a = await m.getAccount(0);
  // USDT exists on testnet but this account holds none, so the transfer finalizes
  // in a rejected state — submitSponsored must surface that as a throw, not a
  // normal { hash, fee } result (Concordium review comments 4/5).
  let tx = await a.buildSponsorableTransfer({ token: 'USDT', recipient: KNOWN_ADDRESS, amount: 1n, sponsorAddress: KNOWN_ADDRESS });
  tx = await a.signAsSponsorToBeSigned(tx);
  tx = await a.signAsAccountPreSponsored(tx);
  await assert.rejects(() => a.submitSponsored(tx), TransactionRejectedError);
  m.dispose();
});
