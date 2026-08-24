import { evaluateMobileQuoteIntegrity, mobileQuotePublicMessage } from './instrument-quote-integrity';

export const MOBILE_QUOTE_CONTRACT_VERSION = '2026-08-20.2';

const SOURCE_ROLES = Object.freeze({
  PRIMARY_EXCHANGE: 'PRIMARY_EXCHANGE',
  LICENSED_MARKET_DATA: 'LICENSED_MARKET_DATA',
  FALLBACK_UNVERIFIED: 'FALLBACK_UNVERIFIED',
  UNKNOWN: 'UNKNOWN',
});

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positive(value) {
  const number = finite(value);
  return number !== null && number > 0 ? number : null;
}

function sourceRole(quote = {}) {
  const existing = quote?.quoteContract?.sourceRole;
  if (existing) return existing;
  const source = String(quote.source || '').toLowerCase();
  const quality = String(quote.quality || quote.sourceQuality || '').toLowerCase();
  if (source.includes('euronext') || quality.includes('primary_exchange')) return SOURCE_ROLES.PRIMARY_EXCHANGE;
  if (source.includes('finnhub') || quality.includes('primary_licensed') || quality === 'realtime') return SOURCE_ROLES.LICENSED_MARKET_DATA;
  if (source.includes('yahoo') || quality.includes('fallback') || quality === 'unofficial') return SOURCE_ROLES.FALLBACK_UNVERIFIED;
  return SOURCE_ROLES.UNKNOWN;
}

function quoteAgeHours(quote = {}, now = Date.now()) {
  const timestamp = new Date(quote.updatedAt || quote.quoteAt || 0).getTime();
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return Math.max(0, (Number(new Date(now)) - timestamp) / 3_600_000);
}

function safePublicMessage(status, quote = {}) {
  if (status === 'UNAVAILABLE') return 'Δεν υπάρχει διαθέσιμη και επαληθεύσιμη τιμή.';
  if (status === 'STALE') return 'Η τιμή είναι παρωχημένη και δεν χρησιμοποιείται σε αποτίμηση ή απόφαση.';
  if (status === 'FALLBACK_NOT_VERIFIED') return 'Η εφεδρική τιμή εμφανίζεται μόνο πληροφοριακά και δεν χρησιμοποιείται σε αποτίμηση ή τελική απόφαση.';
  if (status === 'TIMESTAMP_NOT_VERIFIED') {
    const delay = Number(quote.advertisedDelayMinutes || 0);
    return delay > 0
      ? `Επίσημη τιμή αναφοράς με δηλωμένη καθυστέρηση ${delay}′. Ο ακριβής χρόνος της τιμής δεν έχει επαληθευτεί.`
      : 'Τιμή αναφοράς από εγκεκριμένη πηγή, αλλά ο ακριβής χρόνος της τιμής δεν έχει επαληθευτεί.';
  }
  if (status === 'OFFICIAL_DELAYED_OR_EXCHANGE') {
    return Number(quote.advertisedDelayMinutes || 0) > 0
      ? `Επίσημη χρηματιστηριακή τιμή με δηλωμένη καθυστέρηση ${Number(quote.advertisedDelayMinutes)} λεπτών.`
      : 'Επίσημη χρηματιστηριακή τιμή.';
  }
  return 'Επαληθευμένη χρηματιστηριακή τιμή από εγκεκριμένη πηγή.';
}

export function buildMobileQuoteContract(symbol, quote = {}, options = {}) {
  const integrity = evaluateMobileQuoteIntegrity(symbol, quote, options);
  const previousClose = positive(quote.nativePreviousClose ?? quote.previousClose);
  const dayChangeEligible = integrity.decisionReady === true
    && quote.dayChangeVerified !== false
    && quote?.quoteContract?.dayChangeEligible !== false
    && previousClose !== null;
  const diagnosticCodes = [...new Set([
    ...integrity.blockers,
    ...(previousClose === null ? ['PREVIOUS_CLOSE_NOT_VERIFIED'] : []),
    ...(Array.isArray(quote?.quoteContract?.diagnosticCodes) ? quote.quoteContract.diagnosticCodes : []),
  ])];
  return {
    version: MOBILE_QUOTE_CONTRACT_VERSION,
    integrityVersion: integrity.version,
    invariant: integrity.invariant,
    sourceRole: integrity.sourceRole,
    sourceApproved: integrity.sourceApproved,
    timestampVerified: integrity.timestampVerified,
    identityVerified: integrity.identityReady,
    valuationEligible: integrity.valuationReady,
    decisionEligible: integrity.decisionReady,
    dayChangeEligible,
    publicStatus: integrity.publicStatus,
    publicMessage: mobileQuotePublicMessage(integrity),
    diagnosticCodes,
    instrumentIntegrity: integrity,
  };
}

export function quoteFromRegistry(symbol, entry, options = {}) {
  if (!entry || typeof entry !== 'object') return null;
  const nativePrice = positive(entry.price);
  if (nativePrice === null || !entry.quoteAt) return null;
  const inherited = entry.quoteContract && typeof entry.quoteContract === 'object'
    ? entry.quoteContract
    : null;
  const role = inherited?.sourceRole || SOURCE_ROLES.UNKNOWN;
  const candidate = {
    symbol,
    nativePrice,
    nativePreviousClose: positive(entry.previousClose),
    nativeChangeBase: positive(entry.previousClose),
    nativeRegularMarketPrice: nativePrice,
    nativeCurrency: /^[A-Z]{3}$/.test(String(entry.currency || '').toUpperCase()) ? String(entry.currency).toUpperCase() : null,
    updatedAt: entry.quoteAt,
    checkedAt: entry.checkedAt || entry.quoteAt,
    source: entry.source || 'Investor Control canonical quote registry',
    providerSymbol: entry.providerSymbol || entry.appSymbol || symbol,
    quality: role === SOURCE_ROLES.PRIMARY_EXCHANGE ? 'delayed15' : 'realtime',
    session: 'regular-market',
    priceTimestampVerified: inherited?.timestampVerified === true,
    dayChangeVerified: inherited?.dayChangeEligible === true,
    quoteContract: inherited,
    canonicalRegistry: true,
  };
  const localContract = buildMobileQuoteContract(symbol, candidate, options);
  if (localContract.valuationEligible !== true) return null;
  return { ...candidate, quoteContract: localContract };
}

export function safeProviderDiagnostic(error, fallbackCode = 'PROVIDER_REQUEST_FAILED') {
  const message = String(error?.message || error || '').toLowerCase();
  if (message.includes('http 401') || message.includes('unauthorized')) return 'PROVIDER_AUTHORIZATION_FAILED';
  if (message.includes('http 403') || message.includes('forbidden')) return 'PROVIDER_ACCESS_DENIED';
  if (message.includes('abort') || message.includes('timeout')) return 'PROVIDER_TIMEOUT';
  if (message.includes('http 429') || message.includes('rate limit')) return 'PROVIDER_RATE_LIMITED';
  return fallbackCode;
}

export function quoteContractMessage(quote) {
  const contract = quote?.quoteContract || buildMobileQuoteContract(quote?.symbol || '', quote || {});
  return contract?.publicMessage || 'Δεν υπάρχει διαθέσιμη πληροφορία ποιότητας τιμής.';
}
