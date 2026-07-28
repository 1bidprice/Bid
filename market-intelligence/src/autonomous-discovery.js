import { fetchSecCompanyUniverse } from './adapters/sec-company-universe.js';
import { fetchSecCurrentFilings } from './adapters/sec-current-filings.js';
import { sourcePolicySummary } from './source-policy.js';

export const DISCOVERY_POLICY_VERSION = '2026-07-28.2';

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
});

const TITLE_BOOSTS = Object.freeze([
  { pattern: /merger|acquisition|tender offer|strategic alternatives/i, score: 24, reason: 'Συγχώνευση, εξαγορά ή στρατηγική συναλλαγή' },
  { pattern: /bankruptcy|chapter 11|going concern/i, score: 28, reason: 'Οξύς κίνδυνος χρηματοδότησης ή συνέχισης δραστηριότητας' },
  { pattern: /guidance|earnings|results|revenue|profit/i, score: 17, reason: 'Νέα αποτελέσματα ή καθοδήγηση διοίκησης' },
  { pattern: /offering|registration|prospectus|dilution/i, score: 20, reason: 'Πιθανή χρηματοδότηση ή αραίωση μετοχών' },
  { pattern: /buyback|repurchase|dividend/i, score: 15, reason: 'Αλλαγή στην κατανομή κεφαλαίου' },
  { pattern: /clinical|trial|fda|approval/i, score: 22, reason: 'Ρυθμιστικός ή κλινικός καταλύτης' },
  { pattern: /contract|award|order|partnership/i, score: 15, reason: 'Νέα εμπορική συμφωνία ή ανάθεση' },
]);

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function hoursOld(now, value) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? Math.max(0, (now.getTime() - time) / 3_600_000) : Number.POSITIVE_INFINITY;
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
      `Νέα επίσημη κατάθεση ${record.form} στη SEC`,
      ...boosts.map((item) => item.reason),
      freshnessHours <= 8 ? 'Το γεγονός είναι πολύ πρόσφατο' : null,
      boosts.length === 0 ? 'Απαιτείται ανάγνωση της κατάθεσης για να προσδιοριστεί η ουσία του γεγονότος' : null,
    ]),
    freshnessHours,
  };
}

function mergeEventsByCompany(records, companyByCik, now) {
  const grouped = new Map();
  for (const record of records) {
    const company = companyByCik.get(record.cik);
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
  return {
    discoveryId: `discovery:${item.company.companyId}:${String(item.latestEventAt || '').slice(0, 10)}`,
    companyId: item.company.companyId,
    companyName: item.company.displayName || item.company.legalName,
    symbol: item.company.primaryListing?.symbol || null,
    exchange: item.company.primaryListing?.exchange || null,
    cik: item.company.cik,
    discoveryScore: item.discoveryScore,
    status: 'DISCOVERED_RESEARCH_REQUIRED',
    suggestedAction: 'WATCH',
    suggestedActionLabel: 'Παρακολούθηση μέχρι πλήρη ανάλυση',
    isExistingFocusCompany: seedCompanyIds.has(item.company.companyId),
    reasons: item.reasons,
    latestEventAt: item.latestEventAt,
    events: item.events.map((event) => ({
      form: event.form,
      title: event.title,
      publishedAt: event.publishedAt,
      sourceUrl: event.sourceUrl,
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

  const [universeResult, filingsResult] = await Promise.all([
    fetchSecCompanyUniverse({ fetchImpl, userAgent: secUserAgent, generatedAt }),
    fetchSecCurrentFilings({ fetchImpl, userAgent: secUserAgent, retrievedAt: generatedAt }),
  ]);
  diagnostics.push(...(universeResult.diagnostics || []), ...(filingsResult.diagnostics || []));

  const companyByCik = new Map((universeResult.companies || []).map((company) => [company.cik, company]));
  const maxEventAgeHours = Math.max(1, Number(options.maxEventAgeHours ?? 36));
  const recentRecords = (filingsResult.records || []).filter((record) => hoursOld(now, record.publishedAt) <= maxEventAgeHours);
  const grouped = mergeEventsByCompany(recentRecords, companyByCik, now)
    .sort((a, b) => b.discoveryScore - a.discoveryScore || String(b.latestEventAt).localeCompare(String(a.latestEventAt)));

  const minimumScore = Math.max(0, Number(options.minimumScore ?? 58));
  const shortlistLimit = Math.max(1, Number(options.shortlistLimit ?? 12));
  const deepAnalysisLimit = Math.max(0, Number(options.deepAnalysisLimit ?? 5));
  const shortlist = grouped
    .filter((item) => item.discoveryScore >= minimumScore)
    .slice(0, shortlistLimit)
    .map((item) => candidateOutput(item, seedCompanyIds));

  const discoveredCompanyIds = new Set(shortlist.filter((item) => !item.isExistingFocusCompany).slice(0, deepAnalysisLimit).map((item) => item.companyId));
  const discoveredCompanies = (universeResult.companies || [])
    .filter((company) => discoveredCompanyIds.has(company.companyId))
    .map((company) => ({
      ...company,
      discovery: shortlist.find((item) => item.companyId === company.companyId) || null,
    }));

  return {
    format: 'investor-control-autonomous-discovery',
    version: 1,
    policyVersion: DISCOVERY_POLICY_VERSION,
    generatedAt,
    sourcePolicy: sourcePolicySummary(),
    registryCompanyCount: universeResult.companies?.length || 0,
    filingEventCount: recentRecords.length,
    candidateCount: shortlist.length,
    deepAnalysisCompanyCount: discoveredCompanies.length,
    shortlist,
    discoveredCompanies,
    diagnostics,
  };
}
