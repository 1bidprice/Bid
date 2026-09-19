const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const files = [
  'src/transaction-accounting.js',
  'src/portfolio-engine.js',
  'src/position-lots.js',
];

const unsafe = 'const finite = (value) => Number.isFinite(Number(value));';
const safe = "const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));";

for (const relativePath of files) {
  const fullPath = path.join(root, relativePath);
  let source = fs.readFileSync(fullPath, 'utf8');
  if (source.includes(unsafe)) source = source.replace(unsafe, safe);
  if (!source.includes(safe)) throw new Error(`numeric hardening failed for ${relativePath}`);
  fs.writeFileSync(fullPath, source);
}

// Live-device QA: the Transactions tab referenced transactionTotal without
// importing it. Metro can build that source, but opening the tab throws a
// runtime ReferenceError. Materialize the missing canonical import and keep
// the verifier responsible for preventing the regression from returning.
{
  const fullPath = path.join(root, 'PortfolioApp.js');
  let source = fs.readFileSync(fullPath, 'utf8');
  const oldImport = "  transactionGross,\n  transactionOrderPrice,\n} from './src/transaction-accounting';";
  const newImport = "  transactionGross,\n  transactionOrderPrice,\n  transactionTotal,\n} from './src/transaction-accounting';";
  if (source.includes(oldImport)) source = source.replace(oldImport, newImport);
  if (!source.includes(newImport)) throw new Error('Transactions tab runtime import hardening failed');
  if (!source.includes('const total = transactionTotal(transaction);')) throw new Error('Transactions tab canonical total render missing');
  fs.writeFileSync(fullPath, source);
}

// Live-device QA: canonical feed quotes were reclassified without the current
// exchange state. On a closed US weekend that made a verified Friday regular-
// session close look stale instead of valuation-eligible. Feed the same market
// state/calendar context used by direct provider classification.
{
  const fullPath = path.join(root, 'src/market-data.js');
  let source = fs.readFileSync(fullPath, 'utf8');
  const oldRead = "      const quote = quoteFromRegistry(symbol, registry[symbol], { now: Date.now() });";
  const newRead = [
    "      const exchange = exchangeState(symbol);",
    "      const quote = quoteFromRegistry(symbol, registry[symbol], {",
    "        now: Date.now(),",
    "        exchangeOpen: exchange.open,",
    "        exchangeSession: exchange.session,",
    "        exchangeCalendarVerified: exchange.calendarVerified !== false,",
    "      });",
  ].join('\n');
  if (source.includes(oldRead)) source = source.replace(oldRead, newRead);
  if (!source.includes(newRead)) throw new Error('Canonical feed exchange-state hardening failed');
  fs.writeFileSync(fullPath, source);
}

// Live-device QA: a FINAL SPCE SELL_NOW action remained visible on 5 Sep even
// though validUntil had already passed on 4 Sep and the research feed itself
// was stale. Final actions now share one fail-closed validity gate.
{
  const fullPath = path.join(root, 'src', 'FinalDecisionCard.js');
  let source = fs.readFileSync(fullPath, 'utf8');

  const oldImports = "import { portfolioSnapshot } from './decision-engine';";
  const newImports = "import { portfolioSnapshot } from './decision-engine';\nimport { finalActionValidity } from './decision-validity';";
  if (source.includes(oldImports) && !source.includes("from './decision-validity'")) source = source.replace(oldImports, newImports);

  source = source.replace(
    'export default function FinalDecisionCard({ item }) {',
    'export default function FinalDecisionCard({ item, decisionContext = {} }) {',
  );

  const oldDecisionBlock = `  const finalAction = item?.finalAction || null;\n  const blockers = Array.isArray(finalAction?.blockers) ? finalAction.blockers : [];\n  const personalized = useMemo(() => {\n    if (!finalAction || finalAction.status !== 'FINAL') return null;\n    const code = hasPosition ? finalAction.holderAction : finalAction.nonHolderAction;\n    return { code, label: actionLabel(code, finalAction), tone: tone(code) };\n  }, [finalAction, hasPosition]);`;
  const newDecisionBlock = `  const finalAction = item?.finalAction || null;\n  const blockers = Array.isArray(finalAction?.blockers) ? finalAction.blockers : [];\n  const decisionValidity = useMemo(\n    () => finalActionValidity(finalAction, decisionContext),\n    [finalAction, decisionContext?.feedFresh, decisionContext?.systemReady],\n  );\n  const personalized = useMemo(() => {\n    if (!decisionValidity.eligible) return null;\n    const code = hasPosition ? finalAction.holderAction : finalAction.nonHolderAction;\n    return { code, label: actionLabel(code, finalAction), tone: tone(code) };\n  }, [decisionValidity.eligible, finalAction, hasPosition]);`;
  if (source.includes(oldDecisionBlock)) source = source.replace(oldDecisionBlock, newDecisionBlock);

  const oldBlocked = `        <Text style={styles.blockedTitle}>Δεν έχει εγκριθεί τελική ενέργεια</Text>\n        <Text style={styles.blockedText}>Δεν παράγεται αγορά ή πώληση μέχρι να περάσουν όλοι οι υποχρεωτικοί έλεγχοι.</Text>`;
  const newBlocked = `        <Text style={styles.blockedTitle}>{decisionValidity.reason === 'DECISION_EXPIRED' ? 'Η προηγούμενη τελική ενέργεια έχει λήξει' : decisionValidity.reason === 'FEED_NOT_FRESH' ? 'Απαιτείται νέα ενημέρωση της έρευνας' : decisionValidity.reason === 'SYSTEM_NOT_READY' ? 'Η τελική ενέργεια έχει παγώσει' : 'Δεν έχει εγκριθεί τελική ενέργεια'}</Text>\n        <Text style={styles.blockedText}>{decisionValidity.reason === 'DECISION_EXPIRED' ? 'Το παλιό BUY/SELL δεν θεωρείται ενεργό. Απαιτείται νέα τεκμηριωμένη αξιολόγηση.' : decisionValidity.reason === 'FEED_NOT_FRESH' ? 'Η αγορά μπορεί να έχει νεότερη τιμή, αλλά παλιά ερευνητική ροή δεν επιτρέπεται να εμφανίσει ενεργό BUY/SELL.' : decisionValidity.reason === 'SYSTEM_NOT_READY' ? 'Η τελική κατεύθυνση παραμένει ανενεργή μέχρι να είναι ξανά έτοιμοι όλοι οι υποχρεωτικοί έλεγχοι.' : 'Δεν παράγεται αγορά ή πώληση μέχρι να περάσουν όλοι οι υποχρεωτικοί έλεγχοι.'}</Text>`;
  if (source.includes(oldBlocked)) source = source.replace(oldBlocked, newBlocked);

  if (!source.includes("import { finalActionValidity } from './decision-validity';")) throw new Error('FinalDecisionCard decision validity import missing');
  if (!source.includes('if (!decisionValidity.eligible) return null;')) throw new Error('FinalDecisionCard current-decision gate missing');
  if (!source.includes("decisionValidity.reason === 'DECISION_EXPIRED'")) throw new Error('FinalDecisionCard expired-action UX missing');
  fs.writeFileSync(fullPath, source);
}

// The Research screen and its top BUY/SELL counters must use the same validity
// gate as the card. A stale feed or expired validUntil can never count as
// "Αγορά τώρα" or "Πώληση τώρα" even when the latest market quote is fresh.
{
  const fullPath = path.join(root, 'src', 'OpportunitiesView.js');
  let source = fs.readFileSync(fullPath, 'utf8');

  const importAnchor = "import FinalDecisionCard from './FinalDecisionCard';";
  const importWithGate = "import FinalDecisionCard from './FinalDecisionCard';\nimport { finalActionIsCurrent } from './decision-validity';";
  if (source.includes(importAnchor) && !source.includes("from './decision-validity'")) source = source.replace(importAnchor, importWithGate);

  source = source.replace(
    'function personalizedDecisionCounts(feed, portfolioPositions) {',
    'function personalizedDecisionCounts(feed, portfolioPositions, decisionContext = {}) {',
  );
  source = source.replace(
    "    if (!finalAction || finalAction.status !== 'FINAL') continue;",
    '    if (!finalActionIsCurrent(finalAction, decisionContext)) continue;',
  );

  source = source.replace(
    'function IntelligenceCard({ item }) {',
    'function IntelligenceCard({ item, decisionContext }) {',
  );
  source = source.replace(
    '<FinalDecisionCard item={item} />',
    '<FinalDecisionCard item={item} decisionContext={decisionContext} />',
  );

  source = source.replace(
    'function Section({ title, subtitle, items }) {',
    'function Section({ title, subtitle, items, decisionContext }) {',
  );
  source = source.replace(
    'items.map((item) => <IntelligenceCard key={item.id} item={item} />)',
    'items.map((item) => <IntelligenceCard key={item.id} item={item} decisionContext={decisionContext} />)',
  );

  const oldHealth = `  const freshness = useMemo(() => intelligenceFeedFreshness(feed), [feed]);\n  const personalizedCounts = useMemo(() => personalizedDecisionCounts(feed, portfolioPositions), [feed, portfolioPositions]);\n  const operationalHealth = feed?.operationalHealth || null;\n  const sourceHealth = feed?.sourceHealth || null;\n  const productionReady = operationalHealth?.status === 'OPERATIONAL'\n    && operationalHealth?.marketDataStatus === 'OPERATIONAL'\n    && operationalHealth?.fundamentalsStatus === 'OPERATIONAL'\n    && freshness.state === 'fresh';`;
  const newHealth = `  const freshness = useMemo(() => intelligenceFeedFreshness(feed), [feed]);\n  const operationalHealth = feed?.operationalHealth || null;\n  const sourceHealth = feed?.sourceHealth || null;\n  const systemReady = operationalHealth?.status === 'OPERATIONAL'\n    && operationalHealth?.marketDataStatus === 'OPERATIONAL'\n    && operationalHealth?.fundamentalsStatus === 'OPERATIONAL'\n    && operationalHealth?.decisionEngineStatus === 'READY';\n  const decisionContext = useMemo(() => ({\n    feedFresh: freshness.state === 'fresh',\n    systemReady,\n  }), [freshness.state, systemReady]);\n  const productionReady = decisionContext.feedFresh && decisionContext.systemReady;\n  const personalizedCounts = useMemo(\n    () => personalizedDecisionCounts(feed, portfolioPositions, decisionContext),\n    [feed, portfolioPositions, decisionContext],\n  );`;
  if (source.includes(oldHealth)) source = source.replace(oldHealth, newHealth);

  source = source.replace(
    'items={feed.confirmedBuyOpportunities || []} />',
    'items={decisionContext.feedFresh && decisionContext.systemReady ? (feed.confirmedBuyOpportunities || []) : []} />',
  );

  // Normalize any duplicate prop left by an interrupted/older materialization,
  // then add the prop only when a target section does not already have it.
  source = source.replace(
    /(?: decisionContext=\{decisionContext\}){2,}/g,
    ' decisionContext={decisionContext}',
  );
  const sectionTitles = [
    'Αυξημένη προτεραιότητα',
    'Δημοσιευμένες ευκαιρίες',
    'Έτοιμα για τελικό έλεγχο',
    'Έρευνα σε εξέλιξη',
  ];
  for (const title of sectionTitles) {
    const marker = `<Section title="${title}"`;
    source = source.split('\n').map((line) => {
      if (line.includes(marker) && !line.includes('decisionContext={decisionContext}')) {
        return line.replace(' />', ' decisionContext={decisionContext} />');
      }
      return line;
    }).join('\n');
  }

  if (!source.includes("import { finalActionIsCurrent } from './decision-validity';")) throw new Error('OpportunitiesView decision validity import missing');
  if (!source.includes('if (!finalActionIsCurrent(finalAction, decisionContext)) continue;')) throw new Error('Research BUY/SELL count validity gate missing');
  if (!source.includes('<FinalDecisionCard item={item} decisionContext={decisionContext} />')) throw new Error('Research card decision context missing');
  if (!source.includes("decisionEngineStatus === 'READY'")) throw new Error('Decision engine readiness gate missing');
  if (!source.includes('items={decisionContext.feedFresh && decisionContext.systemReady ? (feed.confirmedBuyOpportunities || []) : []}')) throw new Error('Stale confirmed-buy suppression missing');
  if (source.includes('decisionContext={decisionContext} decisionContext={decisionContext}')) throw new Error('Duplicate decision context prop remains');
  fs.writeFileSync(fullPath, source);
}

console.log('Core live-device hardening PASS: null-safe numerics, Transactions runtime import, closed-market quote context, and stale/expired decision fail-closed rules are enforced idempotently.');
