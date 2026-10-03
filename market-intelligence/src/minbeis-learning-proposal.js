import { createHash } from 'node:crypto';

export const MINBEIS_LEARNING_PROPOSAL_VERSION = '2026-10-03.1';
const BUY_ACTIONS = new Set(['BUY_PROBE','BUY_STARTER','BUY_CORE']);
const round = (value, digits = 4) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function parseComposite(value) {
  const [action, context] = String(value || '').split('|');
  return { action: action || null, context: context || null };
}

function proposalFromCohort(dimension, cohort, createdAt, threshold) {
  if (!cohort?.evidenceReady) return null;
  const aligned = Number(cohort.averageDecisionAlignedReturnPct);
  if (!Number.isFinite(aligned) || aligned > -Math.abs(threshold)) return null;

  const composite = parseComposite(cohort.key);
  if (!BUY_ACTIONS.has(composite.action)) return null;
  const proposal = {
    format: 'investor-control-minbeis-learning-proposal',
    version: 1,
    policyVersion: MINBEIS_LEARNING_PROPOSAL_VERSION,
    proposalId: null,
    createdAt,
    proposalType: 'SUPPRESS_BUY_IN_CONTEXT',
    target: {
      dimension,
      key: cohort.key,
      action: composite.action,
      context: composite.context,
    },
    evidence: {
      sampleSize: cohort.sampleSize,
      distinctDecisionDates: cohort.distinctDecisionDates,
      distinctInstruments: cohort.distinctInstruments,
      averageDecisionAlignedReturnPct: cohort.averageDecisionAlignedReturnPct,
      averageDecisionAlignedExcessPct: cohort.averageDecisionAlignedExcessPct,
      positiveDecisionAlignedRatePct: cohort.positiveDecisionAlignedRatePct,
    },
    championAction: composite.action,
    challengerAction: 'WATCH',
    validationMode: 'PROSPECTIVE_SHADOW_ONLY',
    trainingEvidenceEndsAt: createdAt,
    automaticApplicationAllowed: false,
    requiresExplicitHumanApproval: true,
  };
  proposal.proposalId = 'learning:' + digest(proposal).slice(0, 28);
  proposal.evidenceHash = digest(proposal.evidence);
  return proposal;
}

export function buildMinbeisLearningProposals(contextLearning = {}, options = {}) {
  const createdAt = new Date(options.createdAt || Date.now()).toISOString();
  const threshold = Number(options.minimumNegativeAlignedReturnPct ?? 2);
  const dimensions = ['actionRegime','actionLeadEvent','actionReason'];
  const proposals = [];
  for (const dimension of dimensions) {
    for (const cohort of contextLearning?.cohorts?.[dimension] || []) {
      const proposal = proposalFromCohort(dimension, cohort, createdAt, threshold);
      if (proposal) proposals.push(proposal);
    }
  }
  proposals.sort((a,b) =>
    Number(a.evidence.averageDecisionAlignedReturnPct) - Number(b.evidence.averageDecisionAlignedReturnPct)
    || String(a.proposalId).localeCompare(String(b.proposalId)));
  return {
    format: 'investor-control-minbeis-learning-proposal-set',
    version: 1,
    policyVersion: MINBEIS_LEARNING_PROPOSAL_VERSION,
    generatedAt: createdAt,
    proposalCount: proposals.length,
    proposals,
    automaticApplicationAllowed: false,
    evidenceReuseForValidationAllowed: false,
    validationContract: 'ONLY_DECISIONS_STRICTLY_AFTER_PROPOSAL_CREATION_MAY_VALIDATE_A_PROPOSAL',
  };
}

function recordContext(record, dimension) {
  const research = record?.contextSnapshot?.research || {};
  const decision = record?.contextSnapshot?.decision || {};
  const action = record?.action || null;
  if (dimension === 'actionRegime') {
    const snap = research.marketRegimeSnapshot;
    const regime = typeof snap === 'string' ? snap : snap?.regime || snap?.label || snap?.marketRegime || snap?.state || snap?.riskRegime || null;
    return action && regime ? `${action}|${String(regime).toUpperCase()}` : null;
  }
  if (dimension === 'actionLeadEvent') return action && research.leadEventType ? `${action}|${String(research.leadEventType).toUpperCase()}` : null;
  if (dimension === 'actionReason') {
    const reason = decision.reason || record?.decisionReason || null;
    return action && reason ? `${action}|${reason}` : null;
  }
  return null;
}

export function buildMinbeisProposalShadowObservations(proposal, records = [], options = {}) {
  const horizon = String(options.horizon || '30');
  const createdMs = new Date(proposal?.createdAt || 0).getTime();
  if (!proposal?.proposalId || !Number.isFinite(createdMs)) return [];
  return (Array.isArray(records) ? records : []).map((record) => {
    const decisionMs = new Date(record?.decisionAt || 0).getTime();
    const outcome = record?.horizons?.[horizon];
    if (!Number.isFinite(decisionMs) || decisionMs <= createdMs || outcome?.status !== 'MATURED') return null;
    if (recordContext(record, proposal.target?.dimension) !== proposal.target?.key) return null;
    const realised = Number(outcome.realisedReturnPct);
    if (!Number.isFinite(realised)) return null;
    const championReturnPct = BUY_ACTIONS.has(record.action) ? realised : 0;
    const challengerReturnPct = proposal.proposalType === 'SUPPRESS_BUY_IN_CONTEXT' ? 0 : championReturnPct;
    return {
      proposalId: proposal.proposalId,
      decisionId: record.decisionId,
      decisionAt: record.decisionAt,
      instrumentId: record.instrumentId || record.companyId || record.symbol || null,
      horizon,
      championAction: record.action,
      challengerAction: proposal.challengerAction,
      realisedReturnPct: round(realised),
      championShadowReturnPct: round(championReturnPct),
      challengerShadowReturnPct: round(challengerReturnPct),
      challengerDeltaPct: round(challengerReturnPct - championReturnPct),
      validationMode: 'PROSPECTIVE_SHADOW_OOS',
    };
  }).filter(Boolean);
}
