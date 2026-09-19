import { MARKET_RULES } from './market-rules';

export const MOBILE_INSTRUMENT_INTEGRITY_VERSION = '2026-08-24.1';

function upper(value) {
  return String(value || '').trim().toUpperCase();
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function validIso(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) && time > 0 ? time : null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function sourceRole(quote = {}) {
  const inherited = quote?.quoteContract?.sourceRole || quote?.sourceRole;
  if (inherited) return upper(inherited);
  const source = String(quote?.source || '').toLowerCase();
  const quality = String(quote?.quality || '').toLowerCase();
  if (source.includes('euronext') || quality.includes('primary_exchange')) return 'PRIMARY_EXCHANGE';
  if (source.includes('finnhub') || quality === 'realtime' || quality.includes('primary_licensed')) return 'LICENSED_MARKET_DATA';
  if (source.includes('yahoo') || quality === 'unofficial' || quality.includes('fallback')) return 'FALLBACK_UNVERIFIED';
  return 'UNKNOWN';
}

function baseProviderSymbol(value) {
  return upper(value).replace(/\.(US|GR|AT)$/i, '');
}

export function routeMobileInstrument(symbol) {
  const normalized = upper(symbol);
  if (!normalized) {
    return { supported: false, symbol: null, market: null, baseSymbol: null, expectedCurrency: null, blocker: 'SYMBOL_REQUIRED' };
  }
  for (const [market, rule] of Object.entries(MARKET_RULES)) {
    if (!normalized.endsWith(rule.suffix)) continue;
    const baseSymbol = normalized.slice(0, -rule.suffix.length);
    if (!baseSymbol || !/^[A-Z0-9._-]+$/.test(baseSymbol)) {
      return { supported: false, symbol: normalized, market, baseSymbol: null, expectedCurrency: rule.currency, blocker: 'SYMBOL_FORMAT_UNVERIFIED' };
    }
    return {
      supported: true,
      symbol: normalized,
      market,
      baseSymbol,
      expectedCurrency: rule.currency,
      approvedSourceRoles: [...rule.sourceRoles],
      timeZone: rule.timeZone || null,
      advertisedDelayMinutes: Number(rule.advertisedDelayMinutes || 0),
      blocker: null,
    };
  }
  return {
    supported: false,
    symbol: normalized,
    market: null,
    baseSymbol: normalized,
    expectedCurrency: null,
    blocker: 'MARKET_ROUTE_UNVERIFIED',
  };
}

export function evaluateMobileQuoteIntegrity(symbol, quote = {}, options = {}) {
  const route = routeMobileInstrument(symbol);
  const blockers = [];
  if (!route.supported) blockers.push(route.blocker || 'MARKET_ROUTE_UNVERIFIED');

  const price = finitePositive(quote?.nativePrice ?? quote?.price);
  if (price === null) blockers.push('QUOTE_PRICE_MISSING');

  const providerSymbol = quote?.providerSymbol || quote?.appSymbol || quote?.symbol || null;
  if (!providerSymbol) blockers.push('PROVIDER_SYMBOL_REQUIRED');
  if (route.supported && providerSymbol && baseProviderSymbol(providerSymbol) !== route.baseSymbol) {
    blockers.push('QUOTE_INSTRUMENT_MISMATCH');
  }

  const nativeCurrency = upper(quote?.nativeCurrency);
  if (!/^[A-Z]{3}$/.test(nativeCurrency)) blockers.push('CURRENCY_NOT_VERIFIED');
  if (route.expectedCurrency && nativeCurrency && route.expectedCurrency !== nativeCurrency) blockers.push('QUOTE_CURRENCY_MISMATCH');

  const role = sourceRole(quote);
  const sourceApproved = route.supported && route.approvedSourceRoles.includes(role);
  if (!sourceApproved) blockers.push('QUOTE_SOURCE_NOT_APPROVED');

  const exchangeCalendarVerified = options.exchangeCalendarVerified !== false;
  if (route.market === 'GR' && !exchangeCalendarVerified) blockers.push('EXCHANGE_CALENDAR_NOT_VERIFIED');

  const nowMs = Number(new Date(options.now || Date.now()));
  const updatedMs = validIso(quote?.updatedAt || quote?.quoteAt);
  const checkedMs = validIso(quote?.checkedAt);
  const timestampVerified = quote?.priceTimestampVerified === true
    || (quote?.priceTimestampVerified !== false && updatedMs !== null);
  const advertisedDelayMinutes = Math.max(0, Number(quote?.advertisedDelayMinutes || 0));
  const maxAgeMinutes = Number(options.maxAgeMinutes ?? (route.market === 'GR' ? 360 : 240));
  const maxClosedValuationAgeMinutes = Number(options.maxClosedValuationAgeMinutes ?? 96 * 60);
  const exactAgeMinutes = updatedMs === null ? null : Math.max(0, (nowMs - updatedMs) / 60_000);
  const checkAgeMinutes = checkedMs === null ? null : Math.max(0, (nowMs - checkedMs) / 60_000);
  const officialDelayedObservation = role === 'PRIMARY_EXCHANGE'
    && advertisedDelayMinutes > 0
    && checkAgeMinutes !== null
    && checkAgeMinutes <= maxAgeMinutes;
  const freshEnough = timestampVerified
    ? exactAgeMinutes !== null && exactAgeMinutes <= maxAgeMinutes
    : officialDelayedObservation;
  const closedMarketReferenceEligible = options.exchangeOpen === false
    && role === 'LICENSED_MARKET_DATA'
    && quote?.session === 'regular-market'
    && timestampVerified
    && exactAgeMinutes !== null
    && exactAgeMinutes <= maxClosedValuationAgeMinutes;
  const valuationFreshEnough = freshEnough || closedMarketReferenceEligible;

  if (!valuationFreshEnough) blockers.push('QUOTE_FRESHNESS_NOT_VERIFIED');
  if (!timestampVerified) blockers.push('QUOTE_TIMESTAMP_NOT_VERIFIED');

  const identityBlockers = blockers.filter((code) => [
    'SYMBOL_REQUIRED', 'SYMBOL_FORMAT_UNVERIFIED', 'MARKET_ROUTE_UNVERIFIED', 'PROVIDER_SYMBOL_REQUIRED',
    'QUOTE_INSTRUMENT_MISMATCH', 'CURRENCY_NOT_VERIFIED', 'QUOTE_CURRENCY_MISMATCH',
  ].includes(code));
  const valuationBlockers = blockers.filter((code) => code !== 'QUOTE_TIMESTAMP_NOT_VERIFIED');
  const decisionBlockers = unique([
    ...blockers,
    ...(!freshEnough ? ['QUOTE_DECISION_FRESHNESS_NOT_VERIFIED'] : []),
  ]);
  const identityReady = identityBlockers.length === 0;
  const valuationReady = price !== null && valuationBlockers.length === 0;
  const decisionReady = valuationReady && timestampVerified && decisionBlockers.length === 0;

  const publicStatus = price === null
    ? 'UNAVAILABLE'
    : !route.supported || identityBlockers.length
      ? 'INSTRUMENT_UNVERIFIED'
      : route.market === 'GR' && !exchangeCalendarVerified
        ? 'CALENDAR_NOT_VERIFIED'
        : role === 'FALLBACK_UNVERIFIED' || !sourceApproved
          ? 'FALLBACK_NOT_VERIFIED'
        : !valuationFreshEnough
          ? 'STALE'
          : !timestampVerified
            ? 'TIMESTAMP_NOT_VERIFIED'
            : closedMarketReferenceEligible
              ? 'CLOSED_MARKET_REFERENCE'
              : role === 'PRIMARY_EXCHANGE'
                ? 'OFFICIAL_DELAYED_OR_EXCHANGE'
                : 'VERIFIED';

  return {
    version: MOBILE_INSTRUMENT_INTEGRITY_VERSION,
    invariant: 'SAME_QUOTE_AND_IDENTITY_RULES_FOR_EVERY_USER_AND_SYMBOL',
    symbol: route.symbol,
    market: route.market,
    baseSymbol: route.baseSymbol,
    providerSymbol: providerSymbol ? upper(providerSymbol) : null,
    expectedCurrency: route.expectedCurrency,
    nativeCurrency: nativeCurrency || null,
    sourceRole: role,
    sourceApproved,
    exchangeCalendarVerified,
    timestampVerified,
    advertisedDelayMinutes,
    exactAgeMinutes,
    checkAgeMinutes,
    freshEnough,
    valuationFreshEnough,
    closedMarketReferenceEligible,
    identityReady,
    valuationReady,
    decisionReady,
    publicStatus,
    blockers: unique(blockers),
    identityBlockers: unique(identityBlockers),
    valuationBlockers: unique(valuationBlockers),
    decisionBlockers,
  };
}

export function mobileQuotePublicMessage(integrity) {
  const status = integrity?.publicStatus;
  if (status === 'UNAVAILABLE') return 'Δεν υπάρχει διαθέσιμη επαληθεύσιμη τιμή.';
  if (status === 'INSTRUMENT_UNVERIFIED') return 'Το προϊόν ή η αγορά του δεν έχει επαληθευτεί. Δεν χρησιμοποιείται σε αποτίμηση ή απόφαση.';
  if (status === 'CALENDAR_NOT_VERIFIED') return 'Το επίσημο ημερολόγιο συνεδριάσεων της Euronext Athens δεν έχει επαληθευτεί για αυτή την ημερομηνία. Η τιμή δεν χρησιμοποιείται σε αποτίμηση ή απόφαση.';
  if (status === 'FALLBACK_NOT_VERIFIED') return 'Η εφεδρική τιμή είναι μόνο πληροφοριακή και δεν χρησιμοποιείται σε αποτίμηση ή απόφαση.';
  if (status === 'STALE') return 'Η φρεσκότητα της τιμής δεν έχει επαληθευτεί. Δεν χρησιμοποιείται σε αποτίμηση ή απόφαση.';
  if (status === 'TIMESTAMP_NOT_VERIFIED') {
    return integrity?.advertisedDelayMinutes > 0
      ? `Επίσημη τιμή αναφοράς με δηλωμένη καθυστέρηση ${integrity.advertisedDelayMinutes}′. Ο ακριβής χρόνος συναλλαγής δεν είναι διαθέσιμος.`
      : 'Ο ακριβής χρόνος της τιμής δεν έχει επαληθευτεί.';
  }
  if (status === 'CLOSED_MARKET_REFERENCE') return 'Επαληθευμένη τελευταία τιμή κανονικής συνεδρίασης. Χρησιμοποιείται για αποτίμηση όσο η αγορά είναι κλειστή, όχι για νέα αυτόματη απόφαση.';
  if (status === 'OFFICIAL_DELAYED_OR_EXCHANGE') return 'Επίσημη χρηματιστηριακή τιμή από την πρωτογενή αγορά.';
  if (status === 'VERIFIED') return 'Επαληθευμένη χρηματιστηριακή τιμή από εγκεκριμένη πηγή.';
  return 'Η ποιότητα της τιμής δεν έχει επαληθευτεί.';
}
