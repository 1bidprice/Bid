const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const portfolioPath = path.join(root, 'PortfolioApp.js');
const marketPath = path.join(root, 'src', 'market-data.js');
const integrityVerifierPath = path.join(root, 'scripts', 'verify-v173-universal-instrument-integrity.js');

function requiredReplace(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`portfolio consolidation failed: missing ${label}`);
  return source.replace(from, to);
}

function removeBetween(source, startMarker, endMarker, label) {
  if (!source.includes(startMarker)) return source;
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`portfolio consolidation failed: missing end marker for ${label}`);
  return `${source.slice(0, start)}${source.slice(end + 2)}`;
}

function patchMarketData() {
  let source = fs.readFileSync(marketPath, 'utf8');
  source = requiredReplace(
    source,
    '      inMemoryQuotes[appSymbol] = classifyQuote(appSymbol, {',
    '      const classifiedQuote = classifyQuote(appSymbol, {',
    'classified websocket quote assignment',
  );
  source = requiredReplace(
    source,
    "      });\n      onTrade({ symbol: providerSymbol, price: Number(latest.p), timestamp });",
    "      });\n      inMemoryQuotes[appSymbol] = classifiedQuote;\n      onTrade({ symbol: providerSymbol, appSymbol, price: Number(latest.p), timestamp, quote: classifiedQuote });",
    'generic websocket callback payload',
  );
  fs.writeFileSync(marketPath, source);
}

function patchPortfolioApp() {
  let source = fs.readFileSync(portfolioPath, 'utf8');

  source = requiredReplace(
    source,
    "import OpportunitiesView from './src/OpportunitiesView';",
    "import OpportunitiesView from './src/OpportunitiesView';\nimport { buildPortfolioSnapshot } from './src/portfolio-engine';",
    'portfolio engine import',
  );

  source = removeBetween(
    source,
    'function positionsFrom(state) {',
    '\n\nfunction Field(',
    'legacy UI portfolio engine',
  );

  const oldStart = "  useEffect(() => {\n    if (loading || token.trim().length < 20) return undefined;\n    return openFinnhubTrades(token.trim(), ['SPCE'], async (trade) => {";
  if (source.includes(oldStart)) {
    const start = source.indexOf(oldStart);
    const summaryEndMarker = "  const valuationCoverage = positions.length ? `${valuedPositions.length}/${positions.length}` : '0/0';";
    const endStart = source.indexOf(summaryEndMarker, start);
    if (endStart < 0) throw new Error('portfolio consolidation failed: missing legacy portfolio summary end');
    const end = endStart + summaryEndMarker.length;
    const replacement = `  const portfolioSnapshot = useMemo(\n    () => buildPortfolioSnapshot(state.transactions, state.prices),\n    [state.transactions, state.prices],\n  );\n  const positions = portfolioSnapshot.positions;\n  const {\n    valuesReady,\n    costsReady,\n    totalValue,\n    totalCost,\n    totalPnl,\n    valuationCoverage,\n    missingValuationSymbols,\n  } = portfolioSnapshot.summary;\n\n  const liveUsProviderSymbols = useMemo(\n    () => [...new Set(positions\n      .filter((position) => position.instrumentRoute?.market === 'US' && position.instrumentRoute?.baseSymbol)\n      .map((position) => position.instrumentRoute.baseSymbol))],\n    [positions],\n  );\n\n  useEffect(() => {\n    if (loading || token.trim().length < 20 || !liveUsProviderSymbols.length) return undefined;\n    return openFinnhubTrades(token.trim(), liveUsProviderSymbols, async (trade) => {\n      if (!trade?.appSymbol || !trade?.quote) return;\n      const current = stateRef.current;\n      await applyQuotes(\n        current,\n        { [trade.appSymbol]: trade.quote },\n        new Date().toISOString(),\n        current.meta.errors || [],\n        { silent: true },\n      );\n    });\n  }, [applyQuotes, liveUsProviderSymbols, loading, token]);`;
    source = `${source.slice(0, start)}${replacement}${source.slice(end)}`;
  }

  source = source.replace("import { routeMobileInstrument } from './src/instrument-quote-integrity';\n", '');
  source = source.replace("import { buildMobileQuoteContract } from './src/quote-contract';\n", '');
  source = source.replace("const { buildPositionLots } = require('./src/position-lots');\n", '');
  source = source.replace('  transactionTotal,\n', '');

  fs.writeFileSync(portfolioPath, source);
}

function patchIntegrityVerifier() {
  let source = fs.readFileSync(integrityVerifierPath, 'utf8');
  source = requiredReplace(
    source,
    "const portfolio = read('PortfolioApp.js');",
    "const portfolio = read('PortfolioApp.js');\nconst portfolioEngine = read('src/portfolio-engine.js');",
    'portfolio-engine verifier input',
  );
  source = requiredReplace(
    source,
    "assert.ok(portfolio.includes('positionCurrencyVerified'));\nassert.ok(portfolio.includes('route.expectedCurrency === position.currency'));",
    "assert.ok(portfolio.includes(\"import { buildPortfolioSnapshot } from './src/portfolio-engine';\"));\nassert.ok(!portfolio.includes('function positionsFrom(state) {'));\nassert.ok(portfolioEngine.includes('positionCurrencyVerified'));\nassert.ok(portfolioEngine.includes('route.expectedCurrency !== position.currency'));",
    'portfolio integrity assertions',
  );
  fs.writeFileSync(integrityVerifierPath, source);
}

patchMarketData();
patchPortfolioApp();
patchIntegrityVerifier();

const portfolio = fs.readFileSync(portfolioPath, 'utf8');
const market = fs.readFileSync(marketPath, 'utf8');
const verifier = fs.readFileSync(integrityVerifierPath, 'utf8');

if (!portfolio.includes("import { buildPortfolioSnapshot } from './src/portfolio-engine';")) throw new Error('portfolio engine import missing');
if (portfolio.includes('function positionsFrom(state) {')) throw new Error('legacy positionsFrom still present');
if (portfolio.includes("openFinnhubTrades(token.trim(), ['SPCE']")) throw new Error('hardcoded SPCE websocket subscription still present');
if (!portfolio.includes('openFinnhubTrades(token.trim(), liveUsProviderSymbols')) throw new Error('generic US websocket subscription missing');
if (!portfolio.includes('const portfolioSnapshot = useMemo(')) throw new Error('canonical portfolio snapshot not wired');
if (!market.includes('onTrade({ symbol: providerSymbol, appSymbol, price: Number(latest.p), timestamp, quote: classifiedQuote });')) throw new Error('classified websocket quote callback missing');
if (!verifier.includes("portfolioEngine.includes('positionCurrencyVerified')")) throw new Error('integrity verifier not migrated to canonical portfolio engine');

console.log('Portfolio consolidation PASS: UI accounting removed, generic US live subscription wired, market-data owns quote classification, verifier follows canonical engine.');
