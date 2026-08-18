export const CAPABILITY_COLLECTOR_VERSION = '2026-08-08.1';

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizedCapability(value, defaults = {}) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { value, verified: defaults.verified === true, sourceRole: defaults.sourceRole || 'UNKNOWN', ...defaults };
  }
  return { ...defaults, ...value };
}

function structuralCapabilities(instrument = {}) {
  const out = {};
  const structural = (value, source = 'INSTRUMENT_REGISTRY') => value === null || value === undefined ? null : ({ value, verified: true, sourceRole: source });
  if (instrument.strike != null || instrument.option?.strike != null) out.STRIKE = structural(instrument.strike ?? instrument.option?.strike);
  if (instrument.maturityDate) out.MATURITY = { value: instrument.maturityDate, verified: true, sourceRole: 'INSTRUMENT_REGISTRY' };
  if (instrument.couponRate != null) out.COUPON = structural(instrument.couponRate);
  if (instrument.contractMultiplier != null || instrument.future?.contractMultiplier != null) out.CONTRACT_MULTIPLIER = structural(instrument.contractMultiplier ?? instrument.future?.contractMultiplier);
  const expiry = instrument.expiry || instrument.expiryDate || instrument.option?.expiry || instrument.future?.expiry;
  if (expiry) {
    const end = new Date(expiry).getTime();
    const now = Date.now();
    out.EXPIRY = {
      value: expiry,
      daysToExpiry: Number.isFinite(end) ? Math.max(0, (end - now) / 86_400_000) : null,
      verified: true,
      sourceRole: 'INSTRUMENT_REGISTRY',
    };
  }
  if (instrument.currency) out.CURRENCY = { value: instrument.currency, verified: true, sourceRole: 'INSTRUMENT_REGISTRY' };
  if (instrument.strategyContext) out.STRATEGY_CONTEXT = { ...instrument.strategyContext, verified: true, sourceRole: 'USER_DECLARED' };
  return out;
}

function marketCapabilities(profile, marketSnapshot, marketMetrics) {
  const out = {};
  const price = finite(marketSnapshot?.currentPrice ?? marketSnapshot?.referencePrice ?? marketSnapshot?.price);
  const sourceRole = marketSnapshot?.quoteContract?.sourceRole || marketSnapshot?.sourceRole || 'UNKNOWN';
  const verified = marketSnapshot?.quoteContract
    ? marketSnapshot.quoteContract.valuationEligible === true
    : marketSnapshot?.usable === true && marketSnapshot?.sourceVerified !== false;
  if (price !== null) {
    const base = { value: price, currency: marketSnapshot?.currency || profile?.listing?.currency || null, timestamp: marketSnapshot?.quoteTimestamp || marketSnapshot?.timestamp || null, verified, sourceRole };
    if (profile.analysisModel === 'OPTION_VOLATILITY_GREEKS') out.OPTION_PRICE = base;
    else if (profile.analysisModel === 'FUTURE_DERIVATIVE') out.FUTURES_PRICE = base;
    else if (profile.analysisModel === 'FX_MACRO_CARRY') out.SPOT_RATE = base;
    else if (profile.analysisModel === 'COMMODITY_CURVE_INVENTORY') out.SPOT_OR_FRONT_PRICE = base;
    else out.MARKET_PRICE = base;
  }

  if (marketMetrics) {
    const historyReady = marketMetrics?.readiness?.marketMetricsReady === true;
    out.PRICE_HISTORY = {
      verified: historyReady,
      sourceRole: marketMetrics?.sourceRole || 'LICENSED_MARKET_DATA',
      observationCount: finite(marketMetrics?.observationCount),
      annualizedVolatilityPct: finite(marketMetrics?.volatility?.annualizedPct ?? marketMetrics?.risk?.annualizedVolatilityPct),
      maxDrawdownPct: finite(marketMetrics?.drawdown?.maxDrawdownPct ?? marketMetrics?.risk?.maxDrawdownPct),
      return60Pct: finite(marketMetrics?.returns?.return60Pct),
    };
    const liquidity = marketMetrics?.liquidity || {};
    if (Object.keys(liquidity).length) {
      out.LIQUIDITY = {
        verified: historyReady,
        sourceRole: marketMetrics?.sourceRole || 'LICENSED_MARKET_DATA',
        score: finite(liquidity.score),
        avgDollarVolume: finite(liquidity.avgDollarVolume ?? liquidity.averageDollarVolume),
        bidAskSpreadPct: finite(liquidity.bidAskSpreadPct),
        averageVolume: finite(liquidity.averageVolume),
      };
    }
  }
  return out;
}

function mergeCapabilities(target, values, providerId, diagnostics) {
  for (const [key, raw] of Object.entries(values || {})) {
    const incoming = normalizedCapability(raw, { providerId });
    if (!incoming) continue;
    const existing = target[key];
    if (!existing) {
      target[key] = incoming;
      continue;
    }
    const incomingVerified = incoming.verified === true && !['FALLBACK_UNVERIFIED', 'UNKNOWN'].includes(incoming.sourceRole);
    const existingVerified = existing.verified === true && !['FALLBACK_UNVERIFIED', 'UNKNOWN'].includes(existing.sourceRole);
    if (incomingVerified && !existingVerified) target[key] = incoming;
    else diagnostics.push({ code: 'CAPABILITY_PROVIDER_DUPLICATE_IGNORED', capability: key, providerId, retainedProviderId: existing.providerId || null });
  }
}

export async function collectInstrumentCapabilities(instrument, profile, context = {}) {
  const capabilities = {};
  const diagnostics = [];
  mergeCapabilities(capabilities, structuralCapabilities(instrument), 'STRUCTURAL_REGISTRY', diagnostics);
  mergeCapabilities(capabilities, marketCapabilities(profile, context.marketSnapshot, context.marketMetrics), 'BUILTIN_MARKET', diagnostics);
  mergeCapabilities(capabilities, instrument?.capabilities || {}, 'INSTRUMENT_DECLARED', diagnostics);

  const providers = Array.isArray(context.providers) ? context.providers : [];
  for (const provider of providers) {
    if (!provider || typeof provider.collect !== 'function') continue;
    let supported = true;
    try {
      if (typeof provider.supports === 'function') supported = await provider.supports({ instrument, profile, route: context.route });
    } catch (error) {
      supported = false;
      diagnostics.push({ code: 'CAPABILITY_PROVIDER_SUPPORT_CHECK_FAILED', providerId: provider.id || null, message: String(error?.message || error) });
    }
    if (!supported) continue;
    try {
      const result = await provider.collect({ instrument, profile, route: context.route, fetchImpl: context.fetchImpl, now: context.now });
      mergeCapabilities(capabilities, result?.capabilities || result || {}, provider.id || 'ANONYMOUS_PROVIDER', diagnostics);
      diagnostics.push(...(result?.diagnostics || []).map((item) => ({ ...item, providerId: item.providerId || provider.id || null })));
    } catch (error) {
      diagnostics.push({ code: 'CAPABILITY_PROVIDER_FAILED', providerId: provider.id || null, message: String(error?.message || error) });
    }
  }

  return {
    format: 'investor-control-instrument-capabilities',
    version: 1,
    policyVersion: CAPABILITY_COLLECTOR_VERSION,
    instrumentId: profile?.instrumentId || instrument?.instrumentId || instrument?.companyId || null,
    assetClass: profile?.assetClass || null,
    analysisModel: profile?.analysisModel || null,
    capabilities,
    diagnostics,
    providerCount: providers.length,
    invariant: 'NORMALIZED_CAPABILITIES_NO_TICKER_BRANCHING',
  };
}
