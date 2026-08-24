const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const pkg = JSON.parse(read('package.json'));
const app = JSON.parse(read('app.json'));
const portfolio = read('PortfolioApp.js');
const decision = read('DecisionOverlay.js');
const market = read('src/market-data.js');
const quoteContract = read('src/quote-contract.js');
const integrity = read('src/instrument-quote-integrity.js');
const accounting = read('src/transaction-accounting.js');

const postinstall = String(pkg.scripts?.postinstall || '');
assert.ok(!postinstall.includes('apply-v'), 'production package must not execute historical apply-v patch chain');

assert.equal(pkg.version, '1.7.3');
assert.equal(app.expo.version, '1.7.3');
assert.equal(app.expo.android.versionCode, 31);
assert.equal(app.expo.android.package, 'gr.investorcontrol.app');
assert.ok(portfolio.includes("const VERSION = '1.7.3';"), 'PortfolioApp must be canonical v1.7.3 source');
assert.ok(decision.includes("const VERSION = '1.7.3';"), 'DecisionOverlay must be canonical v1.7.3 source');

assert.ok(portfolio.includes('function quoteHeadlineLabel(quote)'), 'quote timing UI must be materialized in canonical source');
assert.ok(portfolio.includes('positionCurrencyVerified'), 'position currency integrity must be materialized in canonical source');
assert.ok(portfolio.includes('<OpportunitiesView portfolioPositions={positions} />'), 'portfolio-aware decision bridge must be canonical source');
assert.ok(portfolio.includes("maxWidth: '48%', flexShrink: 1"), 'mobile quote badge regression fix must be canonical source');

assert.ok(!market.includes('EURONEXT_ALWN_URL'), 'canonical market routing must not contain ALWN-only endpoint');
assert.ok(!market.includes("symbol === 'SPCE.US'"), 'canonical market routing must not contain SPCE-only logic');
assert.ok(market.includes("if (route.market === 'US')"), 'US routing must be market-based');
assert.ok(market.includes("if (route.market === 'GR')"), 'GR routing must be market-based');
assert.ok(market.includes('exchangeOpen: exchange.open'), 'quote integrity must receive exchange state');

assert.ok(quoteContract.includes("MOBILE_QUOTE_CONTRACT_VERSION = '2026-08-20.2'"), 'canonical quote contract version missing');
assert.ok(quoteContract.includes('evaluateMobileQuoteIntegrity'), 'quote contract must use the universal integrity engine');
assert.ok(integrity.includes("MOBILE_INSTRUMENT_INTEGRITY_VERSION = '2026-08-22.1'"), 'canonical instrument integrity version missing');
assert.ok(integrity.includes('CLOSED_MARKET_REFERENCE'), 'closed-market valuation policy must be canonical source');

assert.ok(accounting.includes('export function accountingInvariantReport(transaction)'), 'canonical accounting invariant report missing');
assert.ok(accounting.includes('broker/settlement total is authoritative'), 'canonical accounting cash hierarchy missing');
assert.ok(accounting.includes('roundMoney(quantity * candidate) === gross'), 'execution price reconciliation rule missing');

console.log('Canonical mobile source PASS: no production patch chain; accounting, quote, routing, decision and UI invariants are materialized in source.');
