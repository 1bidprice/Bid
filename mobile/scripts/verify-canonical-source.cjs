const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const pkg = JSON.parse(read('package.json'));
const app = JSON.parse(read('app.json'));
const portfolio = read('PortfolioApp.js');
const portfolioEngine = read('src/portfolio-engine.js');
const decision = read('DecisionOverlay.js');
const finalDecision = read('src/FinalDecisionCard.js');
const opportunities = read('src/OpportunitiesView.js');
const decisionValidity = read('src/decision-validity.js');
const market = read('src/market-data.js');
const marketRules = read('src/market-rules.js');
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
assert.ok(portfolio.includes('<OpportunitiesView portfolioPositions={positions} />'), 'portfolio-aware decision bridge must be canonical source');
assert.ok(portfolio.includes("maxWidth: '48%', flexShrink: 1"), 'mobile quote badge regression fix must be canonical source');

assert.ok(portfolio.includes("import { buildPortfolioSnapshot } from './src/portfolio-engine';"), 'PortfolioApp must consume canonical portfolio engine');
assert.ok(portfolio.includes('const portfolioSnapshot = useMemo('), 'canonical portfolio snapshot wiring missing');
assert.ok(!portfolio.includes('function positionsFrom(state) {'), 'UI must not own portfolio accounting logic');
assert.ok(!portfolio.includes("openFinnhubTrades(token.trim(), ['SPCE']"), 'UI must not hardcode SPCE live subscription');
assert.ok(portfolio.includes('openFinnhubTrades(token.trim(), liveUsProviderSymbols'), 'generic US live subscription missing');
assert.ok(portfolio.includes("const liveUsProviderSymbolsKey = liveUsProviderSymbols.join('|');"), 'stable live symbol dependency key missing');
assert.ok(!portfolio.includes("current.prices['SPCE.US']"), 'UI must not hardcode SPCE quote state');
assert.ok(portfolio.includes("  transactionOrderPrice,\n  transactionTotal,\n} from './src/transaction-accounting';"), 'Transactions tab must import transactionTotal before rendering');
assert.ok(portfolio.includes('const total = transactionTotal(transaction);'), 'Transactions tab canonical total render missing');

assert.ok(portfolioEngine.includes('export function buildOpenPositionLedger('), 'canonical position ledger missing');
assert.ok(portfolioEngine.includes('export function buildPortfolioPositions('), 'canonical position valuation engine missing');
assert.ok(portfolioEngine.includes('export function buildPortfolioSummary('), 'canonical portfolio summary engine missing');
assert.ok(portfolioEngine.includes("blockers.push('POSITION_CURRENCY_MISMATCH')"), 'portfolio currency fail-closed rule missing');
assert.ok(portfolioEngine.includes("blockers.push('FX_RATE_MISSING')"), 'USD FX fail-closed rule missing');
assert.ok(portfolioEngine.includes("quote.quoteContract?.valuationEligible !== true"), 'portfolio quote eligibility gate missing');
assert.ok(portfolioEngine.includes('nativePrice / fxRate'), 'EUR valuation must derive from native quote plus FX');

assert.ok(decisionValidity.includes("DECISION_VALIDITY_VERSION = '2026-09-05.1'"), 'decision validity version missing');
assert.ok(decisionValidity.includes("reason = 'FEED_NOT_FRESH'"), 'stale research feed must fail closed');
assert.ok(decisionValidity.includes("reason = 'SYSTEM_NOT_READY'"), 'degraded decision system must fail closed');
assert.ok(decisionValidity.includes("reason = 'VALID_UNTIL_NOT_VERIFIED'"), 'missing decision validity must fail closed');
assert.ok(decisionValidity.includes("reason = 'DECISION_EXPIRED'"), 'expired final action must fail closed');
assert.ok(finalDecision.includes("import { finalActionValidity } from './decision-validity';"), 'FinalDecisionCard must use canonical decision validity');
assert.ok(finalDecision.includes('if (!decisionValidity.eligible) return null;'), 'FinalDecisionCard must suppress inactive final actions');
assert.ok(finalDecision.includes("decisionValidity.reason === 'DECISION_EXPIRED'"), 'expired decision UX missing');
assert.ok(opportunities.includes("import { finalActionIsCurrent } from './decision-validity';"), 'Research counters must use canonical decision validity');
assert.ok(opportunities.includes('if (!finalActionIsCurrent(finalAction, decisionContext)) continue;'), 'stale/expired BUY/SELL count gate missing');
assert.ok(opportunities.includes("operationalHealth?.decisionEngineStatus === 'READY'"), 'decision engine readiness must gate active actions');
assert.ok(opportunities.includes('items={decisionContext.feedFresh && decisionContext.systemReady ? (feed.confirmedBuyOpportunities || []) : []}'), 'stale confirmed BUY opportunities must be hidden');
assert.ok(!opportunities.includes('decisionContext={decisionContext} decisionContext={decisionContext}'), 'decisionContext prop materialization must remain idempotent');

assert.ok(marketRules.includes("MARKET_RULES_VERSION = '2026-08-24.1'"), 'canonical market rules version missing');
assert.ok(marketRules.includes("suffix: '.GR'"), 'Euronext Athens route missing');
assert.ok(marketRules.includes("currency: 'EUR'"), 'Euronext Athens EUR rule missing');
assert.ok(marketRules.includes("timeZone: 'Europe/Athens'"), 'Euronext Athens timezone rule missing');
assert.ok(marketRules.includes('regularStart: 10 * 60 + 15'), 'Euronext Athens 10:15 open missing');
assert.ok(marketRules.includes('regularEnd: 17 * 60 + 20'), 'Euronext Athens 17:20 close missing');
assert.ok(marketRules.includes('ATHENS_MARKET_HOLIDAYS'), 'Euronext Athens calendar registry missing');
assert.ok(marketRules.includes("'2026-10-28'"), 'Euronext Athens 2026 holiday coverage missing');
assert.ok(marketRules.includes("'2026-12-24'"), 'Euronext Athens Christmas Eve closure missing');
assert.ok(marketRules.includes("'calendar-unverified'"), 'unknown Athens calendar years must fail closed');

assert.ok(!market.includes('EURONEXT_ALWN_URL'), 'canonical market routing must not contain ALWN-only endpoint');
assert.ok(!market.includes("symbol === 'SPCE.US'"), 'canonical market routing must not contain SPCE-only logic');
assert.ok(market.includes("if (route.market === 'US')"), 'US routing must be market-based');
assert.ok(market.includes("if (route.market === 'GR')"), 'GR routing must be market-based');
assert.ok(market.includes("import { marketStateForSymbol } from './market-rules';"), 'market-data must consume canonical market rules');
assert.ok(market.includes("marketStateForSymbol(symbol, at).session"), 'market session must come from canonical market rules');
assert.ok(market.includes('exchangeCalendarVerified: exchange.calendarVerified !== false'), 'quote integrity must receive Athens calendar verification');
assert.ok(market.includes('EURONEXT_ATHENS_STOCK_URL'), 'generic official Euronext Athens quote adapter missing');
assert.ok(market.includes('official Euronext Athens stock page identity not verified'), 'official Athens page identity guard missing');
assert.ok(!market.includes('17 * 60 + 25'), 'obsolete Athens 17:25 close remains');
assert.ok(market.includes('appSymbol, price: Number(latest.p), timestamp, quote: classifiedQuote'), 'market-data must publish classified generic live quote payload');
assert.ok(market.includes("      const exchange = exchangeState(symbol);\n      const quote = quoteFromRegistry(symbol, registry[symbol], {\n        now: Date.now(),\n        exchangeOpen: exchange.open,\n        exchangeSession: exchange.session,\n        exchangeCalendarVerified: exchange.calendarVerified !== false,\n      });"), 'canonical feed quotes must be reclassified with current exchange state');

assert.ok(quoteContract.includes("MOBILE_QUOTE_CONTRACT_VERSION = '2026-08-20.2'"), 'canonical quote contract version missing');
assert.ok(quoteContract.includes('evaluateMobileQuoteIntegrity'), 'quote contract must use the universal integrity engine');
assert.ok(integrity.includes("MOBILE_INSTRUMENT_INTEGRITY_VERSION = '2026-08-24.1'"), 'canonical instrument integrity version missing');
assert.ok(integrity.includes("import { MARKET_RULES } from './market-rules';"), 'instrument integrity must use canonical market rules');
assert.ok(integrity.includes('EXCHANGE_CALENDAR_NOT_VERIFIED'), 'Athens calendar integrity blocker missing');
assert.ok(integrity.includes('CALENDAR_NOT_VERIFIED'), 'Athens calendar public fail-closed state missing');
assert.ok(integrity.includes('CLOSED_MARKET_REFERENCE'), 'closed-market valuation policy must be canonical source');

assert.ok(accounting.includes('export function accountingInvariantReport(transaction)'), 'canonical accounting invariant report missing');
assert.ok(accounting.includes('broker/settlement total is authoritative'), 'canonical accounting cash hierarchy missing');
assert.ok(accounting.includes('roundMoney(quantity * candidate) === gross'), 'execution price reconciliation rule missing');

console.log('Canonical mobile source PASS: patch chain retired; accounting, portfolio, Euronext Athens/US market rules, quote, decision validity and UI responsibilities are separated and guarded, including Transactions runtime, closed-market valuation, stale/expired actions and idempotent decision-context materialization.');
