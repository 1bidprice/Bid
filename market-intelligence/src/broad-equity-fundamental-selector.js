export const BROAD_FUNDAMENTAL_SELECTOR_VERSION = '2026-08-09.1';

const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function rank(items, getter, direction = 'desc') {
  return [...items]
    .filter((item) => finite(getter(item)) !== null)
    .sort((a, b) => {
      const av = finite(getter(a));
      const bv = finite(getter(b));
      return direction === 'asc' ? av - bv : bv - av;
    });
}

function addFromBucket(output, seen, bucket, quota, tag) {
  let added = 0;
  for (const item of bucket) {
    if (added >= quota) break;
    const id = item.instrumentId || item.companyId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    output.push({
      ...item,
      broadScreen: {
        ...item.broadScreen,
        selector: {
          policyVersion: BROAD_FUNDAMENTAL_SELECTOR_VERSION,
          primaryLane: tag,
        },
      },
    });
    added += 1;
  }
}

export function selectBroadFundamentalCandidates(candidates = [], options = {}) {
  const limit = Math.max(4, Number(options.limit || 240));
  const eligible = candidates.filter((item) => Number(item?.broadScreen?.preliminaryRiskScore ?? 100) < Number(options.maxPreliminaryRiskScore || 80));
  const output = [];
  const seen = new Set();
  const quotas = {
    composite: Math.ceil(limit * 0.35),
    growth: Math.ceil(limit * 0.25),
    profitability: Math.ceil(limit * 0.20),
    balanceSheet: Math.ceil(limit * 0.20),
  };

  addFromBucket(output, seen, rank(eligible, (item) => item?.broadScreen?.score), quotas.composite, 'COMPOSITE_QUALITY');
  addFromBucket(output, seen, rank(eligible, (item) => item?.broadScreen?.rawSignals?.revenueGrowthPct), quotas.growth, 'REVENUE_GROWTH');
  addFromBucket(output, seen, rank(eligible, (item) => item?.broadScreen?.rawSignals?.netMarginPct), quotas.profitability, 'PROFITABILITY');
  addFromBucket(output, seen, rank(eligible, (item) => item?.broadScreen?.rawSignals?.liabilitiesToAssetsPct, 'asc'), quotas.balanceSheet, 'BALANCE_SHEET_STRENGTH');

  if (output.length < limit) addFromBucket(output, seen, rank(eligible, (item) => item?.broadScreen?.score), limit - output.length, 'COMPOSITE_FILL');

  return {
    format: 'investor-control-broad-fundamental-selector',
    version: 1,
    policyVersion: BROAD_FUNDAMENTAL_SELECTOR_VERSION,
    inputCount: candidates.length,
    eligibleCount: eligible.length,
    selectedCount: Math.min(limit, output.length),
    limit,
    laneQuotas: quotas,
    candidates: output.slice(0, limit),
    invariant: 'FUNDAMENTAL_SELECTOR_DIVERSIFIES_RESEARCH_INPUT_AND_NEVER_EMITS_A_FINAL_ACTION',
  };
}
