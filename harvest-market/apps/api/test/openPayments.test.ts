import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getOpenPaymentsConfig, normalizeWalletAddress, validateOpenPaymentsConfig } from '../src/openPayments.js';

test('normalizes Open Payments pointers to HTTPS wallet addresses',()=>{
 assert.equal(normalizeWalletAddress('$ilp.interledger-test.dev/inversor'),'https://ilp.interledger-test.dev/inversor');
 assert.equal(normalizeWalletAddress('https://ilp.interledger-test.dev/platform'),'https://ilp.interledger-test.dev/platform');
});

test('rejects non-HTTPS wallet endpoints outside local development',()=>{
 assert.throws(()=>normalizeWalletAddress('http://wallet.example/alice'),/must use HTTPS/);
});

test('loads wallet configuration without requiring secrets in test or simulation mode',()=>{
 const config=getOpenPaymentsConfig({
  OPEN_PAYMENTS_ENVIRONMENT:'sandbox',
  OPEN_PAYMENTS_INVESTOR_WALLET_ADDRESS:'$ilp.interledger-test.dev/inversor',
  OPEN_PAYMENTS_PLATFORM_WALLET_ADDRESS:'https://ilp.interledger-test.dev/platform',
  OPEN_PAYMENTS_GROWER_WALLET_ADDRESS:'https://ilp.interledger-test.dev/grower'
 });
 assert.equal(config.wallets.investor,'https://ilp.interledger-test.dev/inversor');
 assert.equal(config.wallets.platform,'https://ilp.interledger-test.dev/platform');
 assert.equal(config.wallets.grower,'https://ilp.interledger-test.dev/grower');
 assert.equal(config.wallets.buyer,undefined);
});

test('requires client identity, key, callback, and payment wallet pointers before sandbox validation',()=>{
 assert.throws(()=>validateOpenPaymentsConfig(getOpenPaymentsConfig({OPEN_PAYMENTS_ENVIRONMENT:'sandbox'})),/OPEN_PAYMENTS_CLIENT_WALLET_ADDRESS/);
});
