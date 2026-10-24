import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

export const INTELLIGENCE_FEED_STORAGE_KEY = 'investor-control.intelligence-feed.v1';
export const INTELLIGENCE_SYNC_STORAGE_KEY = 'investor-control.intelligence-sync.v1';
export const DEFAULT_INTELLIGENCE_FEED_URL = 'https://raw.githubusercontent.com/1bidprice/Bid/investor-control-live-feed/mobile-intelligence-feed.json';

const FEED_FORMAT = 'investor-control-mobile-intelligence-feed';
const LEGACY_FEED_VERSION = 1;
const FEED_VERSION = 2;
const SUPPORTED_FEED_VERSIONS = new Set([LEGACY_FEED_VERSION, FEED_VERSION]);
const MAX_FEED_BYTES = 2_000_000;
const DEFAULT_TIMEOUT_MS = 15_000;

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

const OPPORTUNITY_PURCHASE_STATUSES = new Set([
  'BUY_CONFIRMED',
  'WAIT_FOR_ENTRY_CONFIRMATION',
  'REJECTED',
  'BLOCKED',
  'NO_DEEP_DOSSIER',
]);

function normalizeOpportunityPurchaseDecision(item) {
  const rawStatus = OPPORTUNITY_PURCHASE_STATUSES.has(item?.status) ? item.status : 'BLOCKED';
  const strictAction = item?.strictAction && typeof item.strictAction === 'object' ? item.strictAction : null;
  const strictBuyConfirmed = rawStatus === 'BUY_CONFIRMED'
    && item?.buyNowEligible === true
    && strictAction?.status === 'FINAL'
    && strictAction?.nonHolderAction === 'BUY_NOW';
  const status = rawStatus === 'BUY_CONFIRMED' && !strictBuyConfirmed ? 'BLOCKED' : rawStatus;
  const statusLabel = status === rawStatus && item?.statusLabel
    ? String(item.statusLabel)
    : status === 'BLOCKED'
      ? 'ΜΠΛΟΚΑΡΙΣΜΕΝΟ — ΛΕΙΠΟΥΝ ΕΛΕΓΧΟΙ'
      : String(item?.statusLabel || status);
  return {
    ...item,
    instrumentId: item?.instrumentId || item?.companyId || null,
    companyId: item?.companyId || item?.instrumentId || null,
    companyName: item?.companyName || item?.displayName || null,
    status,
    statusLabel,
    buyNowEligible: status === 'BUY_CONFIRMED' && strictBuyConfirmed,
    strictAction,
    whyNotBuyNow: safeArray(item?.whyNotBuyNow),
    nextGate: item?.nextGate || null,
    automaticBrokerOrder: false,
  };
}

function normalizeItem(item) {
  const status = ['DRAFT_RESEARCH', 'REVIEW_READY', 'PUBLISHED'].includes(item?.status)
    ? item.status
    : 'DRAFT_RESEARCH';
  return {
    ...item,
    status,
    action: status === 'DRAFT_RESEARCH' ? 'WATCH' : item?.action || 'WATCH',
    blockers: safeArray(item?.blockers),
    blockerLabels: safeArray(item?.blockerLabels),
    catalysts: safeArray(item?.catalysts),
    risks: safeArray(item?.risks),
    sources: safeArray(item?.sources),
    finalAction: item?.finalAction && typeof item.finalAction === 'object' ? item.finalAction : null,
    publicationMode: item?.publicationMode || null,
    origin: item?.origin === 'AUTONOMOUS_DISCOVERY' ? 'AUTONOMOUS_DISCOVERY' : 'FOCUS_UNIVERSE',
    discovery: item?.discovery && typeof item.discovery === 'object' ? item.discovery : null,
    referencePriceAgeHours: Number.isFinite(Number(item?.referencePriceAgeHours)) ? Number(item.referencePriceAgeHours) : null,
    metricNotes: safeArray(item?.metricNotes),
    marketQuote: item?.marketQuote && typeof item.marketQuote === 'object' ? item.marketQuote : null,
  };
}

export function normalizeIntelligenceFeed(payload) {
  if (payload?.format !== FEED_FORMAT || !SUPPORTED_FEED_VERSIONS.has(Number(payload?.version))) {
    throw new Error('Η ληφθείσα ροή δεν είναι έγκυρη ροή Market Intelligence του Investor Control.');
  }
  const generatedAt = new Date(payload.generatedAt);
  if (Number.isNaN(generatedAt.getTime())) throw new Error('Η ροή δεν έχει έγκυρη ημερομηνία δημιουργίας.');
  const published = safeArray(payload.published).map(normalizeItem).filter((item) => item.status === 'PUBLISHED');
  const reviewReady = safeArray(payload.reviewReady).map(normalizeItem).filter((item) => item.status === 'REVIEW_READY');
  const research = safeArray(payload.research).map(normalizeItem).filter((item) => item.status === 'DRAFT_RESEARCH');
  const urgentIds = new Set(safeArray(payload.urgent).map((item) => item?.id).filter(Boolean));
  const all = [...published, ...reviewReady, ...research];
  const urgent = all.filter((item) => urgentIds.has(item.id));
  const decisions = all.filter((item) => item.finalAction?.status === 'FINAL');
  const discoveryRadar = safeArray(payload.discoveryRadar).map((item) => ({ ...item, reasons: safeArray(item?.reasons), events: safeArray(item?.events), suggestedAction: 'WATCH', scoreType: item?.scoreType || 'DISCOVERY_PRIORITY', scoreLabel: item?.scoreLabel || 'Προτεραιότητα διερεύνησης', investmentScore: null }));
  const quoteRegistry = payload.quoteRegistry && typeof payload.quoteRegistry === 'object'
    ? Object.fromEntries(Object.entries(payload.quoteRegistry).filter(([, item]) => item && typeof item === 'object'))
    : {};
  const opportunityPurchaseDecisions = safeArray(payload.opportunityPurchaseDecisions).map(normalizeOpportunityPurchaseDecision);
  const confirmedBuyOpportunities = opportunityPurchaseDecisions.filter((item) => item.status === 'BUY_CONFIRMED' && item.buyNowEligible === true);
  const waitingEntryOpportunities = opportunityPurchaseDecisions.filter((item) => item.status === 'WAIT_FOR_ENTRY_CONFIRMATION');
  const rejectedOpportunities = opportunityPurchaseDecisions.filter((item) => item.status === 'REJECTED');
  const blockedOpportunities = opportunityPurchaseDecisions.filter((item) => ['BLOCKED', 'NO_DEEP_DOSSIER'].includes(item.status));
  return {
    format: FEED_FORMAT,
    version: FEED_VERSION,
    generatedAt: generatedAt.toISOString(),
    policyVersion: payload.policyVersion || null,
    sourceSelection: payload.sourceSelection && typeof payload.sourceSelection === 'object' ? payload.sourceSelection : null,
    operationalHealth: payload.operationalHealth && typeof payload.operationalHealth === 'object' ? payload.operationalHealth : null,
    sourceHealth: payload.sourceHealth && typeof payload.sourceHealth === 'object' ? payload.sourceHealth : null,
    quoteRegistry,
    summary: {
      publishedCount: published.length,
      reviewReadyCount: reviewReady.length,
      researchCount: research.length,
      urgentCount: urgent.length,
      opportunityCandidateCount: opportunityPurchaseDecisions.length,
      confirmedBuyOpportunityCount: confirmedBuyOpportunities.length,
      waitingEntryOpportunityCount: waitingEntryOpportunities.length,
      rejectedOpportunityCount: rejectedOpportunities.length,
      blockedOpportunityCount: blockedOpportunities.length,
      discoveryCandidateCount: discoveryRadar.length,
      discoveryDeepAnalysisCount: Math.max(0, Number(payload.summary?.discoveryDeepAnalysisCount || 0)),
      unresolvedDiagnosticCount: Math.max(0, Number(payload.summary?.unresolvedDiagnosticCount || 0)),
      finalActionCount: Math.max(0, Number(payload.summary?.finalActionCount || decisions.length)),
      buyNowCount: Math.max(0, Number(payload.summary?.buyNowCount || 0)),
      sellNowCount: Math.max(0, Number(payload.summary?.sellNowCount || 0)),
      holdCount: Math.max(0, Number(payload.summary?.holdCount || 0)),
      doNotBuyCount: Math.max(0, Number(payload.summary?.doNotBuyCount || 0)),
      avoidCount: Math.max(0, Number(payload.summary?.avoidCount || 0)),
      blockedDecisionCount: Math.max(0, Number(payload.summary?.blockedDecisionCount || 0)),
    },
    today: payload.today && typeof payload.today === 'object'
      ? payload.today
      : { headline: 'Δεν υπάρχει διαθέσιμη σύνοψη.', primaryItem: null },
    discoveryRadar,
    opportunityPurchaseDecisions,
    confirmedBuyOpportunities,
    waitingEntryOpportunities,
    rejectedOpportunities,
    blockedOpportunities,
    decisions,
    published,
    reviewReady,
    research,
    urgent,
    opportunityAssistantContext: opportunityPurchaseDecisions.map((item) => ({
      companyId: item.companyId,
      companyName: item.companyName,
      symbol: item.symbol,
      tier: item.tier,
      opportunityScore: item.opportunityScore,
      status: item.status,
      buyNowEligible: item.buyNowEligible,
      whyNotBuyNow: item.whyNotBuyNow,
      nextGate: item.nextGate,
      strictAction: item.strictAction,
    })),
    assistantContext: safeArray(payload.assistantContext),
    disclosure: String(payload.disclosure || ''),
  };
}

export function intelligenceFeedFreshness(feed, nowInput = Date.now()) {
  if (!feed?.generatedAt) return { state: 'missing', ageHours: null, label: 'Δεν υπάρχει ροή' };
  const ageMs = Number(new Date(nowInput)) - new Date(feed.generatedAt).getTime();
  const ageHours = Math.max(0, ageMs / 3_600_000);
  if (ageHours <= 4) return { state: 'fresh', ageHours, label: 'Ενημερωμένη' };
  if (ageHours <= 12) return { state: 'delayed', ageHours, label: 'Καθυστερημένη ενημέρωση' };
  return { state: 'stale', ageHours, label: 'Παρωχημένη ροή' };
}

export async function loadCachedIntelligenceFeed() {
  const raw = await AsyncStorage.getItem(INTELLIGENCE_FEED_STORAGE_KEY);
  if (!raw) return null;
  try {
    return normalizeIntelligenceFeed(JSON.parse(raw));
  } catch {
    await AsyncStorage.removeItem(INTELLIGENCE_FEED_STORAGE_KEY);
    return null;
  }
}

export async function loadIntelligenceSyncState() {
  const raw = await AsyncStorage.getItem(INTELLIGENCE_SYNC_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    await AsyncStorage.removeItem(INTELLIGENCE_SYNC_STORAGE_KEY);
    return null;
  }
}

async function saveSyncState(next) {
  const normalized = {
    sourceUrl: DEFAULT_INTELLIGENCE_FEED_URL,
    status: 'idle',
    lastAttemptAt: null,
    lastSuccessAt: null,
    feedGeneratedAt: null,
    lastError: null,
    ...next,
  };
  await AsyncStorage.setItem(INTELLIGENCE_SYNC_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export async function cacheIntelligenceFeed(feed, syncState = null) {
  const normalized = normalizeIntelligenceFeed(feed);
  await AsyncStorage.setItem(INTELLIGENCE_FEED_STORAGE_KEY, JSON.stringify(normalized));
  if (syncState) await saveSyncState({ ...syncState, feedGeneratedAt: normalized.generatedAt });
  return normalized;
}

function validateRemoteUrl(url) {
  const value = String(url || '').trim();
  if (!value.startsWith('https://raw.githubusercontent.com/1bidprice/Bid/investor-control-live-feed/')) {
    throw new Error('Η διεύθυνση της ροής δεν ανήκει στο εγκεκριμένο κανάλι του Investor Control.');
  }
  return value;
}

export async function syncIntelligenceFeedAsync(options = {}) {
  const sourceUrl = validateRemoteUrl(options.url || DEFAULT_INTELLIGENCE_FEED_URL);
  const timeoutMs = Math.max(5_000, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
  const attemptedAt = new Date().toISOString();
  const previousSync = await loadIntelligenceSyncState();
  await saveSyncState({ ...previousSync, sourceUrl, status: 'syncing', lastAttemptAt: attemptedAt, lastError: null });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const separator = sourceUrl.includes('?') ? '&' : '?';
    const response = await fetch(`${sourceUrl}${separator}ts=${Date.now()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Η υπηρεσία ενημέρωσης απάντησε με κωδικό ${response.status}.`);

    const text = await response.text();
    if (!text || text.length > MAX_FEED_BYTES) throw new Error('Η ληφθείσα ροή έχει μη επιτρεπτό μέγεθος.');
    const incoming = normalizeIntelligenceFeed(JSON.parse(text));
    const cached = await loadCachedIntelligenceFeed();
    const incomingTime = new Date(incoming.generatedAt).getTime();
    const cachedTime = cached ? new Date(cached.generatedAt).getTime() : 0;
    const feed = cachedTime > incomingTime ? cached : incoming;
    const changed = !cached || cached.generatedAt !== feed.generatedAt;
    if (feed === incoming) await AsyncStorage.setItem(INTELLIGENCE_FEED_STORAGE_KEY, JSON.stringify(incoming));

    const syncState = await saveSyncState({
      sourceUrl,
      status: cachedTime > incomingTime ? 'cache_newer' : 'success',
      lastAttemptAt: attemptedAt,
      lastSuccessAt: new Date().toISOString(),
      feedGeneratedAt: feed.generatedAt,
      lastError: null,
    });
    return { feed, syncState, changed };
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? 'Η σύνδεση με τη ροή έληξε πριν ολοκληρωθεί.'
      : error instanceof SyntaxError
        ? 'Η υπηρεσία επέστρεψε κατεστραμμένο JSON.'
        : String(error?.message || error);
    const syncState = await saveSyncState({
      ...previousSync,
      sourceUrl,
      status: 'error',
      lastAttemptAt: attemptedAt,
      lastError: message,
    });
    const wrapped = new Error(message);
    wrapped.syncState = syncState;
    throw wrapped;
  } finally {
    clearTimeout(timeout);
  }
}

export async function importIntelligenceFeedAsync() {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/json', 'text/plain'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset?.uri) throw new Error('Δεν επιλέχθηκε έγκυρο αρχείο.');
  const text = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.UTF8 });
  if (!text || text.length > MAX_FEED_BYTES) throw new Error('Το αρχείο έχει μη επιτρεπτό μέγεθος.');
  const normalized = normalizeIntelligenceFeed(JSON.parse(text));
  await AsyncStorage.setItem(INTELLIGENCE_FEED_STORAGE_KEY, JSON.stringify(normalized));
  await saveSyncState({
    sourceUrl: 'manual-import',
    status: 'manual',
    lastAttemptAt: new Date().toISOString(),
    lastSuccessAt: new Date().toISOString(),
    feedGeneratedAt: normalized.generatedAt,
    lastError: null,
  });
  return normalized;
}

export async function clearIntelligenceFeed() {
  await Promise.all([
    AsyncStorage.removeItem(INTELLIGENCE_FEED_STORAGE_KEY),
    AsyncStorage.removeItem(INTELLIGENCE_SYNC_STORAGE_KEY),
  ]);
}
