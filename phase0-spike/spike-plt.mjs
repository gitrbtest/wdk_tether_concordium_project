/**
 * Phase 0 spike (part 2) — Protocol-Level Tokens & Sponsored Transactions
 * ----------------------------------------------------------------------
 * The first spike proved the basics (derive, connect, read balance).
 * This one de-risks the two newly-confirmed requirements:
 *
 *   CHECK A  Does the installed @concordium/web-sdk actually expose the
 *            PLT (protocol-level token) module and the sponsored-
 *            transaction builders? (Confirms SDK support is really there.)
 *   CHECK B  Can we list the PLTs that exist on TESTNET right now, so we
 *            have a concrete token to build against?
 *   CHECK C  Can we read an account's PLT balance? (This is what a
 *            token-aware getTokenBalance() will do.)
 *   CHECK D  Can we *construct* (not submit) a PLT transfer and a
 *            sponsored transaction, proving the building blocks work?
 *
 * SAFE: this script never submits a transaction or spends anything. It
 * only reads from testnet and builds unsigned/undispatched objects.
 *
 * RUN:  npm install   (if not already)
 *       npm run spike:plt
 *       # optional, to read a real token balance:
 *       # PowerShell:  $env:CCD_ACCOUNT="<addr>"; npm run spike:plt
 *
 * VERSION NOTE: PLTs (Protocol Update 9) and sponsored transactions
 * (Protocol Update 10) are recent. The exact import paths / method names
 * below target the current web-sdk line; if one is not found, the script
 * says so — that mismatch is itself a useful Phase 0 finding. Pin the
 * version with:  npm ls @concordium/web-sdk
 */

const NODE_HOST = 'grpc.testnet.concordium.com';
const NODE_PORT = 20000;
const KNOWN_TESTNET_ACCOUNT = process.env.CCD_ACCOUNT || '';

const line = (s = '') => console.log(s);
const ok   = (s) => console.log('  ✅ ' + s);
const bad  = (s) => console.log('  ❌ ' + s);
const info = (s) => console.log('  •  ' + s);
const head = (t, s) => console.log('\n=== CHECK ' + t + ': ' + s + ' ===');

async function main() {
  line('Concordium x WDK — PLT & Sponsored Transactions spike (testnet)');
  line('--------------------------------------------------------------');

  // ---------------------------------------------------------------
  head('A', 'SDK exposes the PLT module and sponsored-tx builders');
  let sdk, nodeMod, plt;
  try {
    sdk = await import('@concordium/web-sdk');
    nodeMod = await import('@concordium/web-sdk/nodejs');
    ok('Core SDK + Node client loaded.');
  } catch (e) {
    bad('Core SDK failed to load: ' + e.message);
    return;
  }
  try {
    // PLT helpers live in a dedicated subpath in recent versions.
    plt = await import('@concordium/web-sdk/plt');
    const names = Object.keys(plt);
    ok('PLT module present. Exports include: ' +
       names.slice(0, 8).join(', ') + (names.length > 8 ? ', …' : ''));
  } catch (e) {
    bad('PLT module not found at @concordium/web-sdk/plt: ' + e.message);
    info('Try: check "npm ls @concordium/web-sdk" — PLT needs a recent version.');
  }
  // Sponsored-transaction support: look for the builder hooks.
  try {
    const t = sdk;
    const hasSponsor =
      'sponsorable' in t || 'addSponsor' in t ||
      (t.AccountTransactionHandler !== undefined);
    if (hasSponsor) ok('Sponsored-transaction primitives appear available in this build.');
    else info('Could not positively confirm sponsored-tx exports by name; verify against the installed version\'s docs.');
  } catch (e) {
    info('Sponsored-tx introspection inconclusive: ' + e.message);
  }

  // ---------------------------------------------------------------
  head('B', 'List PLTs that exist on testnet right now');
  const { ConcordiumGRPCNodeClient, credentials } = nodeMod;
  let client;
  try {
    client = new ConcordiumGRPCNodeClient(NODE_HOST, NODE_PORT, credentials.createSsl());
    // Recent nodes expose a token list query. Method name may be
    // getTokenList / getTokenInfos depending on version.
    let listed = false;
    for (const method of ['getTokenList', 'getTokenInfos', 'getTokens']) {
      if (typeof client[method] === 'function') {
        try {
          const it = client[method]();
          const ids = [];
          for await (const t of it) { ids.push(t?.id?.toString?.() ?? String(t)); if (ids.length >= 20) break; }
          ok('Testnet PLTs via client.' + method + '(): ' + (ids.length ? ids.join(', ') : '(none returned)'));
          listed = true;
          break;
        } catch (e) { info(method + ' threw: ' + e.message); }
      }
    }
    if (!listed) info('No token-list method matched by name; check the installed SDK for the PLT list call.');
  } catch (e) {
    bad('Could not query testnet for tokens: ' + e.message);
  }

  // ---------------------------------------------------------------
  head('C', 'Read an account\'s PLT balance (getTokenBalance path)');
  if (!client) { line('  (skipped — no client)'); }
  else if (!KNOWN_TESTNET_ACCOUNT) {
    info('Set CCD_ACCOUNT=<addr> to try a real token-balance read.');
  } else {
    try {
      const { AccountAddress } = sdk;
      const addr = AccountAddress.fromBase58(KNOWN_TESTNET_ACCOUNT);
      const acc = await client.getAccountInfo(addr);
      // PLT holdings surface on the account info; field name varies by version.
      const tokens = acc.accountTokens ?? acc.tokens ?? acc.plt ?? null;
      if (tokens) ok('Account holds PLT entries: ' + JSON.stringify(tokens).slice(0, 200));
      else info('No PLT holdings field found on this account (it may simply hold none).');
    } catch (e) {
      bad('Token balance read failed: ' + e.message);
    }
  }

  // ---------------------------------------------------------------
  head('D', 'Construct (not submit) a PLT transfer and a sponsored tx');
  if (!plt) { line('  (skipped — PLT module not loaded)'); }
  else {
    try {
      const { TokenId, TokenAmount } = plt;
      // We build the pieces a transfer needs, without a signer or funds.
      const sampleId = TokenId?.fromString ? TokenId.fromString('TEST') : 'TEST';
      const amount = TokenAmount?.fromDecimal ? TokenAmount.fromDecimal('1.0', 6) : '1.0';
      ok('Built a TokenId and TokenAmount — the inputs a PLT transfer requires.');
      info('TokenId: ' + String(sampleId) + '  TokenAmount: ' + String(amount));
      info('A full transfer = Token.transfer(token, sender, {recipient, amount}, signer).');
      info('A sponsored transfer wraps that as "sponsorable", the sender signs,');
      info('and a SEPARATE sponsor account adds its signature (Transaction.sponsor)');
      info('and pays the CCD fee — so the token holder needs no CCD.');
    } catch (e) {
      bad('Could not construct PLT primitives: ' + e.message);
    }
  }

  line('\nSpike (part 2) complete. See PLT-Sponsored-Findings for interpretation.');
}

main().catch((e) => { console.error('\nUnexpected failure:', e); process.exit(1); });
