/**
 * Shared fixtures and helpers for the test suite.
 *
 * The test account, seed, tokens and known address are the same ones used by the
 * example scripts and proven on testnet. Nothing secret lives here beyond the
 * well-known all-"abandon" BIP-39 test seed.
 */

import WalletManagerConcordium from '../index.js';

/** Well-known BIP-39 test seed (public; used across the examples). */
export const TEST_SEED =
  'abandon abandon abandon abandon abandon abandon ' +
  'abandon abandon abandon abandon abandon about';

/** Config for the test account created on testnet in Phase 0. */
export const CONFIG = {
  network: 'Testnet',
  endpoint: { host: 'grpc.testnet.concordium.com', port: 20000, secure: true },
  identityProviderIndex: 0,
  identityIndex: 899424164,
};

/** The address account 0 derives to under CONFIG (deterministic). */
export const KNOWN_ADDRESS = '3GEmZc57STNxVqWykUceXAeCVsDzaogq6wNZhDLAV8bRNYzUYd';

/** Tokens the test account holds on testnet. */
export const PLT_TOKEN = process.env.PLT_TOKEN || 'TN';
export const CIS2_TOKEN = process.env.CIS2_TOKEN || 'cis2:12754:0:01';

export const WALLET_PROXY =
  process.env.WALLET_PROXY || 'https://wallet-proxy.testnet.concordium.com';

/** True when write (money-moving) tests should run. */
export const RUN_WRITE = !!process.env.WRITE;

/** Fresh manager for a test. Remember to dispose() it. */
export function makeManager(config = CONFIG) {
  return new WalletManagerConcordium(TEST_SEED, config);
}

/** Query the real on-chain outcome of a submitted transaction (for write tests). */
export async function submissionStatus(hash) {
  try {
    const res = await fetch(`${WALLET_PROXY}/v0/submissionStatus/${hash}`);
    return await res.json();
  } catch {
    return {};
  }
}

/**
 * Build a minimal fake gRPC client for the mocked (offline) unit tier.
 * Only the methods a test needs are provided; anything else throws so an
 * accidental real dependency is caught rather than silently passing.
 *
 * @param {object} behaviour
 * @param {(addr:any)=>any} [behaviour.getAccountInfo] - return value or throw.
 */
export function fakeClient(behaviour = {}) {
  const notWired = (name) => () => {
    throw new Error(`fakeClient.${name} was called but not wired up in this test`);
  };
  return {
    getAccountInfo: behaviour.getAccountInfo ?? notWired('getAccountInfo'),
    getNextAccountNonce: behaviour.getNextAccountNonce ?? notWired('getNextAccountNonce'),
    getBlockChainParameters: behaviour.getBlockChainParameters ?? notWired('getBlockChainParameters'),
  };
}
