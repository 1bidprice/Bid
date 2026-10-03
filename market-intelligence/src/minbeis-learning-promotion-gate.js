export const MINBEIS_LEARNING_PROMOTION_GATE_VERSION = '2026-10-03.1';

const round = (value, digits = 4) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

function mean(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((a,b)=>a+b,0)/valid.length : null;
}

function blocks(rows, count) {
  const sorted = rows.slice().sort((a,b)=>String(a.decisionAt).localeCompare(String(b.decisionAt)) || String(a.decisionId).localeCompare(String(b.decisionId)));
  return Array.from({length:count},(_,i)=>{
    const s=Math.floor(i*sorted.length/count);
    const e=Math.floor((i+1)*sorted.length/count);
    return sorted.slice(s,e);
  });
}

export function evaluateMinbeisLearningPromotionGate(proposal, observations = [], options = {}) {
  const rows = (Array.isArray(observations) ? observations : []).filter((x)=>
    x?.proposalId === proposal?.proposalId &&
    x?.validationMode === 'PROSPECTIVE_SHADOW_OOS' &&
    Number.isFinite(Number(x?.challengerDeltaPct)));
  const minimumSample = Math.max(20, Number(options.minimumSample || 60));
  const minimumDistinctDates = Math.max(10, Number(options.minimumDistinctDates || 30));
  const minimumDistinctInstruments = Math.max(5, Number(options.minimumDistinctInstruments || 10));
  const minimumAverageDeltaPct = Number(options.minimumAverageDeltaPct ?? 0.75);
  const minimumWinRatePct = Number(options.minimumWinRatePct ?? 55);
  const blockCount = Math.max(2, Number(options.blockCount || 3));
  const minimumBlockSample = Math.max(5, Number(options.minimumBlockSample || 15));
  const dates = new Set(rows.map((x)=>String(x.decisionAt||'').slice(0,10)).filter(Boolean));
  const instruments = new Set(rows.map((x)=>x.instrumentId).filter(Boolean));
  const deltas = rows.map((x)=>Number(x.challengerDeltaPct));
  const averageDelta = mean(deltas);
  const winRate = deltas.length ? deltas.filter((x)=>x>0).length/deltas.length*100 : null;
  const subperiods = blocks(rows, blockCount).map((block,index)=>{
    const vals=block.map((x)=>Number(x.challengerDeltaPct)).filter(Number.isFinite);
    const avg=mean(vals);
    const blockers=[];
    if (block.length < minimumBlockSample) blockers.push('PROMOTION_SUBPERIOD_SAMPLE_TOO_SMALL');
    if (!Number.isFinite(avg) || avg <= 0) blockers.push('PROMOTION_SUBPERIOD_CHALLENGER_NOT_BETTER');
    return {index,sampleSize:block.length,averageDeltaPct:round(avg),status:blockers.length?'UNSTABLE':'STABLE',blockers};
  });
  const blockers=[];
  if (rows.length < minimumSample) blockers.push('PROMOTION_PROSPECTIVE_SAMPLE_TOO_SMALL');
  if (dates.size < minimumDistinctDates) blockers.push('PROMOTION_DATE_DIVERSITY_TOO_LOW');
  if (instruments.size < minimumDistinctInstruments) blockers.push('PROMOTION_INSTRUMENT_DIVERSITY_TOO_LOW');
  if (!Number.isFinite(averageDelta) || averageDelta < minimumAverageDeltaPct) blockers.push('PROMOTION_CHALLENGER_ADVANTAGE_TOO_SMALL');
  if (!Number.isFinite(winRate) || winRate < minimumWinRatePct) blockers.push('PROMOTION_WIN_RATE_TOO_LOW');
  if (subperiods.some((x)=>x.status!=='STABLE')) blockers.push('PROMOTION_NOT_STABLE_ACROSS_SUBPERIODS');

  const promotionCandidate = blockers.length===0;
  return {
    format:'investor-control-minbeis-learning-promotion-gate',
    version:1,
    policyVersion:MINBEIS_LEARNING_PROMOTION_GATE_VERSION,
    proposalId:proposal?.proposalId||null,
    status:promotionCandidate?'PROMOTION_CANDIDATE':'SHADOW_RESEARCH_ONLY',
    promotionCandidate,
    prospectiveObservationCount:rows.length,
    distinctDecisionDates:dates.size,
    distinctInstruments:instruments.size,
    averageChallengerDeltaPct:round(averageDelta),
    challengerWinRatePct:round(winRate,2),
    subperiods,
    blockers,
    thresholds:{minimumSample,minimumDistinctDates,minimumDistinctInstruments,minimumAverageDeltaPct,minimumWinRatePct,blockCount,minimumBlockSample},
    automaticPromotionAllowed:false,
    productionMutationAllowed:false,
    requiresExplicitHumanApproval:true,
    requiresReleaseRegressionSuite:true,
  };
}
