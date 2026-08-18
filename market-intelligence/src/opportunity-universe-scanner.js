import { buildInstrumentProfile, ASSET_CLASS } from './instrument-profile.js';
import { buildInstrumentRoute } from './instrument-router.js';
import { collectInstrumentCapabilities } from './instrument-capability-collector.js';
import { evaluateInstrumentCapabilities } from './instrument-capability-evaluator.js';
import { rankOpportunityUniverse } from './opportunity-engine.js';

export const OPPORTUNITY_UNIVERSE_SCANNER_VERSION = '2026-08-18.1';

function stableInstrumentKey(instrument = {}) {
  if (instrument.instrumentId) return `ID:${instrument.instrumentId}`;
  if (instrument.companyId) return `COMPANY:${instrument.companyId}`;
  if (instrument.isin) return `ISIN:${String(instrument.isin).toUpperCase()}`;
  const symbol = instrument.primaryListing?.symbol || instrument.symbol;
  const mic = instrument.primaryListing?.mic || instrument.mic;
  if (symbol && mic) return `LISTING:${String(mic).toUpperCase()}:${String(symbol).toUpperCase()}`;
  if (instrument.baseAsset && instrument.quoteAsset) return `PAIR:${String(instrument.baseAsset).toUpperCase()}:${String(instrument.quoteAsset).toUpperCase()}`;
  return null;
}

function mergeInstruments(items = []) {
  const map = new Map();
  const anonymous = [];
  for (const instrument of items.filter(Boolean)) {
    const key = stableInstrumentKey(instrument);
    if (!key) {
      anonymous.push(instrument);
      continue;
    }
    const existing = map.get(key);
    map.set(key, existing ? { ...existing, ...instrument, primaryListing: { ...(existing.primaryListing || {}), ...(instrument.primaryListing || {}) } } : instrument);
  }
  return [...map.values(), ...anonymous];
}

function factorCapability(capabilities) {
  const raw = capabilities?.capabilities?.OPPORTUNITY_FACTORS;
  if (!raw || typeof raw !== 'object' || raw.verified !== true) return null;
  const factors = raw.factors && typeof raw.factors === 'object' ? raw.factors : null;
  if (!factors) return null;
  const entries = Object.entries(factors);
  if (!entries.length) return null;
  // Every factor must carry its own explicit provenance/verification marker.
  if (entries.some(([, factor]) => !factor || typeof factor !== 'object' || factor.verified !== true || !Number.isFinite(Number(factor.score)) || Number(factor.sourceCount) < 1)) return null;
  return factors;
}

function scoreFromLiquidity(capabilities) {
  const liquidity = capabilities?.capabilities?.LIQUIDITY;
  if (!liquidity || liquidity.verified !== true) return 0;
  if (Number.isFinite(Number(liquidity.score))) return Math.max(0, Math.min(100, Number(liquidity.score)));
  const adv = Number(liquidity.avgDollarVolume);
  const spread = Number(liquidity.bidAskSpreadPct);
  let score = 50;
  if (Number.isFinite(adv)) {
    if (adv >= 100_000_000) score += 35;
    else if (adv >= 20_000_000) score += 25;
    else if (adv >= 5_000_000) score += 15;
    else if (adv < 500_000) score -= 30;
  }
  if (Number.isFinite(spread)) {
    if (spread <= 0.10) score += 15;
    else if (spread <= 0.30) score += 8;
    else if (spread > 1) score -= 25;
  }
  return Math.max(0, Math.min(100, score));
}

function evidenceQuality(capabilities, evaluation) {
  const explicit = capabilities?.capabilities?.EVIDENCE_QUALITY;
  if (explicit?.verified === true && Number.isFinite(Number(explicit.score))) return Math.max(0, Math.min(100, Number(explicit.score)));
  const coverage = Number(evaluation?.coverage?.score);
  if (!Number.isFinite(coverage)) return 0;
  return evaluation?.decisionModelReady === true ? Math.min(90, coverage) : Math.min(65, coverage);
}

async function discoverProviderUniverse(providers, context, diagnostics) {
  const discovered = [];
  for (const provider of providers) {
    if (!provider || typeof provider.discover !== 'function') continue;
    try {
      const result = await provider.discover({
        assetClasses: context.assetClasses,
        fetchImpl: context.fetchImpl,
        now: context.now,
        limit: context.perProviderLimit,
      });
      const instruments = Array.isArray(result) ? result : result?.instruments || [];
      for (const instrument of instruments) discovered.push({ ...instrument, universeProviderId: provider.id || 'ANONYMOUS_UNIVERSE_PROVIDER' });
      diagnostics.push(...(result?.diagnostics || []).map((item) => ({ ...item, providerId: item.providerId || provider.id || null })));
    } catch (error) {
      diagnostics.push({ code: 'OPPORTUNITY_UNIVERSE_PROVIDER_FAILED', providerId: provider.id || null, message: String(error?.message || error) });
    }
  }
  return discovered;
}

export async function scanOpportunityUniverse(options = {}) {
  const generatedAt = new Date(options.now || Date.now()).toISOString();
  const diagnostics = [];
  const seedInstruments = Array.isArray(options.instruments) ? options.instruments : [];
  const universeProviders = Array.isArray(options.universeProviders) ? options.universeProviders : [];
  const capabilityProviders = Array.isArray(options.capabilityProviders) ? options.capabilityProviders : [];
  const assetClasses = Array.isArray(options.assetClasses) && options.assetClasses.length
    ? options.assetClasses
    : Object.values(ASSET_CLASS).filter((value) => value !== ASSET_CLASS.UNKNOWN);

  const discovered = await discoverProviderUniverse(universeProviders, {
    assetClasses,
    fetchImpl: options.fetchImpl || globalThis.fetch,
    now: generatedAt,
    perProviderLimit: Math.max(1, Number(options.perProviderLimit || 2_000)),
  }, diagnostics);

  const universe = mergeInstruments([...seedInstruments, ...discovered]);
  const scoredCandidates = [];
  const unsupported = [];

  for (const instrument of universe) {
    const profile = buildInstrumentProfile(instrument, options.context || {});
    if (!assetClasses.includes(profile.assetClass)) continue;
    const route = buildInstrumentRoute(instrument, { ...(options.context || {}), profile });
    const capabilities = await collectInstrumentCapabilities(instrument, profile, {
      ...(options.context || {}),
      route,
      providers: capabilityProviders,
      fetchImpl: options.fetchImpl || globalThis.fetch,
      now: generatedAt,
    });
    const evaluation = evaluateInstrumentCapabilities(profile, capabilities);
    const factors = factorCapability(capabilities);

    if (!factors) {
      unsupported.push({
        instrumentId: profile.instrumentId,
        displayName: profile.displayName,
        assetClass: profile.assetClass,
        reason: 'VERIFIED_OPPORTUNITY_FACTORS_REQUIRED',
        routeBlockers: route.blockers,
        capabilityBlockers: evaluation.blockers || [],
      });
      continue;
    }

    const riskScore = Number(evaluation.riskScore);
    const executionQualityScore = scoreFromLiquidity(capabilities);
    const evidenceQualityScore = evidenceQuality(capabilities, evaluation);
    const contradictionCapability = capabilities?.capabilities?.CONTRADICTIONS;
    const contradictionCount = contradictionCapability?.verified === true && Number.isFinite(Number(contradictionCapability.count))
      ? Math.max(0, Number(contradictionCapability.count))
      : 0;

    scoredCandidates.push({
      instrumentId: profile.instrumentId,
      displayName: profile.displayName,
      profile,
      factors,
      riskScore: Number.isFinite(riskScore) ? riskScore : 100,
      liquidityScore: executionQualityScore,
      executionQualityScore,
      evidenceQualityScore,
      contradictionCount,
      severeRiskFlags: [...new Set((evaluation.riskFlags || []).filter((flag) => /^SEVERE_|^EXTREME_|DISTRESS|SOLVENCY|DEFAULT/.test(String(flag))))],
      strategyContextVerified: evaluation.strategyContextReady === true,
      source: {
        universeProviderId: instrument.universeProviderId || 'SEED_UNIVERSE',
        capabilityProviderCount: capabilities.providerCount,
        opportunityFactorsVerified: true,
        rawSeedScoresIgnored: true,
      },
    });
  }

  const ranked = rankOpportunityUniverse(scoredCandidates, { generatedAt, limit: options.rankingLimit || scoredCandidates.length || 1 });
  const byAssetClass = {};
  for (const item of ranked.items) byAssetClass[item.assetClass] = (byAssetClass[item.assetClass] || 0) + 1;

  return {
    format: 'investor-control-opportunity-universe-scan',
    version: 2,
    policyVersion: OPPORTUNITY_UNIVERSE_SCANNER_VERSION,
    generatedAt,
    providerCount: universeProviders.length,
    capabilityProviderCount: capabilityProviders.length,
    seedInstrumentCount: seedInstruments.length,
    discoveredInstrumentCount: discovered.length,
    uniqueInstrumentCount: universe.length,
    scorableInstrumentCount: scoredCandidates.length,
    unsupportedInstrumentCount: unsupported.length,
    byAssetClass,
    ranking: ranked,
    unsupported,
    diagnostics,
    invariant: 'ONLY_PROVIDER_VERIFIED_FACTORS_MAY_ENTER_OPPORTUNITY_SCORING_AND_DISCOVERY_CAN_NEVER_BYPASS_FINAL_ACTION_POLICY',
  };
}
