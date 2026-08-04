export const MOBILE_QUOTE_CONTRACT_VERSION = '2026-08-04.1';

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
  if (status === 'TIMESTAMP_NOT_VERIFIED') return 'Ο χρόνος της τιμής δεν έχει επιβεβαιωθεί επαρκώς.';
  if (status === 'OFFICIAL_DELAYED_OR_EXCHANGE') {
    return Number(quote.advertisedDelayMinutes || 0) > 0
      ? `Επίσημη χρηματιστηριακή τιμή με δηλωμένη καθυστέρηση ${Number(quote.advertisedDelayMinutes)} λεπτών.`
      : 'Επίσημη χρηματιστηριακή τιμή.';
  }
  return 'Επαληθευμένη χρηματιστηριακή τιμή από εγκεκριμένη πηγή.';
}

export function buildMobileQuoteContract(symbol, quote = {}, options = {}) {
  const inherited = quote?.quoteContract && typeof quote.quoteContract === 'object'
    ? quote.quoteContract
    : null;
  if (inherited?.version && inherited?.valuationEligible !== undefined) return inherited;

  const role = sourceRole(quote);
  const price = positive(quote.nativePrice ?? quote.price);
  const ageHours = quoteAgeHours(quote, options.now || Date.now());
  const maxAgeHours = Number(options.maxAgeHours ?? (String(symbol).endsWith('.GR') ? 6 : 4));
  const timestampVerified = quote.priceTimestampVerified !== false && ageHours !== null;
  const stale = quote.status === 'stale' || ageHours === null || ageHours > maxAgeHours;
  const sourceApproved = [SOURCE_ROLES.PRIMARY_EXCHANGE, SOURCE_ROLES.LICENSED_MARKET_DATA].includes(role);
  const valuationEligible = price !== null && !stale && sourceApproved;
  const decisionEligible = valuationEligible && timestampVerified;
  const previousClose = positive(quote.nativePreviousClose ?? quote.previousClose);
  const dayChangeEligible = decisionEligible && quote.dayChangeVerified !== false && previousClose !== null;

  const status = price === null
    ? 'UNAVAILABLE'
    : stale
      ? 'STALE'
      : role === SOURCE_ROLES.FALLBACK_UNVERIFIED
        ? 'FALLBACK_NOT_VERIFIED'
        : !timestampVerified
          ? 'TIMESTAMP_NOT_VERIFIED'
          : role === SOURCE_ROLES.PRIMARY_EXCHANGE
            ? 'OFFICIAL_DELAYED_OR_EXCHANGE'
            : 'VERIFIED';

  const diagnosticCodes = [];
  if (price === null) diagnosticCodes.push('QUOTE_PRICE_MISSING');
  if (ageHours === null) diagnosticCodes.push('QUOTE_TIMESTAMP_MISSING');
  if (stale) diagnosticCodes.push('QUOTE_STALE');
  if (!sourceApproved) diagnosticCodes.push('QUOTE_SOURCE_NOT_APPROVED');
  if (!timestampVerified) diagnosticCodes.push('QUOTE_TIMESTAMP_NOT_VERIFIED');
  if (previousClose === null) diagnosticCodes.push('PREVIOUS_CLOSE_NOT_VERIFIED');

  return {
    version: MOBILE_QUOTE_CONTRACT_VERSION,
    sourceRole: role,
    sourceApproved,
    timestampVerified,
    valuationEligible,
    decisionEligible,
    dayChangeEligible,
    publicStatus: status,
    publicMessage: safePublicMessage(status, quote),
    diagnosticCodes: [...new Set(diagnosticCodes)],
  };
}

export function quoteFromRegistry(symbol, entry) {
  if (!entry || typeof entry !== 'object') return null;
  const inherited = entry.quoteContract && typeof entry.quoteContract === 'object'
    ? entry.quoteContract
    : null;
  if (inherited?.valuationEligible !== true) return null;
  const nativePrice = positive(entry.price);
  if (nativePrice === null || !entry.quoteAt) return null;
  const role = inherited.sourceRole || SOURCE_ROLES.UNKNOWN;
  return {
    symbol,
    nativePrice,
    nativePreviousClose: positive(entry.previousClose),
    nativeChangeBase: positive(entry.previousClose),
    nativeRegularMarketPrice: nativePrice,
    nativeCurrency: entry.currency || (String(symbol).endsWith('.US') ? 'USD' : 'EUR'),
    updatedAt: entry.quoteAt,
    checkedAt: entry.checkedAt || entry.quoteAt,
    source: entry.source || 'Investor Control canonical quote registry',
    providerSymbol: entry.appSymbol || symbol,
    quality: role === SOURCE_ROLES.PRIMARY_EXCHANGE ? 'delayed15' : 'realtime',
    session: 'regular-market',
    priceTimestampVerified: inherited.timestampVerified !== false,
    dayChangeVerified: inherited.dayChangeEligible === true,
    quoteContract: inherited,
    canonicalRegistry: true,
  };
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
