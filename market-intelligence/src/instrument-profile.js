import { classifyFundamentalModel } from './fundamental-model.js';

export const INSTRUMENT_PROFILE_VERSION = '2026-08-08.1';

export const ASSET_CLASS = Object.freeze({
  EQUITY: 'EQUITY',
  ETF: 'ETF',
  FUND: 'FUND',
  BOND: 'BOND',
  CRYPTO: 'CRYPTO',
  FX: 'FX',
  COMMODITY: 'COMMODITY',
  FUTURE: 'FUTURE',
  OPTION: 'OPTION',
  CASH: 'CASH',
  UNKNOWN: 'UNKNOWN',
});

const EXPLICIT_TYPE_MAP = new Map([
  ['STOCK', ASSET_CLASS.EQUITY], ['SHARE', ASSET_CLASS.EQUITY], ['EQUITY', ASSET_CLASS.EQUITY],
  ['ETF', ASSET_CLASS.ETF], ['EXCHANGE_TRADED_FUND', ASSET_CLASS.ETF],
  ['FUND', ASSET_CLASS.FUND], ['MUTUAL_FUND', ASSET_CLASS.FUND],
  ['BOND', ASSET_CLASS.BOND], ['FIXED_INCOME', ASSET_CLASS.BOND], ['NOTE', ASSET_CLASS.BOND],
  ['CRYPTO', ASSET_CLASS.CRYPTO], ['CRYPTOCURRENCY', ASSET_CLASS.CRYPTO], ['DIGITAL_ASSET', ASSET_CLASS.CRYPTO],
  ['FX', ASSET_CLASS.FX], ['FOREX', ASSET_CLASS.FX], ['CURRENCY_PAIR', ASSET_CLASS.FX],
  ['COMMODITY', ASSET_CLASS.COMMODITY],
  ['FUTURE', ASSET_CLASS.FUTURE], ['FUTURES', ASSET_CLASS.FUTURE],
  ['OPTION', ASSET_CLASS.OPTION], ['OPTIONS', ASSET_CLASS.OPTION],
  ['CASH', ASSET_CLASS.CASH],
]);

function normalize(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
}

function text(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9Α-Ω]+/g, ' ').replace(/\s+/g, ' ');
}

function explicitAssetClass(instrument = {}) {
  for (const value of [instrument.assetClass, instrument.instrumentType, instrument.securityType, instrument.type]) {
    const mapped = EXPLICIT_TYPE_MAP.get(normalize(value));
    if (mapped) return { assetClass: mapped, reason: 'EXPLICIT_INSTRUMENT_TYPE' };
  }
  return null;
}

function inferredAssetClass(instrument = {}) {
  const combined = text([
    instrument.displayName,
    instrument.legalName,
    instrument.name,
    instrument.sector,
    instrument.industry,
    instrument.category,
  ].filter(Boolean).join(' '));

  if (instrument.option?.strike != null || instrument.strike != null || /\bOPTION\b/.test(combined)) return { assetClass: ASSET_CLASS.OPTION, reason: 'OPTION_STRUCTURE_SIGNAL' };
  if (instrument.future?.expiry || instrument.contractMonth || /\bFUTURES?\b/.test(combined)) return { assetClass: ASSET_CLASS.FUTURE, reason: 'FUTURE_STRUCTURE_SIGNAL' };
  if ((instrument.baseCurrency && instrument.quoteCurrency) || /\bFOREX\b|\bFX\b/.test(combined)) return { assetClass: ASSET_CLASS.FX, reason: 'FX_PAIR_SIGNAL' };
  if ((instrument.baseAsset && instrument.quoteAsset) || /\bCRYPTO\b|\bBITCOIN\b|\bETHEREUM\b/.test(combined)) return { assetClass: ASSET_CLASS.CRYPTO, reason: 'DIGITAL_ASSET_SIGNAL' };
  if (instrument.couponRate != null || instrument.maturityDate || /\bBOND\b|\bFIXED INCOME\b/.test(combined)) return { assetClass: ASSET_CLASS.BOND, reason: 'FIXED_INCOME_SIGNAL' };
  if (/\bETF\b|\bEXCHANGE TRADED FUND\b/.test(combined)) return { assetClass: ASSET_CLASS.ETF, reason: 'ETF_NAME_SIGNAL' };
  if (/\bMUTUAL FUND\b|\bUCITS FUND\b/.test(combined)) return { assetClass: ASSET_CLASS.FUND, reason: 'FUND_NAME_SIGNAL' };
  if (instrument.commodity || /\bCOMMODITY\b|\bGOLD\b|\bSILVER\b|\bBRENT\b|\bWTI\b/.test(combined)) return { assetClass: ASSET_CLASS.COMMODITY, reason: 'COMMODITY_SIGNAL' };

  // Existing company registries historically omitted instrumentType. Listed
  // operating issuers therefore remain equities by backward-compatible default.
  if (instrument.primaryListing?.symbol || instrument.cik || instrument.issuerId || instrument.isin) {
    return { assetClass: ASSET_CLASS.EQUITY, reason: 'LISTED_ISSUER_DEFAULT' };
  }
  return { assetClass: ASSET_CLASS.UNKNOWN, reason: 'INSUFFICIENT_INSTRUMENT_IDENTITY' };
}

function analysisModel(assetClass, instrument, context) {
  if (assetClass === ASSET_CLASS.EQUITY) {
    const fundamental = classifyFundamentalModel(instrument, context);
    return {
      key: fundamental.type === 'FINANCIAL_INSTITUTION'
        ? 'EQUITY_BANK'
        : fundamental.type === 'REAL_ESTATE'
          ? 'EQUITY_REAL_ESTATE'
          : 'EQUITY_OPERATING',
      fundamentalModel: fundamental,
    };
  }
  return {
    key: {
      ETF: 'ETF_PORTFOLIO',
      FUND: 'FUND_PORTFOLIO',
      BOND: 'BOND_CREDIT_DURATION',
      CRYPTO: 'CRYPTO_NETWORK_MARKET',
      FX: 'FX_MACRO_CARRY',
      COMMODITY: 'COMMODITY_CURVE_INVENTORY',
      FUTURE: 'FUTURE_DERIVATIVE',
      OPTION: 'OPTION_VOLATILITY_GREEKS',
      CASH: 'CASH_LIQUIDITY',
      UNKNOWN: 'UNSUPPORTED_UNKNOWN',
    }[assetClass] || 'UNSUPPORTED_UNKNOWN',
    fundamentalModel: null,
  };
}

const MODEL_REQUIREMENTS = Object.freeze({
  EQUITY_OPERATING: ['MARKET_PRICE', 'PRICE_HISTORY', 'OFFICIAL_FILINGS', 'FUNDAMENTALS', 'INDEPENDENT_CROSS_CHECK'],
  EQUITY_BANK: ['MARKET_PRICE', 'PRICE_HISTORY', 'OFFICIAL_FILINGS', 'BANK_CAPITAL', 'ASSET_QUALITY', 'LOANS_DEPOSITS', 'ROE_ROTE', 'INDEPENDENT_CROSS_CHECK'],
  EQUITY_REAL_ESTATE: ['MARKET_PRICE', 'PRICE_HISTORY', 'OFFICIAL_FILINGS', 'NOI_FFO', 'NAV', 'NET_DEBT', 'OCCUPANCY', 'INDEPENDENT_CROSS_CHECK'],
  ETF_PORTFOLIO: ['MARKET_PRICE', 'PRICE_HISTORY', 'HOLDINGS', 'EXPENSE_RATIO', 'TRACKING_ERROR', 'LIQUIDITY', 'CONCENTRATION'],
  FUND_PORTFOLIO: ['NAV', 'HOLDINGS', 'FEES', 'BENCHMARK', 'PERFORMANCE_HISTORY'],
  BOND_CREDIT_DURATION: ['MARKET_PRICE', 'YIELD', 'COUPON', 'MATURITY', 'DURATION', 'CREDIT_QUALITY', 'SPREAD'],
  CRYPTO_NETWORK_MARKET: ['MARKET_PRICE', 'PRICE_HISTORY', 'MARKET_CAP', 'LIQUIDITY', 'SUPPLY', 'NETWORK_OR_PROTOCOL_RISK'],
  FX_MACRO_CARRY: ['SPOT_RATE', 'PRICE_HISTORY', 'RATE_DIFFERENTIAL', 'VOLATILITY', 'MACRO_RISK'],
  COMMODITY_CURVE_INVENTORY: ['SPOT_OR_FRONT_PRICE', 'FUTURES_CURVE', 'INVENTORIES', 'VOLATILITY', 'SUPPLY_DEMAND'],
  FUTURE_DERIVATIVE: ['FUTURES_PRICE', 'UNDERLYING', 'EXPIRY', 'CONTRACT_MULTIPLIER', 'CURVE', 'MARGIN_RISK'],
  OPTION_VOLATILITY_GREEKS: ['OPTION_PRICE', 'UNDERLYING', 'STRIKE', 'EXPIRY', 'IMPLIED_VOLATILITY', 'GREEKS', 'LIQUIDITY'],
  CASH_LIQUIDITY: ['CURRENCY', 'YIELD_OR_RATE', 'LIQUIDITY'],
  UNSUPPORTED_UNKNOWN: ['INSTRUMENT_IDENTITY'],
});

export function buildInstrumentProfile(instrument = {}, context = {}) {
  const classification = explicitAssetClass(instrument) || inferredAssetClass(instrument);
  const model = analysisModel(classification.assetClass, instrument, context);
  const listing = instrument.primaryListing || null;
  const profile = {
    format: 'investor-control-instrument-profile',
    version: 1,
    policyVersion: INSTRUMENT_PROFILE_VERSION,
    instrumentId: instrument.instrumentId || instrument.companyId || null,
    displayName: instrument.displayName || instrument.name || instrument.legalName || null,
    assetClass: classification.assetClass,
    classificationReason: classification.reason,
    analysisModel: model.key,
    fundamentalModel: model.fundamentalModel,
    listing: listing ? {
      symbol: listing.symbol || null,
      mic: listing.mic || null,
      exchange: listing.exchange || null,
      currency: listing.currency || instrument.currency || instrument.listings?.[0]?.currency || null,
    } : null,
    identifiers: {
      isin: instrument.isin || null,
      cik: instrument.cik || null,
      lei: instrument.lei || null,
      issuerId: instrument.issuerId || null,
    },
    requiredCapabilities: [...(MODEL_REQUIREMENTS[model.key] || MODEL_REQUIREMENTS.UNSUPPORTED_UNKNOWN)],
    routingInvariant: 'NO_TICKER_SPECIFIC_MODEL_SELECTION',
  };
  return profile;
}

export function isEquityLike(profile) {
  return profile?.assetClass === ASSET_CLASS.EQUITY;
}
