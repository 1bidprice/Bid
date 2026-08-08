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
  if (!content.includes(from)) throw new Error(`v0.9.0 patch failed: missing ${label}`);
  return content.replace(from, to);
}

function replaceBetween(content, startMarker, endMarker, replacement, label) {
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) throw new Error(`v0.9.0 patch failed: missing ${label}`);
  return `${content.slice(0, start)}${replacement}${content.slice(end)}`;
}

function patchPortfolio() {
  let source = read('PortfolioApp.js');
  source = source.replace("const VERSION = '0.8.1';", "const VERSION = '0.9.0';");

  const positionCard = `function quoteQualityLabel(quote) {
  if (!quote) return 'Μη διαθέσιμη';
  const source = String(quote.source || '').toLowerCase();
  const quality = String(quote.quality || '').toLowerCase();
  const status = String(quote.status || '').toLowerCase();
  if (status === 'stale' || quote.usable === false) return 'Παρωχημένη / μη χρησιμοποιήσιμη';
  if (quality.includes('delay') || source.includes('delay')) return 'Καθυστερημένη';
  if (quality.includes('close') || status.includes('close')) return 'Τιμή κλεισίματος';
  if (quality.includes('real') || source.includes('websocket') || status === 'live') return 'Ζωντανή ροή';
  return 'Τελευταία διαθέσιμη';
}

function quoteSessionLabel(quote) {
  return quote?.marketSession || quote?.session || 'Δεν δηλώνεται από την πηγή';
}

function PositionCard({ item, compact, expanded, onToggle, onAlert }) {
  const stale = item.quote && !item.quote.usable;
  const dayChange = Number(item.quote?.changePct);
  const positionChange = Number(item.nativePct);
  const openLots = Array.isArray(item.lots) ? item.lots : [];
  return (
    <View style={styles.card}>
      <Pressable onPress={onToggle}>
        <View style={styles.rowTop}>
          <View style={styles.grow}>
            <Text style={styles.cardTitle}>{item.company}</Text>
            <Text style={styles.muted}>{item.symbol} · {item.quantity.toLocaleString('el-GR')} μετοχές</Text>
          </View>
          <QuoteBadge quote={item.quote} />
        </View>
        <View style={styles.priceRow}>
          <View style={styles.grow}>
            <Text style={styles.muted}>Τρέχουσα τιμή</Text>
            <Text style={styles.big} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.64}>{stale ? '—' : quotePrice(item.nativePrice, item.currency)}</Text>
            {item.currency === 'USD' && !stale ? <Text style={styles.muted}>≈ {quotePrice(item.eurPrice, 'EUR')}</Text> : null}
          </View>
        </View>
        <View style={styles.performanceStack}>
          <PositionPerformanceLine label="Ημέρα" value={dayChange} stale={stale} primary />
          {openLots.length ? openLots.map((lot) => (
            <React.Fragment key={lot.lotId}>
              <View style={styles.performanceDivider} />
              <PositionPerformanceLine
                label={openLots.length === 1 ? 'Από αγορά · ' + lotShortDate(lot.date) : lot.purchaseNumber + 'η αγορά · ' + lotShortDate(lot.date)}
                value={lot.performancePct}
                stale={stale}
              />
            </React.Fragment>
          )) : <>
            <View style={styles.performanceDivider} />
            <PositionPerformanceLine label="Από θέση" value={positionChange} stale={stale} />
          </>}
        </View>
        <View style={styles.quoteTransparency}>
          <Text style={styles.quoteTransparencyTitle}>Διαφάνεια τιμής</Text>
          <Text style={styles.quoteTransparencyText}>Πηγή: {item.quote?.source || '—'}</Text>
          <Text style={styles.quoteTransparencyText}>Τελευταία τιμή: {item.quote?.updatedAt ? when(item.quote.updatedAt) : '—'}</Text>
          <Text style={styles.quoteTransparencyText}>Κατάσταση: {quoteQualityLabel(item.quote)} · Συνεδρία: {quoteSessionLabel(item.quote)}</Text>
        </View>
        <View style={styles.grid}>
          <Metric compact={compact} label="Αξία θέσης" value={cash(item.nativeValue, item.currency)} />
          <Metric compact={compact} label="Συνολικό κόστος" value={cash(item.cost, item.currency)} />
          <Metric compact={compact} label="Κέρδος / Ζημία" value={cash(item.nativePnl, item.currency)} negative={item.nativePnl < 0} positiveValue={item.nativePnl > 0} />
          <Metric compact={compact} label="Μέση τιμή all-in" value={quotePrice(item.average, item.currency, 4)} />
        </View>
      </Pressable>
      {expanded ? (
        <View style={styles.detailPanel}>
          {item.currency === 'USD' && item.eurValue !== null ? <Text style={styles.note}>Σε ευρώ: αξία ≈ {cash(item.eurValue)} · αποτέλεσμα ≈ {cash(item.eurPnl)}</Text> : null}
          <View style={styles.lotsSection}>
            <View style={styles.lotsHeader}>
              <View style={styles.grow}><Text style={styles.lotsTitle}>Επιμέρους αγορές</Text><Text style={styles.lotsSubtitle}>Κάθε αγορά κρατά το δικό της all-in και πρόσημο.</Text></View>
              <View style={styles.lotsCountBadge}><Text style={styles.lotsCountText}>{item.lots?.length || 0}</Text></View>
            </View>
            {(item.lots || []).map((lot) => <PositionLotRow key={lot.lotId} lot={lot} currency={item.currency} stale={stale} />)}
            {item.hadLotSales ? <Text style={styles.lotMethodNote}>Οι πωλήσεις κατανέμονται FIFO μόνο για την απεικόνιση των ανοιχτών αγορών. Το συνολικό κόστος της κάρτας παραμένει στο λογιστικό μοντέλο v2.</Text> : null}
            {item.unmatchedSellQuantity > 0 ? <Text style={styles.warning}>Υπάρχει πώληση {item.unmatchedSellQuantity.toLocaleString('el-GR')} μετοχών που δεν αντιστοιχεί σε καταγεγραμμένη αγορά.</Text> : null}
          </View>
          <Text style={styles.source}>Έλεγχος συσκευής: {item.quote?.checkedAt ? when(item.quote.checkedAt) : '—'}</Text>
          {stale ? <Text style={styles.warning}>Η τιμή είναι παρωχημένη και δεν χρησιμοποιείται στη συνολική αποτίμηση.</Text> : null}
          <Pressable style={styles.secondaryActionFull} onPress={onAlert}><Text style={styles.secondaryStrong}>Ρύθμιση ειδοποιήσεων</Text></Pressable>
        </View>
      ) : <Text style={styles.tapHint}>Πάτησε για επιμέρους αγορές, στοιχεία και ειδοποιήσεις</Text>}
    </View>
  );
}`;

  source = replaceBetween(
    source,
    'function PositionCard({ item, compact, expanded, onToggle, onAlert }) {',
    '\n\nfunction transactionForm(',
    positionCard,
    'PositionCard clarity block',
  );

  source = source.replace(
    "performanceStack: { width: 158, borderRadius: 16, borderWidth: 1, borderColor: '#d8e2ee', backgroundColor: '#f8fbff', paddingHorizontal: 11, paddingVertical: 8 }",
    "performanceStack: { width: '100%', borderRadius: 16, borderWidth: 1, borderColor: '#d8e2ee', backgroundColor: '#f8fbff', paddingHorizontal: 13, paddingVertical: 10, marginTop: 12 }",
  );
  source = source.replace(
    "performanceLabel: { color: '#7b889d', fontSize: 10, lineHeight: 13, fontWeight: '800', flex: 1 }",
    "performanceLabel: { color: '#617087', fontSize: 13, lineHeight: 18, fontWeight: '800', flex: 1 }",
  );
  source = source.replace(
    "performanceValue: { fontSize: 15, lineHeight: 19, fontWeight: '900', textAlign: 'right' }",
    "performanceValue: { fontSize: 17, lineHeight: 21, fontWeight: '900', textAlign: 'right' }",
  );
  source = source.replace(
    "note: { color: '#67768c', fontSize: 15, lineHeight: 23, marginTop: 10 }",
    "quoteTransparency: { backgroundColor: '#f3f7fc', borderRadius: 14, padding: 11, marginTop: 10 }, quoteTransparencyTitle: { color: '#16345f', fontSize: 12, fontWeight: '900', marginBottom: 3 }, quoteTransparencyText: { color: '#718096', fontSize: 11, lineHeight: 16 }, note: { color: '#67768c', fontSize: 15, lineHeight: 23, marginTop: 10 }",
  );
  write('PortfolioApp.js', source);
}

function patchDecisionGate() {
  let source = read('DecisionOverlay.js');
  source = source.replace("const VERSION = '0.8.1';", "const VERSION = '0.9.0';");
  if (!source.includes('function decisionScope(')) {
    source = replaceRequired(
      source,
      'export default function DecisionOverlay',
      `function decisionScope(result) {
  const blocked = result?.status === 'blocked' || (result?.blocking || []).length > 0;
  const caution = result?.status === 'caution';
  return {
    existingPosition: blocked || caution ? 'Χρειάζεται επανεξέταση — δεν προκύπτει αυτόματη πώληση' : 'Το πλάνο δεν εμφανίζει σημερινή παραβίαση',
    newBuy: blocked ? 'Μπλοκάρεται' : caution ? 'Μόνο με προσοχή' : 'Επιτρέπεται από τους κανόνες',
    newBuyLabel: blocked ? 'ΝΕΑ ΑΓΟΡΑ: ΟΧΙ' : caution ? 'ΝΕΑ ΑΓΟΡΑ: ΠΡΟΣΟΧΗ' : 'ΝΕΑ ΑΓΟΡΑ: ΝΑΙ',
  };
}

export default function DecisionOverlay`,
      'decision scope helper',
    );
  }
  source = source.replace('<Metric label="Μπλοκαρισμένες" value={String(counts.blocked)} danger={counts.blocked > 0} />', '<Metric label="Νέες αγορές μπλοκαρισμένες" value={String(counts.blocked)} danger={counts.blocked > 0} />');
  source = source.replace('<StatusPill status={result.status} label={result.label} />', '<StatusPill status={result.status} label={decisionScope(result).newBuyLabel} />');
  source = source.replace(
    "{result.issues.length ? (\n                    <Text style={styles.issuePreview}>{result.issues[0].message}{result.issues.length > 1 ? `  +${result.issues.length - 1} ακόμη` : ''}</Text>\n                  ) : <Text style={styles.readyText}>Το πλάνο είναι πλήρες και δεν παραβιάζει τα σημερινά όρια.</Text>}",
    "{result.issues.length ? (\n                    <Text style={styles.issuePreview}>{result.issues[0].message}{result.issues.length > 1 ? `  +${result.issues.length - 1} ακόμη` : ''}</Text>\n                  ) : <Text style={styles.readyText}>Το πλάνο είναι πλήρες και δεν παραβιάζει τα σημερινά όρια.</Text>}\n                  <View style={styles.scopeBox}><Text style={styles.scopeLabel}>Υπάρχουσα θέση</Text><Text style={styles.scopeText}>{decisionScope(result).existingPosition}</Text><Text style={styles.scopeLabel}>Νέα αγορά / ενίσχυση</Text><Text style={styles.scopeStrong}>{decisionScope(result).newBuy}</Text></View>",
  );
  source = source.replace('<Text style={styles.cardTitle}>Ετυμηγορία</Text>', '<Text style={styles.cardTitle}>Ετυμηγορία νέας αγοράς / ενίσχυσης</Text>');
  source = source.replace(
    '<StatusPill status={liveResult.status} label={liveResult.label} />',
    '<StatusPill status={liveResult.status} label={decisionScope(liveResult).newBuyLabel} />',
  );
  source = source.replace(
    "                  {liveResult.issues.length ? liveResult.issues.map((item) => (",
    "                  <View style={styles.scopeBox}><Text style={styles.scopeLabel}>Υπάρχουσα θέση</Text><Text style={styles.scopeText}>{decisionScope(liveResult).existingPosition}</Text><Text style={styles.scopeLabel}>Νέα αγορά / ενίσχυση</Text><Text style={styles.scopeStrong}>{decisionScope(liveResult).newBuy}</Text></View>\n                  {liveResult.issues.length ? liveResult.issues.map((item) => (",
  );
  source = source.replace(
    "readyText: { color: '#147a4a', backgroundColor: '#eaf9f1', borderRadius: 14, padding: 12, lineHeight: 20 },",
    "readyText: { color: '#147a4a', backgroundColor: '#eaf9f1', borderRadius: 14, padding: 12, lineHeight: 20 }, scopeBox: { backgroundColor: '#f3f7fc', borderRadius: 14, padding: 12, gap: 3 }, scopeLabel: { color: '#7b8799', fontSize: 11, fontWeight: '800', marginTop: 3 }, scopeText: { color: '#425674', fontSize: 13, lineHeight: 18 }, scopeStrong: { color: '#10233f', fontSize: 14, lineHeight: 19, fontWeight: '900' },",
  );
  write('DecisionOverlay.js', source);
}

function patchFeedStore() {
  let source = read('src/intelligence-feed-store.js');
  source = source.replace('const FEED_VERSION = 1;', 'const FEED_VERSION = 2;\nconst SUPPORTED_FEED_VERSIONS = new Set([1, 2]);');
  source = source.replace('Number(payload?.version) !== FEED_VERSION', '!SUPPORTED_FEED_VERSIONS.has(Number(payload?.version))');
  source = replaceRequired(
    source,
    "    publicationMode: item?.publicationMode || null,\n  };",
    "    publicationMode: item?.publicationMode || null,\n    origin: item?.origin === 'AUTONOMOUS_DISCOVERY' ? 'AUTONOMOUS_DISCOVERY' : 'FOCUS_UNIVERSE',\n    discovery: item?.discovery && typeof item.discovery === 'object' ? item.discovery : null,\n    referencePriceAgeHours: Number.isFinite(Number(item?.referencePriceAgeHours)) ? Number(item.referencePriceAgeHours) : null,\n    metricNotes: safeArray(item?.metricNotes),\n  };",
    'new feed item fields',
  );
  source = replaceRequired(
    source,
    "  const decisions = all.filter((item) => item.finalAction?.status === 'FINAL');\n  return {",
    "  const decisions = all.filter((item) => item.finalAction?.status === 'FINAL');\n  const discoveryRadar = safeArray(payload.discoveryRadar).map((item) => ({ ...item, reasons: safeArray(item?.reasons), events: safeArray(item?.events), suggestedAction: 'WATCH' }));\n  return {",
    'discovery radar normalization',
  );
  source = replaceRequired(
    source,
    "    policyVersion: payload.policyVersion || null,",
    "    policyVersion: payload.policyVersion || null,\n    sourceSelection: payload.sourceSelection && typeof payload.sourceSelection === 'object' ? payload.sourceSelection : null,",
    'source policy preservation',
  );
  source = replaceRequired(
    source,
    "      urgentCount: urgent.length,",
    "      urgentCount: urgent.length,\n      discoveryCandidateCount: discoveryRadar.length,\n      discoveryDeepAnalysisCount: Math.max(0, Number(payload.summary?.discoveryDeepAnalysisCount || 0)),",
    'discovery summary',
  );
  source = replaceRequired(
    source,
    "    decisions,\n    published,",
    "    discoveryRadar,\n    decisions,\n    published,",
    'discovery return field',
  );
  write('src/intelligence-feed-store.js', source);
}

function patchOpportunities() {
  let source = read('src/OpportunitiesView.js');
  const replacement = `function IntelligenceCard({ item }) {
  const [expanded, setExpanded] = useState(false);
  const risk = ['EVENT_RISK', 'DETERIORATION'].includes(item.category);
  const referenceAge = Number(item.referencePriceAgeHours);
  return (
    <View style={[styles.card, risk && styles.riskCard]}>
      <Pressable onPress={() => setExpanded((current) => !current)}>
        <View style={styles.rowTop}>
          <View style={styles.grow}>
            <Text style={styles.company}>{item.companyName}</Text>
            <Text style={styles.symbol}>{item.symbol || '—'} · {item.exchange || '—'}</Text>
          </View>
          <StatusBadge item={item} />
        </View>
        <Text style={[styles.category, risk && styles.riskText]}>{item.categoryLabel}</Text>
        <FinalDecisionCard item={item} />
        <View style={styles.actionRow}>
          <View style={styles.actionBox}><Text style={styles.muted}>Αξιολόγηση</Text><Text style={[styles.action, risk && styles.riskText]}>{item.actionLabel}</Text></View>
          <View style={styles.actionBox}><Text style={styles.muted}>Τιμή αναφοράς</Text><Text style={styles.action}>{money(item.referencePrice)}</Text><Text style={styles.ageText}>{Number.isFinite(referenceAge) ? (referenceAge < 1 ? 'πριν από λιγότερο από 1 ώρα' : 'πριν από ' + referenceAge.toFixed(1) + ' ώρες') : 'χωρίς έγκυρη ώρα'}</Text></View>
        </View>
        {item.thesis ? <Text style={styles.thesis} numberOfLines={expanded ? undefined : 4}>{item.thesis}</Text> : <Text style={styles.warning}>Δεν έχει ολοκληρωθεί ακόμη τεκμηριωμένη επενδυτική θέση.</Text>}
        <View style={styles.nextBox}><Text style={styles.nextLabel}>Επόμενο βήμα</Text><Text style={styles.nextText}>{item.nextStep}</Text></View>
        <Text style={styles.expand}>{expanded ? 'Απόκρυψη λεπτομερειών' : 'Προβολή πλήρους φακέλου'}</Text>
      </Pressable>
      {expanded ? (
        <View style={styles.details}>
          <View style={styles.timeContext}><Text style={styles.timeTitle}>Χρόνοι ανάλυσης</Text><Text style={styles.timeText}>Τελευταία αυτόματη ενημέρωση: {when(item.generatedAt)}</Text><Text style={styles.timeText}>Επίσημη επανεξέταση επενδυτικής υπόθεσης: {item.reviewDate || '—'}</Text></View>
          {item.metricNotes?.map((note, index) => <View key={'m-' + index} style={styles.metricNote}><Text style={styles.metricNoteTitle}>Επεξήγηση ακραίας μέτρησης</Text><Text style={styles.detailText}>{note}</Text></View>)}
          {item.causalMechanism ? <><Text style={styles.detailTitle}>Γιατί μπορεί να επηρεάσει τη μετοχή</Text><Text style={styles.detailText}>{item.causalMechanism}</Text></> : null}
          {item.bullCase ? <><Text style={styles.detailTitle}>Θετικό σενάριο</Text><Text style={styles.detailText}>{item.bullCase}</Text></> : null}
          {item.bearCase ? <><Text style={styles.detailTitle}>Αρνητικό σενάριο</Text><Text style={styles.detailText}>{item.bearCase}</Text></> : null}
          {item.invalidationCondition ? <View style={styles.invalidation}><Text style={styles.invalidationTitle}>Τι ακυρώνει την υπόθεση</Text><Text style={styles.detailText}>{item.invalidationCondition}</Text></View> : null}
          {item.catalysts?.length ? <><Text style={styles.detailTitle}>Καταλύτες</Text>{item.catalysts.map((entry, index) => <Text key={'c-' + index} style={styles.bullet}>• {claimText(entry)}</Text>)}</> : null}
          {item.risks?.length ? <><Text style={styles.detailTitle}>Κίνδυνοι</Text>{item.risks.map((entry, index) => <Text key={'r-' + index} style={styles.bullet}>• {claimText(entry)}</Text>)}</> : null}
          {item.blockerLabels?.length ? <View style={styles.blockers}><Text style={styles.blockerTitle}>Γιατί δεν είναι ακόμη τελική πρόταση</Text>{item.blockerLabels.map((label, index) => <Text key={'b-' + index} style={styles.blockerText}>• {label}</Text>)}</View> : null}
          <Text style={styles.detailTitle}>Πηγές</Text>
          {item.sources?.length ? item.sources.map((sourceItem, index) => <Pressable key={sourceItem.sourceUrl + '-' + index} style={styles.sourceRow} onPress={() => Linking.openURL(sourceItem.sourceUrl).catch(() => Alert.alert('Πηγή', 'Δεν ήταν δυνατό να ανοίξει ο σύνδεσμος.'))}><View style={styles.grow}><Text style={styles.sourceName}>{sourceItem.sourceName}</Text><Text style={styles.sourceTitle}>{sourceItem.title}</Text></View><Text style={styles.sourceState}>{sourceItem.reviewed ? 'Ελεγμένη' : 'Εντοπίστηκε'}</Text></Pressable>) : <Text style={styles.muted}>Δεν υπάρχουν διαθέσιμες πηγές στην τρέχουσα ροή.</Text>}
        </View>
      ) : null}
    </View>
  );
}

function DiscoveryRadarCard({ item }) {
  return <View style={styles.discoveryCard}><View style={styles.rowTop}><View style={styles.grow}><Text style={styles.company}>{item.companyName}</Text><Text style={styles.symbol}>{item.symbol || '—'} · {item.exchange || '—'}</Text></View><View style={styles.discoveryScore}><Text style={styles.discoveryScoreValue}>{Math.round(Number(item.discoveryScore || 0))}</Text><Text style={styles.discoveryScoreLabel}>σήμα</Text></View></View><Text style={styles.discoveryStatus}>ΑΥΤΟΜΑΤΗ ΑΝΑΚΑΛΥΨΗ · ΟΧΙ ΑΚΟΜΗ ΠΡΟΤΑΣΗ ΑΓΟΡΑΣ</Text>{(item.reasons || []).slice(0, 3).map((reason, index) => <Text key={index} style={styles.discoveryReason}>• {reason}</Text>)}<Text style={styles.discoveryTime}>Νεότερο γεγονός: {when(item.latestEventAt)}</Text></View>;
}

function Section({ title, subtitle, items }) {
  if (!items.length) return null;
  return <View style={styles.sectionBlock}><Text style={styles.sectionTitle}>{title}</Text>{subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}{items.map((item) => <IntelligenceCard key={item.id} item={item} />)}</View>;
}`;
  source = replaceBetween(source, 'function IntelligenceCard({ item }) {', '\n\nexport default function OpportunitiesView()', replacement, 'Opportunities cards');
  source = replaceRequired(
    source,
    "    sellNowCount: 0,\n  }, [feed]);",
    "    sellNowCount: 0,\n    discoveryCandidateCount: 0,\n    discoveryDeepAnalysisCount: 0,\n  }, [feed]);",
    'discovery count defaults',
  );
  source = replaceRequired(
    source,
    "        <Text style={styles.connectionMeta}>Τελευταίος επιτυχής συγχρονισμός: {when(syncState?.lastSuccessAt)}</Text>",
    "        <Text style={styles.connectionMeta}>Τελευταίος επιτυχής συγχρονισμός: {when(syncState?.lastSuccessAt)}</Text>\n        <View style={styles.sourcePolicyBox}><Text style={styles.sourcePolicyTitle}>Ποιος επιλέγει τις πηγές;</Text><Text style={styles.sourcePolicyText}>Έκδοση πολιτικής: {feed?.sourceSelection?.version || '—'}. Οι πηγές επιλέγονται από κλειδωμένη πολιτική κώδικα και επιτρεπόμενη λίστα, όχι αυθαίρετα από το AI.</Text></View>",
    'source selection explanation',
  );
  source = replaceRequired(
    source,
    "              <View style={styles.countBox}><Text style={styles.countValue}>{counts.finalActionCount || 0}</Text><Text style={styles.countLabel}>Τελικά σήματα</Text></View>",
    "              <View style={styles.countBox}><Text style={styles.countValue}>{counts.finalActionCount || 0}</Text><Text style={styles.countLabel}>Τελικά σήματα</Text></View>",
    'summary counters retained',
  );
  source = replaceRequired(
    source,
    "          <Section title=\"Αυξημένη προτεραιότητα\"",
    "          {feed.discoveryRadar?.length ? <View style={styles.sectionBlock}><Text style={styles.sectionTitle}>Ραντάρ νέων μετοχών</Text><Text style={styles.sectionSubtitle}>Το σύστημα σαρώνει αυτόματα επίσημα γεγονότα της αγοράς, κατατάσσει νέες εταιρείες και περνά τις ισχυρότερες σε πλήρη ανάλυση.</Text>{feed.discoveryRadar.map((item) => <DiscoveryRadarCard key={item.discoveryId} item={item} />)}</View> : null}\n          <Section title=\"Αυξημένη προτεραιότητα\"",
    'discovery radar section',
  );
  source = source.replace(
    "connectionMeta: { color: '#718096', fontSize: 11, marginTop: 9 },",
    "connectionMeta: { color: '#718096', fontSize: 11, marginTop: 9 }, sourcePolicyBox: { backgroundColor: '#fff', borderRadius: 13, padding: 10, marginTop: 10 }, sourcePolicyTitle: { color: '#16345f', fontSize: 12, fontWeight: '900' }, sourcePolicyText: { color: '#62738a', fontSize: 11, lineHeight: 16, marginTop: 3 },",
  );
  source = source.replace(
    "sectionBlock: { marginBottom: 18 },",
    "sectionBlock: { marginBottom: 18 }, discoveryCard: { backgroundColor: '#f4f8ff', borderWidth: 1, borderColor: '#cbdcf6', borderRadius: 19, padding: 14, marginBottom: 10 }, discoveryScore: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#0B66FF', alignItems: 'center', justifyContent: 'center' }, discoveryScoreValue: { color: '#fff', fontSize: 17, fontWeight: '900' }, discoveryScoreLabel: { color: '#dceaff', fontSize: 8, fontWeight: '800' }, discoveryStatus: { color: '#0B66FF', fontSize: 10, lineHeight: 14, fontWeight: '900', marginTop: 10 }, discoveryReason: { color: '#40536f', fontSize: 12, lineHeight: 18, marginTop: 4 }, discoveryTime: { color: '#7b889d', fontSize: 10, marginTop: 8 },",
  );
  source = source.replace(
    "action: { color: '#16345f', fontSize: 15, lineHeight: 20, fontWeight: '900', marginTop: 2 },",
    "action: { color: '#16345f', fontSize: 15, lineHeight: 20, fontWeight: '900', marginTop: 2 }, ageText: { color: '#7b889d', fontSize: 9, lineHeight: 13, marginTop: 3 }, timeContext: { backgroundColor: '#f3f7fc', borderRadius: 14, padding: 11, marginBottom: 12 }, timeTitle: { color: '#16345f', fontSize: 12, fontWeight: '900' }, timeText: { color: '#6b7b90', fontSize: 11, lineHeight: 16, marginTop: 3 }, metricNote: { backgroundColor: '#fff7e5', borderRadius: 14, padding: 11, marginBottom: 10 }, metricNoteTitle: { color: '#976500', fontSize: 11, fontWeight: '900', marginBottom: 3 },",
  );
  write('src/OpportunitiesView.js', source);
}

function patchVersions() {
  const appPath = path.join(root, 'app.json');
  const app = JSON.parse(fs.readFileSync(appPath, 'utf8'));
  app.expo.version = '0.9.0';
  app.expo.android.versionCode = 18;
  app.expo.ios.buildNumber = '18';
  fs.writeFileSync(appPath, `${JSON.stringify(app, null, 2)}\n`);

  const packagePath = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  pkg.version = '0.9.0';
  pkg.scripts.postinstall = 'node scripts/apply-v065-native-ui-fix.js && node scripts/apply-v070-opportunities.js && node scripts/apply-v071-live-sync.js && node scripts/apply-v080-autonomous-decisions.js && node scripts/apply-v081-position-performance.js && node scripts/apply-v081b-fix-source-newline.js && node scripts/apply-v090-discovery-clarity.js';
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

patchPortfolio();
patchDecisionGate();
patchFeedStore();
patchOpportunities();
patchVersions();

const portfolio = read('PortfolioApp.js');
const decision = read('DecisionOverlay.js');
const opportunities = read('src/OpportunitiesView.js');
const store = read('src/intelligence-feed-store.js');
if (!portfolio.includes("const VERSION = '0.9.0';")) throw new Error('v0.9.0 verification failed: Portfolio version');
if (!portfolio.includes('Διαφάνεια τιμής')) throw new Error('v0.9.0 verification failed: quote transparency');
if (!portfolio.includes("performanceStack: { width: '100%'")) throw new Error('v0.9.0 verification failed: full-width performance');
if (!decision.includes('ΝΕΑ ΑΓΟΡΑ: ΟΧΙ')) throw new Error('v0.9.0 verification failed: Decision Gate scope');
if (!opportunities.includes('Ραντάρ νέων μετοχών')) throw new Error('v0.9.0 verification failed: discovery radar UI');
if (!store.includes('SUPPORTED_FEED_VERSIONS')) throw new Error('v0.9.0 verification failed: feed v2 compatibility');
console.log('Investor Control v0.9.0 discovery radar and clarity patch applied.');
