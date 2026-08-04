import { fetchSecCompanyUniverse } from './adapters/sec-company-universe.js';
import { fetchSecCurrentFilings } from './adapters/sec-current-filings.js';
import { fetchAthensDiscovery } from './adapters/euronext-athens-discovery.js';
import { sourcePolicySummary } from './source-policy.js';

export const DISCOVERY_POLICY_VERSION = '2026-08-04.1';

const FORM_SCORES = Object.freeze({
  '8-K': 55,
  '6-K': 52,
  '10-Q': 60,
  '10-K': 58,
  '20-F': 58,
  'S-1': 45,
  'S-3': 48,
  'S-3ASR': 52,
  '424B2': 42,
  '424B3': 45,
  '424B5': 48,
  'SC 13D': 66,
  'SC 13G': 50,
  'SC TO-I': 76,
  'SC TO-T': 76,
  'DEFM14A': 70,
  'PREM14A': 62,
  'DEF 14A': 38,
  ATHEX_ANNOUNCEMENT: 55,
});

const TITLE_BOOSTS = Object.freeze([
  { pattern: /merger|acquisition|tender offer|strategic alternatives|συγχώνευ|εξαγορ/i, score: 24, reason: 'Συγχώνευση, εξαγορά ή στρατηγική συναλλαγή' },
  { pattern: /bankruptcy|chapter 11|going concern|πτώχευση|συνέχιση δραστηριότητας/i, score: 28, reason: 'Οξύς κίνδυνος χρηματοδότησης ή συνέχισης δραστηριότητας' },
  { pattern: /guidance|earnings|results|revenue|profit|financial results|αποτελέσματα|έσοδα|κέρδ/i, score: 17, reason: 'Νέα αποτελέσματα ή καθοδήγηση διοίκησης' },
  { pattern: /offering|registration|prospectus|dilution|capital increase|share capital|αύξηση κεφαλαίου|ενημερωτικό δελτίο/i, score: 20, reason: 'Πιθανή χρηματοδότηση ή αραίωση μετοχών' },
  { pattern: /buyback|repurchase|treasury shares|own shares|dividend|ίδιων μετοχών|μέρισμα/i, score: 15, reason: 'Αλλαγή στην κατανομή κεφαλαίου' },
  { pattern: /clinical|trial|fda|approval|κλινικ|έγκριση/i, score: 22, reason: 'Ρυθμιστικός ή κλινικός καταλύτης' },
  { pattern: /contract|award|order|partnership|σύμβαση|ανάθεση|συνεργασία/i, score: 15, reason: 'Νέα εμπορική συμφωνία ή ανάθεση' },
]);

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function hoursOld(now, value) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? Math.max(0, (now.getTime() - time) / 3_600_000) : Number.POSITIVE_INFINITY;
}

function eventSourceLabel(record) {
  return record.form === 'ATHEX_ANNOUNCEMENT'
    ? 'Νέα επίσημη ανακοίνωση εκδότη στο Euronext Athens'
    : `Νέα επίσημη κατάθεση ${record.form} στη SEC`;
}

function eventScore(record, now) {
  const formScore = FORM_SCORES[record.form] ?? 32;
  const text = `${record.title || ''} ${record.summary || ''}`;
  const boosts = TITLE_BOOSTS.filter((item) => item.pattern.test(text));
  const freshnessHours = hoursOld(now, record.publishedAt);
  const freshnessScore = freshnessHours <= 2 ? 10 : freshnessHours <= 8 ? 7 : freshnessHours <= 24 ? 3 : 0;
  const multiSignalBonus = boosts.length >= 2 ? 6 : 0;
  const score = Math.max(0, Math.min(100, formScore + freshnessScore + multiSignalBonus + boosts.reduce((sum, item) => sum + item.score, 0)));
  return {
    score,
    reasons: unique([
      eventSourceLabel(record),
      ...boosts.map((item) => item.reason),
      freshnessHours <= 8 ? 'Το γεγονός είναι πολύ πρόσφατο' : null,
      boosts.length === 0 ? 'Απαιτείται ανάγνωση της ανακοίνωσης για να προσδιοριστεί η οικονομική ουσία του γεγονότος' : null,
    ]),
    freshnessHours,
  };
}

function mergeEventsByCompany(records, companyByIdentity, now) {
  const grouped = new Map();
  for (const record of records) {
    const company = companyByIdentity.get(record.companyId) || companyByIdentity.get(record.cik);
    if (!company) continue;
    const scored = eventScore(record, now);
    const current = grouped.get(company.companyId) || {
      company,
      events: [],
      discoveryScore: 0,
      reasons: [],
      latestEventAt: null,
    };
    current.events.push({ ...record, eventScore: scored.score, freshnessHours: scored.freshnessHours });
    current.discoveryScore = Math.max(current.discoveryScore, scored.score);
    current.reasons.push(...scored.reasons);
    if (!current.latestEventAt || record.publishedAt > current.latestEventAt) current.latestEventAt = record.publishedAt;
    grouped.set(company.companyId, current);
  }
  return [...grouped.values()].map((item) => ({
    ...item,
    reasons: unique(item.reasons),
    events: item.events.sort((a, b) => b.eventScore - a.eventScore || String(b.publishedAt).localeCompare(String(a.publishedAt))).slice(0, 5),
  }));
}

function candidateOutput(item, seedCompanyIds) {
  const market = item.company.primaryListing?.mic === 'XATH' ? 'GR' : 'US';
  const symbol = item.company.primaryListing?.symbol || null;
  return {
    discoveryId: `discovery:${item.company.companyId}:${String(item.latestEventAt || '').slice(0, 10)}`,
    companyId: item.company.companyId,
    companyName: item.company.displayName || item.company.legalName,
    symbol,
    exchange: item.company.primaryListing?.exchange || null,
    mic: item.company.primaryListing?.mic || null,
    market,
    cik: item.company.cik || null,
    issuerId: item.company.issuerId || null,
    identityStatus: symbol ? 'CANONICAL_IDENTITY_READY' : 'SYMBOL_RESOLUTION_REQUIRED',
    discoveryScore: item.discoveryScore,
    scoreType: 'DISCOVERY_PRIORITY',
    status: symbol ? 'DISCOVERED_RESEARCH_REQUIRED' : 'DISCOVERED_IDENTITY_REQUIRED',
    suggestedAction: 'WATCH',
    suggestedActionLabel: symbol ? 'Παρακολούθηση μέχρι πλήρη ανάλυση' : 'Αναμονή μέχρι επίσημη ταυτοποίηση συμβόλου',
    isExistingFocusCompany: seedCompanyIds.has(item.company.companyId),
    reasons: item.reasons,
    latestEventAt: item.latestEventAt,
    events: item.events.map((event) => ({
      form: event.form,
      title: event.title,
      publishedAt: event.publishedAt,
      sourceUrl: event.sourceUrl,
      sourceName: event.sourceName || (event.form === 'ATHEX_ANNOUNCEMENT' ? 'Euronext Athens' : 'SEC EDGAR'),
      eventScore: event.eventScore,
    })),
  };
}

export async function discoverAutonomousCandidates(options = {}) {
  const now = new Date(options.now || Date.now());
  const generatedAt = now.toISOString();
  const seedUniverse = Array.isArray(options.seedUniverse) ? options.seedUniverse : [];
  const seedCompanyIds = new Set(seedUniverse.map((company) => company.companyId));
  const diagnostics = [];
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const secUserAgent = options.secUserAgent || process.env.SEC_USER_AGENT || '';

  const [universeResult, filingsResult, athensResult] = await Promise.all([
    fetchSecCompanyUniverse({ fetchImpl, userAgent: secUserAgent, generatedAt }),
    fetchSecCurrentFilings({ fetchImpl, userAgent: secUserAgent, retrievedAt: generatedAt }),
    options.enableAthensDiscovery === false
      ? Promise.resolve({ companies: [], records: [], diagnostics: [] })
      : fetchAthensDiscovery({
        fetchImpl,
        generatedAt,
        userAgent: options.userAgent || secUserAgent || 'Investor-Control-Market-Intelligence/1.1',
        identityResolutionLimit: options.athensIdentityResolutionLimit ?? 12,
      }),
  ]);
  diagnostics.push(
    ...(universeResult.diagnostics || []),
    ...(filingsResult.diagnostics || []),
    ...(athensResult.diagnostics || []),
  );

  const allCompanies = [
    ...(universeResult.companies || []),
    ...(athensResult.companies || []),
  ];
  const companyByIdentity = new Map();
  for (const company of allCompanies) {
    companyByIdentity.set(company.companyId, company);
    if (company.cik) companyByIdentity.set(company.cik, company);
  }

  const maxEventAgeHours = Math.max(1, Number(options.maxEventAgeHours ?? 36));
  const recentRecords = [
    ...(filingsResult.records || []),
    ...(athensResult.records || []),
  ].filter((record) => hoursOld(now, record.publishedAt) <= maxEventAgeHours);
  const grouped = mergeEventsByCompany(recentRecords, companyByIdentity, now)
    .sort((a, b) => b.discoveryScore - a.discoveryScore || String(b.latestEventAt).localeCompare(String(a.latestEventAt)));

  const minimumScore = Math.max(0, Number(options.minimumScore ?? 58));
  const shortlistLimit = Math.max(1, Number(options.shortlistLimit ?? 12));
  const deepAnalysisLimit = Math.max(0, Number(options.deepAnalysisLimit ?? 5));
  const shortlist = grouped
    .filter((item) => item.discoveryScore >= minimumScore)
    .slice(0, shortlistLimit)
    .map((item) => candidateOutput(item, seedCompanyIds));

  const discoveredCompanyIds = new Set(shortlist
    .filter((item) => !item.isExistingFocusCompany && item.identityStatus === 'CANONICAL_IDENTITY_READY')
    .slice(0, deepAnalysisLimit)
    .map((item) => item.companyId));
  const discoveredCompanies = allCompanies
    .filter((company) => discoveredCompanyIds.has(company.companyId))
    .map((company) => ({
      ...company,
      discovery: shortlist.find((item) => item.companyId === company.companyId) || null,
    }));

  return {
    format: 'investor-control-autonomous-discovery',
    version: 2,
    policyVersion: DISCOVERY_POLICY_VERSION,
    generatedAt,
    sourcePolicy: sourcePolicySummary(),
    marketsScanned: ['US', 'GR'],
    sourceScanners: {
      secEdgar: true,
      euronextAthens: options.enableAthensDiscovery !== false,
    },
    registryCompanyCount: allCompanies.length,
    secRegistryCompanyCount: universeResult.companies?.length || 0,
    athensActiveIssuerCount: athensResult.companies?.length || 0,
    filingEventCount: recentRecords.length,
    secFilingEventCount: (filingsResult.records || []).filter((record) => hoursOld(now, record.publishedAt) <= maxEventAgeHours).length,
    athensAnnouncementEventCount: (athensResult.records || []).filter((record) => hoursOld(now, record.publishedAt) <= maxEventAgeHours).length,
    candidateCount: shortlist.length,
    unresolvedIdentityCount: shortlist.filter((item) => item.identityStatus !== 'CANONICAL_IDENTITY_READY').length,
    deepAnalysisCompanyCount: discoveredCompanies.length,
    shortlist,
    discoveredCompanies,
    diagnostics,
  };
}
