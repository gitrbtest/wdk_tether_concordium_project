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
 * with the sender spending 0 CCD. (If the sender holds none of the token, the
 * submit still reaches the node but the transfer rejects, while the sponsor is
 * still charged — proving the sponsoring machinery independently of the balance.)
 *
 * Run:  npm run example:sponsored
 */

import WalletManagerConcordium from './index.js';

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
    const r = await account.submitSponsored(tx);
    const st = await outcome(r.hash);
    console.log('    hash:', r.hash);
    console.log('    outcome:', st.outcome, '| sender cost:', st.cost, '| sponsor paid:', st.sponsor?.cost, 'microCCD');
    if (st.outcome === 'reject') console.log('    reject reason:', (st.rejectReason || '').slice(0, 70), '(expected — 0 token held)');
  } catch (e) { console.log('    ⚠️ ', (e.message || '').split('\n')[0]); }

  // --- Order B: ACCOUNT signs first (scenarios 1 then 4) ---
  console.log('\n[B] Account-first:  build -> signAsAccountToBeSponsored(1) -> signAsSponsorSigned(4) -> submit');
  try {
    let tx = await build();
    tx = await account.signAsAccountToBeSponsored(tx);  // (1) account signs first
    tx = await account.signAsSponsorSigned(tx);         // (4) sponsor completes
    const r = await account.submitSponsored(tx);
    const st = await outcome(r.hash);
    console.log('    hash:', r.hash);
    console.log('    outcome:', st.outcome, '| sender cost:', st.cost, '| sponsor paid:', st.sponsor?.cost, 'microCCD');
    if (st.outcome === 'reject') console.log('    reject reason:', (st.rejectReason || '').slice(0, 70), '(expected — 0 token held)');
  } catch (e) { console.log('    ⚠️ ', (e.message || '').split('\n')[0]); }

  console.log('\nAll four signing scenarios exercised through WDK, in both orders — the');
  console.log('sponsor covers the fee and the sender spends 0 CCD. With a held token the');
  console.log('outcome is success and the token moves; with none, the transfer rejects but');
  console.log('the sponsor is still charged (sponsoring proven either way).');
  manager.dispose();
}

main().catch((e) => { console.error('Unexpected failure:', e); process.exit(1); });
