export const MOBILE_QUOTE_CONTRACT_VERSION = '2026-08-07.1';

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
  if (source.includes('euronext') || quality.includes('primary_exchange') || quality.includes('official_delayed')) return SOURCE_ROLES.PRIMARY_EXCHANGE;
  if (source.includes('finnhub') || quality.includes('primary_licensed') || quality === 'realtime') return SOURCE_ROLES.LICENSED_MARKET_DATA;
  if (source.includes('yahoo') || quality.includes('fallback') || quality === 'unofficial') return SOURCE_ROLES.FALLBACK_UNVERIFIED;
  return SOURCE_ROLES.UNKNOWN;
}

function quoteAgeHours(quote = {}, now = Date.now()) {
  const timestamp = new Date(quote.updatedAt || quote.quoteAt || 0).getTime();
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return Math.max(0, (Number(new Date(now)) - timestamp) / 3_600_000);
}

function zoneParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    weekday: values.weekday,
    minutes: Number(values.hour) * 60 + Number(values.minute),
  };
}

function exchangeOpenNow(symbol, now = Date.now()) {
  try {
    const us = String(symbol).endsWith('.US');
    const parts = zoneParts(new Date(now), us ? 'America/New_York' : 'Europe/Athens');
    if (['Sat', 'Sun'].includes(parts.weekday)) return false;
    if (us) return parts.minutes >= 9 * 60 + 30 && parts.minutes < 16 * 60;
    return parts.minutes >= 10 * 60 + 15 && parts.minutes < 17 * 60 + 25;
  } catch (_) {
    return true;
  }
}

function safePublicMessage(status, quote = {}, context = {}) {
  if (status === 'UNAVAILABLE') return 'Δεν υπάρχει διαθέσιμη και επαληθεύσιμη τιμή.';
  if (status === 'STALE') return 'Η τελευταία επαληθευμένη τιμή είναι πλέον πολύ παλιά και δεν χρησιμοποιείται ούτε στην αποτίμηση ούτε σε απόφαση.';
  if (status === 'FALLBACK_NOT_VERIFIED') return 'Η εφεδρική τιμή εμφανίζεται μόνο πληροφοριακά και δεν χρησιμοποιείται σε αποτίμηση ή τελική απόφαση.';
  if (status === 'TIMESTAMP_NOT_VERIFIED') return 'Ο χρόνος της τιμής δεν έχει επιβεβαιωθεί επαρκώς για τελική απόφαση.';
  if (status === 'VERIFIED_CLOSE') return context.decisionEligible
    ? 'Επαληθευμένη τελευταία τιμή κλεισίματος. Χρησιμοποιείται στην αποτίμηση και παραμένει εντός του αυστηρού χρονικού ορίου ελέγχου.'
    : 'Επαληθευμένη τελευταία τιμή κλεισίματος. Χρησιμοποιείται στην αποτίμηση, αλλά όχι ως live τιμή ή ως βάση τελικής ενέργειας.';
  if (status === 'VERIFIED_REFERENCE') return 'Επαληθευμένη τιμή αναφοράς. Χρησιμοποιείται στην αποτίμηση, αλλά είναι εκτός του αυστηρού χρονικού ορίου για τελική ενέργεια.';
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
  const role = inherited?.sourceRole || sourceRole(quote);
  const price = positive(quote.nativePrice ?? quote.price);
  const ageHours = quoteAgeHours(quote, options.now || Date.now());
  const decisionMaxAgeHours = Number(options.decisionMaxAgeHours ?? options.maxAgeHours ?? (String(symbol).endsWith('.GR') ? 6 : 4));
  const marketClosed = quote.exchangeOpen === false
    || quote.status === 'closed'
    || !exchangeOpenNow(symbol, options.now || Date.now());
  const valuationMaxAgeHours = Number(options.valuationMaxAgeHours ?? (marketClosed ? 120 : decisionMaxAgeHours));
  const timestampVerified = inherited?.timestampVerified !== false
    && quote.priceTimestampVerified !== false
    && ageHours !== null;
  const staleForValuation = ageHours === null || ageHours > valuationMaxAgeHours;
  const staleForDecision = ageHours === null || ageHours > decisionMaxAgeHours || quote.status === 'stale';
  const sourceApproved = inherited?.sourceApproved === true
    || [SOURCE_ROLES.PRIMARY_EXCHANGE, SOURCE_ROLES.LICENSED_MARKET_DATA].includes(role);
  const valuationEligible = price !== null
    && !staleForValuation
    && sourceApproved
    && role !== SOURCE_ROLES.FALLBACK_UNVERIFIED;
  const decisionEligible = valuationEligible
    && !staleForDecision
    && timestampVerified;
  const previousClose = positive(quote.nativePreviousClose ?? quote.previousClose);
  const previousCloseExplicitlyRejected = Array.isArray(inherited?.diagnosticCodes)
    && inherited.diagnosticCodes.includes('PREVIOUS_CLOSE_NOT_VERIFIED');
  const dayChangeEligible = valuationEligible
    && quote.dayChangeVerified !== false
    && !previousCloseExplicitlyRejected
    && previousClose !== null;

  const status = price === null
    ? 'UNAVAILABLE'
    : role === SOURCE_ROLES.FALLBACK_UNVERIFIED || !sourceApproved
      ? 'FALLBACK_NOT_VERIFIED'
      : staleForValuation
        ? 'STALE'
        : role === SOURCE_ROLES.PRIMARY_EXCHANGE && !timestampVerified
          ? 'OFFICIAL_DELAYED_OR_EXCHANGE'
          : !timestampVerified
            ? 'TIMESTAMP_NOT_VERIFIED'
            : marketClosed
              ? 'VERIFIED_CLOSE'
              : staleForDecision
                ? 'VERIFIED_REFERENCE'
                : role === SOURCE_ROLES.PRIMARY_EXCHANGE
                  ? 'OFFICIAL_DELAYED_OR_EXCHANGE'
                  : 'VERIFIED';

  const diagnosticCodes = [];
  if (price === null) diagnosticCodes.push('QUOTE_PRICE_MISSING');
  if (ageHours === null) diagnosticCodes.push('QUOTE_TIMESTAMP_MISSING');
  if (staleForDecision) diagnosticCodes.push('QUOTE_STALE_FOR_DECISION');
  if (staleForValuation) diagnosticCodes.push('QUOTE_STALE_FOR_VALUATION');
  if (!sourceApproved) diagnosticCodes.push('QUOTE_SOURCE_NOT_APPROVED');
  if (!timestampVerified) diagnosticCodes.push('QUOTE_TIMESTAMP_NOT_VERIFIED');
  if (previousClose === null) diagnosticCodes.push('PREVIOUS_CLOSE_NOT_VERIFIED');
  if (marketClosed && valuationEligible && !decisionEligible) diagnosticCodes.push('MARKET_CLOSED_REFERENCE_ONLY');
  if (inherited?.diagnosticCodes) {
    for (const code of inherited.diagnosticCodes) {
      if (code === 'QUOTE_STALE' && valuationEligible) continue;
      diagnosticCodes.push(code);
    }
  }

  const contract = {
    version: MOBILE_QUOTE_CONTRACT_VERSION,
    sourceRole: role,
    sourceApproved,
    timestampVerified,
    marketClosed,
    ageHours,
    decisionMaxAgeHours,
    valuationMaxAgeHours,
    staleForDecision,
    staleForValuation,
    valuationEligible,
    decisionEligible,
    dayChangeEligible,
    publicStatus: status,
    publicMessage: '',
    diagnosticCodes: [...new Set(diagnosticCodes)],
  };
  contract.publicMessage = safePublicMessage(status, quote, contract);
  return contract;
}

export function quoteFromRegistry(symbol, entry, options = {}) {
  if (!entry || typeof entry !== 'object') return null;
  const nativePrice = positive(entry.price);
  if (nativePrice === null || !entry.quoteAt) return null;
  const inherited = entry.quoteContract && typeof entry.quoteContract === 'object'
    ? entry.quoteContract
    : null;
  const role = inherited?.sourceRole || sourceRole({ source: entry.source, sourceQuality: entry.sourceQuality });
  const previousClose = positive(entry.previousClose);
  const inheritedDiagnostics = Array.isArray(inherited?.diagnosticCodes) ? inherited.diagnosticCodes : [];
  const candidate = {
    symbol,
    nativePrice,
    nativePreviousClose: previousClose,
    nativeChangeBase: previousClose,
    nativeRegularMarketPrice: nativePrice,
    nativeCurrency: entry.currency || (String(symbol).endsWith('.US') ? 'USD' : 'EUR'),
    updatedAt: entry.quoteAt,
    checkedAt: entry.checkedAt || entry.quoteAt,
    source: entry.source || 'Investor Control canonical quote registry',
    providerSymbol: entry.appSymbol || symbol,
    quality: role === SOURCE_ROLES.PRIMARY_EXCHANGE ? 'delayed15' : 'realtime',
    advertisedDelayMinutes: Number(entry.advertisedDelayMinutes || (role === SOURCE_ROLES.PRIMARY_EXCHANGE ? 15 : 0)),
    session: exchangeOpenNow(symbol, options.now || Date.now()) ? 'regular-market' : 'closed',
    priceTimestampVerified: inherited?.timestampVerified !== false,
    dayChangeVerified: previousClose !== null && !inheritedDiagnostics.includes('PREVIOUS_CLOSE_NOT_VERIFIED'),
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
