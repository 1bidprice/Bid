export const INSTRUMENT_INTEGRITY_POLICY_VERSION = '2026-08-20.1';

const SUPPORTED_ASSET_CLASSES = new Set([
  'EQUITY', 'ETF', 'FUND', 'BOND', 'CRYPTO', 'FX', 'COMMODITY', 'FUTURE', 'OPTION', 'CASH',
]);

const EXCHANGE_LISTED_ASSET_CLASSES = new Set(['EQUITY', 'ETF']);
const INACTIVE_LIFECYCLE = new Set([
  'DELISTED', 'INACTIVE', 'PRIVATE', 'ACQUIRED', 'CEASED_TRADING', 'TERMINATED', 'EXPIRED',
]);
const US_MICS = new Set(['XNYS', 'XNAS', 'ARCX', 'BATS', 'IEXG']);
const ATHENS_MICS = new Set(['XATH']);

function text(value) {
  return String(value || '').trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function symbolBase(value) {
  return upper(value)
    .replace(/\.(US|GR)$/i, '')
    .replace(/\.AT$/i, '');
}

function validCurrency(value) {
  return /^[A-Z]{3}$/.test(upper(value));
}

function listingFrom(profile = {}, instrument = {}) {
  return profile?.listing || instrument?.primaryListing || instrument?.listing || null;
}

function instrumentIdFrom(profile = {}, instrument = {}) {
  return profile?.instrumentId || instrument?.instrumentId || instrument?.companyId || instrument?.issuerId || null;
}

function assetClassFrom(profile = {}, instrument = {}) {
  return upper(profile?.assetClass || instrument?.assetClass || instrument?.instrumentType || 'UNKNOWN');
}

function lifecycleFrom(listing = {}, instrument = {}) {
  return upper(
    listing?.lifecycleStatus || listing?.status || instrument?.listingStatus || instrument?.lifecycleStatus || '',
  );
}

function activeTradingVerified(listing = {}, instrument = {}) {
  return listing?.activeTradingVerified === true || instrument?.activeTradingVerified === true;
}

function venueCurrency(listing = {}) {
  const mic = upper(listing?.mic);
  if (US_MICS.has(mic)) return 'USD';
  if (ATHENS_MICS.has(mic)) return 'EUR';
  return null;
}

function quoteCurrency(quote = {}) {
  const native = upper(quote?.nativeCurrency);
  if (validCurrency(native)) return native;
  const direct = upper(quote?.currency);
  return validCurrency(direct) ? direct : null;
}

function quoteSymbol(quote = {}) {
  return quote?.appSymbol || quote?.symbol || quote?.providerSymbol || null;
}

function quoteContract(quote = {}) {
  return quote?.quoteContract || quote?.contract || {};
}

function pairIdentity(instrument = {}, leftNames = [], rightNames = []) {
  const left = leftNames.map((name) => upper(instrument?.[name])).find(Boolean) || null;
  const right = rightNames.map((name) => upper(instrument?.[name])).find(Boolean) || null;
  return { left, right };
}

function structuralIdentityBlockers(assetClass, profile, instrument, listing) {
  const blockers = [];
  const instrumentId = instrumentIdFrom(profile, instrument);

  if (!SUPPORTED_ASSET_CLASSES.has(assetClass)) {
    blockers.push('ASSET_CLASS_UNSUPPORTED');
    return blockers;
  }

  if (EXCHANGE_LISTED_ASSET_CLASSES.has(assetClass)) {
    if (!instrumentId) blockers.push('INSTRUMENT_IDENTITY_UNVERIFIED');
    if (!symbolBase(listing?.symbol)) blockers.push('LISTING_SYMBOL_REQUIRED');
    if (!upper(listing?.mic) && !text(listing?.exchange)) blockers.push('LISTING_VENUE_REQUIRED');
  } else if (assetClass === 'FUND') {
    if (!instrumentId && !text(profile?.identifiers?.isin || instrument?.isin)) blockers.push('FUND_IDENTITY_UNVERIFIED');
  } else if (assetClass === 'BOND') {
    if (!text(profile?.identifiers?.isin || instrument?.isin || instrument?.cusip) && !instrumentId) blockers.push('BOND_IDENTITY_UNVERIFIED');
  } else if (assetClass === 'FX') {
    const pair = pairIdentity(instrument, ['baseCurrency'], ['quoteCurrency']);
    if (!pair.left || !pair.right || pair.left === pair.right) blockers.push('FX_PAIR_IDENTITY_UNVERIFIED');
  } else if (assetClass === 'CRYPTO') {
    const pair = pairIdentity(instrument, ['baseAsset', 'baseCurrency'], ['quoteAsset', 'quoteCurrency']);
    if (!pair.left || !pair.right || pair.left === pair.right) blockers.push('CRYPTO_PAIR_IDENTITY_UNVERIFIED');
  } else if (assetClass === 'FUTURE') {
    if (!text(listing?.symbol || instrument?.symbol || instrument?.contractSymbol)) blockers.push('FUTURE_CONTRACT_SYMBOL_REQUIRED');
    if (!text(instrument?.underlying || instrument?.underlyingSymbol)) blockers.push('FUTURE_UNDERLYING_REQUIRED');
    if (!text(instrument?.expiry || instrument?.expiryDate || instrument?.contractMonth)) blockers.push('FUTURE_EXPIRY_REQUIRED');
  } else if (assetClass === 'OPTION') {
    if (!instrumentId && !text(listing?.symbol || instrument?.symbol || instrument?.contractSymbol)) blockers.push('OPTION_CONTRACT_IDENTITY_REQUIRED');
    if (!text(instrument?.underlying || instrument?.underlyingSymbol)) blockers.push('OPTION_UNDERLYING_REQUIRED');
    if (!Number.isFinite(Number(instrument?.strike ?? instrument?.option?.strike))) blockers.push('OPTION_STRIKE_REQUIRED');
    if (!text(instrument?.expiry || instrument?.expiryDate || instrument?.option?.expiry)) blockers.push('OPTION_EXPIRY_REQUIRED');
    const right = upper(instrument?.optionType || instrument?.right || instrument?.option?.type);
    if (!['CALL', 'PUT', 'C', 'P'].includes(right)) blockers.push('OPTION_RIGHT_REQUIRED');
  } else if (assetClass === 'COMMODITY') {
    if (!instrumentId && !text(instrument?.commodity || instrument?.symbol || listing?.symbol)) blockers.push('COMMODITY_IDENTITY_UNVERIFIED');
  } else if (assetClass === 'CASH') {
    const currency = upper(instrument?.currency || listing?.currency);
    if (!validCurrency(currency)) blockers.push('CURRENCY_NOT_VERIFIED');
  }

  return blockers;
}

function routingBlockers(assetClass, profile, instrument, listing) {
  const blockers = structuralIdentityBlockers(assetClass, profile, instrument, listing);
  if (EXCHANGE_LISTED_ASSET_CLASSES.has(assetClass) && !upper(listing?.mic) && !text(listing?.exchange)) {
    blockers.push('ROUTING_VENUE_UNVERIFIED');
  }
  if (['FUTURE', 'OPTION'].includes(assetClass) && !upper(listing?.mic) && !text(listing?.exchange || instrument?.exchange)) {
    blockers.push('DERIVATIVE_VENUE_UNVERIFIED');
  }
  return unique(blockers);
}

function valuationBlockers(assetClass, profile, instrument, listing, quote) {
  const blockers = routingBlockers(assetClass, profile, instrument, listing);
  if (!quote || !Number.isFinite(Number(quote?.value ?? quote?.nativePrice ?? quote?.price)) || Number(quote?.value ?? quote?.nativePrice ?? quote?.price) <= 0) {
    blockers.push('QUOTE_REQUIRED');
    return unique(blockers);
  }

  const contract = quoteContract(quote);
  const sourceApproved = quote?.sourceApproved === true || contract?.sourceApproved === true;
  const valuationEligible = quote?.valuationEligible === true || contract?.valuationEligible === true;
  if (!sourceApproved) blockers.push('QUOTE_SOURCE_NOT_APPROVED');
  if (!valuationEligible) blockers.push('QUOTE_NOT_VALUATION_ELIGIBLE');

  const listingSymbol = symbolBase(listing?.symbol || instrument?.symbol);
  const pricedSymbol = symbolBase(quoteSymbol(quote));
  if (listingSymbol && pricedSymbol && listingSymbol !== pricedSymbol) blockers.push('QUOTE_INSTRUMENT_MISMATCH');

  const expectedCompanyId = instrumentIdFrom(profile, instrument);
  if (quote?.companyId && expectedCompanyId && quote.companyId !== expectedCompanyId) blockers.push('QUOTE_ENTITY_MISMATCH');

  const explicitCurrency = upper(listing?.currency || instrument?.currency);
  const qCurrency = quoteCurrency(quote);
  const venueExpected = venueCurrency(listing);
  if (!qCurrency) blockers.push('CURRENCY_NOT_VERIFIED');
  if (explicitCurrency && validCurrency(explicitCurrency) && qCurrency && explicitCurrency !== qCurrency) blockers.push('QUOTE_CURRENCY_MISMATCH');
  if (venueExpected && qCurrency && venueExpected !== qCurrency) blockers.push('QUOTE_VENUE_CURRENCY_MISMATCH');

  return unique(blockers);
}

function decisionBlockers(assetClass, profile, instrument, listing, quote) {
  const blockers = valuationBlockers(assetClass, profile, instrument, listing, quote);
  const contract = quoteContract(quote);

  if (EXCHANGE_LISTED_ASSET_CLASSES.has(assetClass)) {
    if (!activeTradingVerified(listing, instrument)) blockers.push('ACTIVE_LISTING_NOT_VERIFIED');
    const lifecycle = lifecycleFrom(listing, instrument);
    if (INACTIVE_LIFECYCLE.has(lifecycle)) blockers.push('LISTING_NOT_ACTIVE');
  }

  if (quote?.timestampVerified !== true && contract?.timestampVerified !== true) blockers.push('QUOTE_TIMESTAMP_NOT_VERIFIED');
  if (quote?.decisionEligible !== true && contract?.decisionEligible !== true) blockers.push('QUOTE_NOT_DECISION_ELIGIBLE');

  return unique(blockers);
}

export function evaluateInstrumentIntegrity({ profile = {}, instrument = {}, quote = null, purpose = 'DECISION' } = {}) {
  const assetClass = assetClassFrom(profile, instrument);
  const listing = listingFrom(profile, instrument) || {};
  const identityBlockers = unique(structuralIdentityBlockers(assetClass, profile, instrument, listing));
  const routeBlockers = unique(routingBlockers(assetClass, profile, instrument, listing));
  const valueBlockers = unique(valuationBlockers(assetClass, profile, instrument, listing, quote));
  const actionBlockers = unique(decisionBlockers(assetClass, profile, instrument, listing, quote));
  const normalizedPurpose = upper(purpose || 'DECISION');
  const blockers = normalizedPurpose === 'STORAGE'
    ? identityBlockers
    : normalizedPurpose === 'ROUTING'
      ? routeBlockers
      : normalizedPurpose === 'VALUATION'
        ? valueBlockers
        : actionBlockers;

  return {
    format: 'investor-control-instrument-integrity',
    version: 1,
    policyVersion: INSTRUMENT_INTEGRITY_POLICY_VERSION,
    assetClass,
    instrumentId: instrumentIdFrom(profile, instrument),
    symbol: listing?.symbol || instrument?.symbol || null,
    mic: listing?.mic || null,
    currency: upper(listing?.currency || instrument?.currency || quoteCurrency(quote)) || null,
    purpose: normalizedPurpose,
    identityReady: identityBlockers.length === 0,
    routingReady: routeBlockers.length === 0,
    valuationReady: valueBlockers.length === 0,
    decisionReady: actionBlockers.length === 0,
    blockers,
    identityBlockers,
    routingBlockers: routeBlockers,
    valuationBlockers: valueBlockers,
    decisionBlockers: actionBlockers,
    invariant: 'SAME_INSTRUMENT_INTEGRITY_RULES_FOR_ALL_USERS_AND_PORTFOLIOS',
  };
}

export function instrumentIntegrityAllows(integrity, purpose = 'DECISION') {
  const mode = upper(purpose);
  if (mode === 'STORAGE') return integrity?.identityReady === true;
  if (mode === 'ROUTING') return integrity?.routingReady === true;
  if (mode === 'VALUATION') return integrity?.valuationReady === true;
  return integrity?.decisionReady === true;
}
