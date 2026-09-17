/**
 * Phase 5 example — sponsored transactions, all FOUR signing scenarios.
 *
 * A sponsored transaction has two signatures (account + sponsor) and either may
 * sign first. The module exposes all four scenarios, with signing separated
 * from submission:
 *   build -> signAsAccountToBeSponsored (1) / signAsAccountPreSponsored (2)
 *         -> signAsSponsorToBeSigned    (3) / signAsSponsorSigned       (4)
 *         -> submitSponsored
 *
 * For the demo, account 0 plays BOTH the sender and the sponsor, so every method
 * runs against testnet. Order A uses scenarios 3+2; Order B uses 1+4. When the
 * sender holds the token (set PLT_TOKEN to one it holds, e.g. "TN"), both orders
 * finalize with outcome: success — the sponsor pays the fee and the token moves,
 * with the sender spending 0 CCD. (If the sender holds none of the token,
 * submitSponsored THROWS TransactionRejectedError — the transfer finalized in a
 * rejected state — though the sponsor was still charged the fee.)
 *
 * Run:  npm run example:sponsored
 */

import WalletManagerConcordium, { TransactionRejectedError } from './index.js';

const TEST_SEED =
  'abandon abandon abandon abandon abandon abandon ' +
  'abandon abandon abandon abandon abandon about';
const WALLET_PROXY = 'https://wallet-proxy.testnet.concordium.com';
const TOKEN = process.env.PLT_TOKEN || 'USDT';

const config = {
  network: 'Testnet',
  endpoint: { host: 'grpc.testnet.concordium.com', port: 20000, secure: true },
  identityProviderIndex: 0,
  identityIndex: 899424164,
};

async function outcome(hash) {
  try { return await (await fetch(`${WALLET_PROXY}/v0/submissionStatus/${hash}`)).json(); }
  catch { return {}; }
}

// submitSponsored throws TransactionRejectedError when the transfer finalizes
// rejected (e.g. the sender holds none of the token); anything else is unexpected.
function reportSponsoredError(e) {
  if (e instanceof TransactionRejectedError) {
    console.log('    ⚠️  rejected on-chain:', e.rejectReason?.tag ?? '(see node)', '| hash:', e.hash);
    console.log('        (sponsor was still charged the fee; sender spent 0 CCD.)');
  } else {
    console.log('    ⚠️ ', (e.message || '').split('\n')[0]);
  }
}

async function main() {
  const manager = new WalletManagerConcordium(TEST_SEED, config);
  const account = await manager.getAccount(0);   // plays both sender AND sponsor here
  const addr = await account.getAddress();
  console.log('Sender & sponsor account:', addr, '\nToken:', TOKEN);

  // The sender builds the unsigned sponsorable transfer (sponsor = self for the demo).
  const build = () => account.buildSponsorableTransfer({
    token: TOKEN, recipient: addr, amount: 1n, sponsorAddress: addr,
  });

  // --- Order A: SPONSOR signs first (scenarios 3 then 2) ---
  console.log('\n[A] Sponsor-first:  build -> signAsSponsorToBeSigned(3) -> signAsAccountPreSponsored(2) -> submit');
  try {
    let tx = await build();
    tx = await account.signAsSponsorToBeSigned(tx);    // (3) sponsor signs first
    tx = await account.signAsAccountPreSponsored(tx);  // (2) account completes
    const r = await account.submitSponsored(tx);       // throws TransactionRejectedError on reject
    const st = await outcome(r.hash);                  // wallet-proxy: what the sponsor paid
    console.log('    ✅ success. hash:', r.hash, '| sponsor paid:', st.sponsor?.cost ?? '(see node)', 'microCCD (sender spent 0)');
  } catch (e) { reportSponsoredError(e); }

  // --- Order B: ACCOUNT signs first (scenarios 1 then 4) ---
  console.log('\n[B] Account-first:  build -> signAsAccountToBeSponsored(1) -> signAsSponsorSigned(4) -> submit');
  try {
    let tx = await build();
    tx = await account.signAsAccountToBeSponsored(tx);  // (1) account signs first
    tx = await account.signAsSponsorSigned(tx);         // (4) sponsor completes
    const r = await account.submitSponsored(tx);        // throws TransactionRejectedError on reject
    const st = await outcome(r.hash);                   // wallet-proxy: what the sponsor paid
    console.log('    ✅ success. hash:', r.hash, '| sponsor paid:', st.sponsor?.cost ?? '(see node)', 'microCCD (sender spent 0)');
  } catch (e) { reportSponsoredError(e); }

  console.log('\nAll four signing scenarios exercised through WDK, in both orders — the');
  console.log('sponsor covers the fee and the sender spends 0 CCD. With a held token the');
  console.log('submit succeeds and the token moves; with none, submitSponsored throws');
  console.log('TransactionRejectedError (the sponsor is still charged).');
  manager.dispose();
}

main().catch((e) => { console.error('Unexpected failure:', e); process.exit(1); });
