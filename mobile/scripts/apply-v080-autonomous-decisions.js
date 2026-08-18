const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function write(relativePath, content) {
  fs.writeFileSync(path.join(root, relativePath), content);
}

function replaceRequired(content, from, to, label) {
  if (content.includes(to)) return content;
  if (!content.includes(from)) throw new Error(`v0.8.0 patch failed: missing ${label}`);
  return content.replace(from, to);
}

function patchOpportunities() {
  let source = read('src/OpportunitiesView.js');
  source = replaceRequired(
    source,
    "} from './intelligence-feed-store';\n",
    "} from './intelligence-feed-store';\nimport FinalDecisionCard from './FinalDecisionCard';\n",
    'FinalDecisionCard import',
  );
  source = replaceRequired(
    source,
    "        <Text style={[styles.category, risk && styles.riskText]}>{item.categoryLabel}</Text>\n        <View style={styles.actionRow}>",
    "        <Text style={[styles.category, risk && styles.riskText]}>{item.categoryLabel}</Text>\n        <FinalDecisionCard item={item} />\n        <View style={styles.actionRow}>",
    'final decision card placement',
  );
  source = replaceRequired(
    source,
    "  const counts = useMemo(() => feed?.summary || {\n    publishedCount: 0,\n    reviewReadyCount: 0,\n    researchCount: 0,\n    urgentCount: 0,\n  }, [feed]);",
    "  useEffect(() => {\n    const interval = setInterval(() => { sync().catch(() => {}); }, 5 * 60 * 1000);\n    return () => clearInterval(interval);\n  }, [sync]);\n\n  const counts = useMemo(() => feed?.summary || {\n    publishedCount: 0,\n    reviewReadyCount: 0,\n    researchCount: 0,\n    urgentCount: 0,\n    finalActionCount: 0,\n    buyNowCount: 0,\n    sellNowCount: 0,\n  }, [feed]);",
    'continuous five-minute foreground sync',
  );
  source = replaceRequired(
    source,
    '<Text style={styles.subtitle}>Τεκμηριωμένη έρευνα, κίνδυνοι και επόμενες ενέργειες</Text>',
    '<Text style={styles.subtitle}>Αυτόνομα συμπεράσματα με διασταύρωση, φρεσκότητα και έλεγχο κινδύνου</Text>',
    'Opportunities subtitle',
  );
  source = replaceRequired(
    source,
    "              <View style={styles.countBox}><Text style={styles.countValue}>{counts.publishedCount}</Text><Text style={styles.countLabel}>Δημοσιευμένες</Text></View>\n              <View style={styles.countBox}><Text style={styles.countValue}>{counts.reviewReadyCount}</Text><Text style={styles.countLabel}>Για έλεγχο</Text></View>\n              <View style={styles.countBox}><Text style={styles.countValue}>{counts.researchCount}</Text><Text style={styles.countLabel}>Σε έρευνα</Text></View>",
    "              <View style={styles.countBox}><Text style={styles.countValue}>{counts.buyNowCount || 0}</Text><Text style={styles.countLabel}>Αγορά τώρα</Text></View>\n              <View style={styles.countBox}><Text style={styles.countValue}>{counts.sellNowCount || 0}</Text><Text style={styles.countLabel}>Πώληση τώρα</Text></View>\n              <View style={styles.countBox}><Text style={styles.countValue}>{counts.finalActionCount || 0}</Text><Text style={styles.countLabel}>Τελικά σήματα</Text></View>",
    'autonomous summary counters',
  );
  write('src/OpportunitiesView.js', source);
}

function patchFeedStore() {
  let source = read('src/intelligence-feed-store.js');
  source = replaceRequired(
    source,
    "    sources: safeArray(item?.sources),\n  };",
    "    sources: safeArray(item?.sources),\n    finalAction: item?.finalAction && typeof item.finalAction === 'object' ? item.finalAction : null,\n    publicationMode: item?.publicationMode || null,\n  };",
    'final action normalization',
  );
  source = replaceRequired(
    source,
    "  const urgent = all.filter((item) => urgentIds.has(item.id));\n  return {",
    "  const urgent = all.filter((item) => urgentIds.has(item.id));\n  const decisions = all.filter((item) => item.finalAction?.status === 'FINAL');\n  return {",
    'decisions collection',
  );
  source = replaceRequired(
    source,
    "    version: FEED_VERSION,\n    generatedAt: generatedAt.toISOString(),",
    "    version: FEED_VERSION,\n    generatedAt: generatedAt.toISOString(),\n    policyVersion: payload.policyVersion || null,",
    'policy version preservation',
  );
  source = replaceRequired(
    source,
    "      unresolvedDiagnosticCount: Math.max(0, Number(payload.summary?.unresolvedDiagnosticCount || 0)),\n    },",
    "      unresolvedDiagnosticCount: Math.max(0, Number(payload.summary?.unresolvedDiagnosticCount || 0)),\n      finalActionCount: Math.max(0, Number(payload.summary?.finalActionCount || decisions.length)),\n      buyNowCount: Math.max(0, Number(payload.summary?.buyNowCount || 0)),\n      sellNowCount: Math.max(0, Number(payload.summary?.sellNowCount || 0)),\n      holdCount: Math.max(0, Number(payload.summary?.holdCount || 0)),\n      doNotBuyCount: Math.max(0, Number(payload.summary?.doNotBuyCount || 0)),\n      avoidCount: Math.max(0, Number(payload.summary?.avoidCount || 0)),\n      blockedDecisionCount: Math.max(0, Number(payload.summary?.blockedDecisionCount || 0)),\n    },",
    'final action summary preservation',
  );
  source = replaceRequired(
    source,
    "    published,\n    reviewReady,",
    "    decisions,\n    published,\n    reviewReady,",
    'decisions return field',
  );
  write('src/intelligence-feed-store.js', source);
}

function patchVersions() {
  let portfolio = read('PortfolioApp.js');
  portfolio = replaceRequired(portfolio, "const VERSION = '0.7.1';", "const VERSION = '0.8.0';", 'Portfolio version');
  write('PortfolioApp.js', portfolio);

  let decision = read('DecisionOverlay.js');
  decision = replaceRequired(decision, "const VERSION = '0.7.1';", "const VERSION = '0.8.0';", 'DecisionOverlay version');
  write('DecisionOverlay.js', decision);

  const appJsonPath = path.join(root, 'app.json');
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  appJson.expo.version = '0.8.0';
  appJson.expo.android.versionCode = 16;
  appJson.expo.ios.buildNumber = '16';
  fs.writeFileSync(appJsonPath, `${JSON.stringify(appJson, null, 2)}\n`);

  const packagePath = path.join(root, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  packageJson.version = '0.8.0';
  packageJson.scripts = packageJson.scripts || {};
  packageJson.scripts.postinstall = 'node scripts/apply-v065-native-ui-fix.js && node scripts/apply-v070-opportunities.js && node scripts/apply-v071-live-sync.js && node scripts/apply-v080-autonomous-decisions.js';
  fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

patchOpportunities();
patchFeedStore();
patchVersions();

const opportunities = read('src/OpportunitiesView.js');
const store = read('src/intelligence-feed-store.js');
if (!opportunities.includes("import FinalDecisionCard from './FinalDecisionCard';")) throw new Error('v0.8.0 verification failed: final card import missing');
if (!opportunities.includes('<FinalDecisionCard item={item} />')) throw new Error('v0.8.0 verification failed: final card placement missing');
if (!opportunities.includes('5 * 60 * 1000')) throw new Error('v0.8.0 verification failed: continuous sync interval missing');
if (!store.includes("item.finalAction?.status === 'FINAL'")) throw new Error('v0.8.0 verification failed: final decisions missing from store');
console.log('Investor Control v0.8.0 autonomous decisions patch applied.');
