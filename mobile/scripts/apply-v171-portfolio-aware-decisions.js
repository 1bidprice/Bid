const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const VERSION = '1.7.1';
const VERSION_CODE = 29;

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function write(relativePath, content) {
  fs.writeFileSync(path.join(root, relativePath), content);
}

function replaceRequired(content, from, to, label) {
  if (content.includes(to)) return content;
  if (!content.includes(from)) throw new Error(`Investor Control v1.7.1 patch failed: missing ${label}`);
  return content.replace(from, to);
}

function patchFinalDecisionCard() {
  let source = read('src/FinalDecisionCard.js');

  if (!source.includes('function canonicalPositionSymbol(')) {
    source = replaceRequired(
      source,
      "function actionLabel(code, finalAction) {",
      `function canonicalPositionSymbol(value) {\n  return String(value || '').trim().toUpperCase().replace(/\\.(US|GR)$/, '');\n}\n\nfunction actionLabel(code, finalAction) {`,
      'canonical position symbol helper',
    );
  }

  source = replaceRequired(
    source,
    "setHasPosition(snapshot.positions.some((position) => position.symbol === item?.symbol && Number(position.quantity) > 0));",
    "setHasPosition(snapshot.positions.some((position) => canonicalPositionSymbol(position.symbol) === canonicalPositionSymbol(item?.symbol) && Number(position.quantity) > 0));",
    'canonical holder matching',
  );

  write('src/FinalDecisionCard.js', source);
}

function patchPortfolioBridge() {
  let source = read('PortfolioApp.js');
  source = replaceRequired(
    source,
    '<OpportunitiesView />',
    '<OpportunitiesView portfolioPositions={positions} />',
    'portfolio positions bridge',
  );
  source = source.replace("const VERSION = '1.7.0';", `const VERSION = '${VERSION}';`);
  write('PortfolioApp.js', source);

  let decision = read('DecisionOverlay.js');
  decision = decision.replace("const VERSION = '1.7.0';", `const VERSION = '${VERSION}';`);
  write('DecisionOverlay.js', decision);
}

function patchOpportunities() {
  let source = read('src/OpportunitiesView.js');

  if (!source.includes('function canonicalDecisionSymbol(')) {
    source = replaceRequired(
      source,
      'function when(value) {',
      `function canonicalDecisionSymbol(value) {\n  return String(value || '').trim().toUpperCase().replace(/\\.(US|GR)$/, '');\n}\n\nfunction inferredReferenceCurrency(referencePrice, item) {\n  const explicit = String(referencePrice?.currency || item?.marketQuote?.currency || '').trim().toUpperCase();\n  if (/^[A-Z]{3}$/.test(explicit)) return explicit;\n  const symbol = String(item?.marketQuote?.appSymbol || item?.symbol || '').trim().toUpperCase();\n  const exchange = String(item?.exchange || '').trim().toUpperCase();\n  if (symbol.endsWith('.US') || /NASDAQ|NYSE|NEW YORK STOCK EXCHANGE/.test(exchange)) return 'USD';\n  if (symbol.endsWith('.GR') || /EURONEXT ATHENS|ATHENS/.test(exchange)) return 'EUR';\n  return null;\n}\n\nfunction personalizedDecisionCounts(feed, portfolioPositions) {\n  const held = new Set((Array.isArray(portfolioPositions) ? portfolioPositions : [])\n    .filter((position) => Number(position?.quantity || 0) > 0)\n    .map((position) => canonicalDecisionSymbol(position?.symbol))\n    .filter(Boolean));\n  const decisions = Array.isArray(feed?.decisions) ? feed.decisions : [];\n  let buyNowCount = 0;\n  let sellNowCount = 0;\n  for (const item of decisions) {\n    const finalAction = item?.finalAction;\n    if (!finalAction || finalAction.status !== 'FINAL') continue;\n    const hasPosition = held.has(canonicalDecisionSymbol(item?.symbol));\n    const action = hasPosition ? finalAction.holderAction : finalAction.nonHolderAction;\n    if (action === 'BUY_NOW') buyNowCount += 1;\n    if (action === 'SELL_NOW') sellNowCount += 1;\n  }\n  return {\n    ...(feed?.summary || {}),\n    buyNowCount,\n    sellNowCount,\n    finalActionCount: decisions.length || Number(feed?.summary?.finalActionCount || 0),\n  };\n}\n\nfunction when(value) {`,
      'personalized decision helpers',
    );
  }

  source = replaceRequired(
    source,
    'function money(referencePrice) {\n  const value = Number(referencePrice?.value);',
    'function money(referencePrice, item) {\n  const value = Number(referencePrice?.value);',
    'currency-aware money signature',
  );

  source = replaceRequired(
    source,
    "  try {\n    return new Intl.NumberFormat('el-GR', {\n      style: 'currency',\n      currency: referencePrice.currency || 'EUR',",
    "  const currency = inferredReferenceCurrency(referencePrice, item);\n  if (!currency) return `${value.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} · νόμισμα μη διαθέσιμο`;\n  try {\n    return new Intl.NumberFormat('el-GR', {\n      style: 'currency',\n      currency:",
    'no false EUR fallback',
  );

  source = replaceRequired(
    source,
    "    return `${value.toLocaleString('el-GR')} ${referencePrice.currency || ''}`.trim();",
    "    return `${value.toLocaleString('el-GR')} ${currency}`.trim();",
    'currency fallback rendering',
  );

  source = source.split('{money(item.referencePrice)}').join('{money(item.referencePrice, item)}');

  source = replaceRequired(
    source,
    'export default function OpportunitiesView() {',
    'export default function OpportunitiesView({ portfolioPositions = [] }) {',
    'portfolio-aware opportunities signature',
  );

  source = replaceRequired(
    source,
    '  const freshness = useMemo(() => intelligenceFeedFreshness(feed), [feed]);',
    '  const freshness = useMemo(() => intelligenceFeedFreshness(feed), [feed]);\n  const personalizedCounts = useMemo(() => personalizedDecisionCounts(feed, portfolioPositions), [feed, portfolioPositions]);',
    'personalized counters memo',
  );

  source = source.split('{counts.buyNowCount || 0}').join('{personalizedCounts.buyNowCount || 0}');
  source = source.split('{counts.sellNowCount || 0}').join('{personalizedCounts.sellNowCount || 0}');

  write('src/OpportunitiesView.js', source);
}

function patchVersions() {
  const appPath = path.join(root, 'app.json');
  const app = JSON.parse(fs.readFileSync(appPath, 'utf8'));
  app.expo = app.expo || {};
  app.expo.android = app.expo.android || {};
  app.expo.ios = app.expo.ios || {};
  app.expo.version = VERSION;
  app.expo.android.versionCode = VERSION_CODE;
  app.expo.ios.buildNumber = String(VERSION_CODE);
  fs.writeFileSync(appPath, `${JSON.stringify(app, null, 2)}\n`);

  const packagePath = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  pkg.version = VERSION;
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

patchFinalDecisionCard();
patchPortfolioBridge();
patchOpportunities();
patchVersions();

console.log(`Investor Control mobile ${VERSION} build ${VERSION_CODE}: portfolio-aware decisions and safe currency rendering applied.`);
