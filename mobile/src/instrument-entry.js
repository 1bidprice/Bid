export const SUPPORTED_INSTRUMENT_MARKETS = Object.freeze({
  GR: Object.freeze({ code: 'GR', label: 'Ελλάδα', currency: 'EUR', suffix: '.GR' }),
  US: Object.freeze({ code: 'US', label: 'ΗΠΑ', currency: 'USD', suffix: '.US' }),
});

export function normalizeInstrumentMarket(value, fallback = 'GR') {
  const market = String(value || '').trim().toUpperCase();
  return SUPPORTED_INSTRUMENT_MARKETS[market] ? market : fallback;
}

export function baseInstrumentSymbol(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/.(US|GR)$/i, '');
}

export function canonicalInstrumentSymbol(value, market = 'GR') {
  const normalizedMarket = normalizeInstrumentMarket(market);
  const base = baseInstrumentSymbol(value);
  if (!/^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(base)) return null;
  return `${base}.${normalizedMarket}`;
}

export function instrumentCurrency(market = 'GR') {
  return SUPPORTED_INSTRUMENT_MARKETS[normalizeInstrumentMarket(market)].currency;
}

export function inferInstrumentMarket(symbol, currency = null) {
  const raw = String(symbol || '').trim().toUpperCase();
  if (raw.endsWith('.US')) return 'US';
  if (raw.endsWith('.GR')) return 'GR';
  return String(currency || '').trim().toUpperCase() === 'USD' ? 'US' : 'GR';
}

export function instrumentEntryFromTransaction(transaction = {}) {
  const market = inferInstrumentMarket(transaction?.symbol, transaction?.currency);
  return {
    market,
    symbolInput: baseInstrumentSymbol(transaction?.symbol),
    canonicalSymbol: canonicalInstrumentSymbol(transaction?.symbol, market),
    currency: instrumentCurrency(market),
  };
}
