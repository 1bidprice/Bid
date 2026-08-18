import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function write(relativePath, content) {
  fs.writeFileSync(path.join(root, relativePath), content);
}

function replaceRequired(content, from, to, label) {
  if (content.includes(to)) return content;
  if (!content.includes(from)) throw new Error(`v1.2.7 decision-grade reference patch failed: missing ${label}`);
  return content.replace(from, to);
}

function patchCanonicalQuoteContract() {
  let source = read('src/canonical-market-quote.js');

  source = replaceRequired(
    source,
    `  const baseEligible = price !== null && quoteAtValid && !stale && sourceDecision.allowed;
  const valuationEligible = baseEligible && sourceDecision.sourceRole !== SOURCE_ROLES.FALLBACK_UNVERIFIED;
  const decisionEligible = valuationEligible && sourceDecision.decisionEligible && timestampVerified;
  const dayChangeEligible = decisionEligible && previousClose !== null;`,
    `  const baseEligible = price !== null && quoteAtValid && !stale && sourceDecision.allowed;
  const valuationEligible = baseEligible && sourceDecision.sourceRole !== SOURCE_ROLES.FALLBACK_UNVERIFIED;
  const advertisedDelayMinutes = finite(snapshot.advertisedDelayMinutes);
  const boundedOfficialDelay = valuationEligible
    && sourceDecision.sourceRole === SOURCE_ROLES.PRIMARY_EXCHANGE
    && advertisedDelayMinutes !== null
    && advertisedDelayMinutes > 0
    && advertisedDelayMinutes <= Number(options.maxOfficialAnalysisDelayMinutes ?? 30);
  const analysisReferenceEligible = valuationEligible && (timestampVerified || boundedOfficialDelay);
  const executionFreshnessEligible = valuationEligible && sourceDecision.decisionEligible && timestampVerified;
  const decisionEligible = executionFreshnessEligible;
  const dayChangeEligible = executionFreshnessEligible && previousClose !== null;
  if (analysisReferenceEligible && !executionFreshnessEligible) diagnostics.push('QUOTE_ANALYSIS_REFERENCE_ONLY');`,
    'analysis/execution quote separation',
  );

  source = replaceRequired(
    source,
    `      valuationEligible,
      decisionEligible,
      dayChangeEligible,`,
    `      valuationEligible,
      analysisReferenceEligible,
      executionFreshnessEligible,
      decisionEligible,
      dayChangeEligible,
      advertisedDelayMinutes: advertisedDelayMinutes === null ? null : advertisedDelayMinutes,
      freshnessModel: executionFreshnessEligible
        ? 'VERIFIED_TIMESTAMP'
        : boundedOfficialDelay
          ? 'OFFICIAL_BOUNDED_DELAY_ANALYSIS_ONLY'
          : 'UNVERIFIED',`,
    'quote contract grades',
  );

  write('src/canonical-market-quote.js', source);
}

function patchResearchReferencePrice() {
  let source = read('src/research-dossier.js');

  source = replaceRequired(
    source,
    `function referencePrice(marketSnapshot, historicalMetrics) {
  const quoteContractAllowsDecision = marketSnapshot?.quoteContract
    ? marketSnapshot.quoteContract.decisionEligible === true
    : marketSnapshot?.usable === true;
  if (quoteContractAllowsDecision && !marketSnapshot.stale && marketSnapshot.currentPrice > 0 && marketSnapshot.quoteAt) {
    return {
      value: marketSnapshot.currentPrice,
      currency: marketSnapshot.currency,
      timestamp: marketSnapshot.quoteAt,
      source: marketSnapshot.source,
    };
  }
  if (historicalMetrics?.latestClose > 0 && historicalMetrics.latestTimestamp) {
    return {
      value: historicalMetrics.latestClose,
      currency: historicalMetrics.currency,
      timestamp: new Date(historicalMetrics.latestTimestamp * 1000).toISOString(),
      source: 'Historical market series',
    };
  }
  return null;
}`,
    `function referencePrice(marketSnapshot, historicalMetrics) {
  const quoteContractAllowsAnalysis = marketSnapshot?.quoteContract
    ? marketSnapshot.quoteContract.analysisReferenceEligible === true
    : marketSnapshot?.usable === true;
  if (quoteContractAllowsAnalysis && !marketSnapshot.stale && marketSnapshot.currentPrice > 0 && marketSnapshot.quoteAt) {
    return {
      value: marketSnapshot.currentPrice,
      currency: marketSnapshot.currency,
      timestamp: marketSnapshot.quoteAt,
      source: marketSnapshot.source,
      purpose: 'ANALYSIS_REFERENCE',
      analysisReferenceEligible: true,
      executionFreshnessEligible: marketSnapshot?.quoteContract?.executionFreshnessEligible === true,
      decisionEligible: marketSnapshot?.quoteContract?.decisionEligible === true,
      freshnessModel: marketSnapshot?.quoteContract?.freshnessModel || null,
    };
  }
  if (historicalMetrics?.latestClose > 0 && historicalMetrics.latestTimestamp) {
    return {
      value: historicalMetrics.latestClose,
      currency: historicalMetrics.currency,
      timestamp: new Date(historicalMetrics.latestTimestamp * 1000).toISOString(),
      source: 'Historical market series',
      purpose: 'HISTORICAL_REFERENCE',
      analysisReferenceEligible: true,
      executionFreshnessEligible: false,
      decisionEligible: false,
      freshnessModel: 'HISTORICAL_CLOSE',
    };
  }
  return null;
}`,
    'research analysis reference selection',
  );

  write('src/research-dossier.js', source);
}

function patchFinalActionExecutionGate() {
  let source = read('src/final-action-policy.js');

  source = replaceRequired(
    source,
    `  const adequateLiquidity = liquidityScore >= Number(options.minimumImmediateLiquidityScore ?? 65);`,
    `  const adequateLiquidity = liquidityScore >= Number(options.minimumImmediateLiquidityScore ?? 65);
  const executionFreshnessEligible = dossier?.referencePrice?.executionFreshnessEligible === true;`,
    'execution freshness input',
  );

  source = replaceRequired(
    source,
    `  if (severeRisk) {
    return {
      marketAction: FINAL_ACTIONS.AVOID,
      holderAction: FINAL_ACTIONS.SELL_NOW,
      nonHolderAction: FINAL_ACTIONS.AVOID,
      urgency: immediateFresh ? 'IMMEDIATE' : 'TODAY',
      reasons: ['SEVERE_RISK_CONFIGURATION'],
    };
  }`,
    `  if (severeRisk) {
    return {
      marketAction: FINAL_ACTIONS.AVOID,
      holderAction: executionFreshnessEligible ? FINAL_ACTIONS.SELL_NOW : FINAL_ACTIONS.HOLD,
      nonHolderAction: FINAL_ACTIONS.AVOID,
      urgency: executionFreshnessEligible && immediateFresh ? 'IMMEDIATE' : 'TODAY',
      reasons: unique(['SEVERE_RISK_CONFIGURATION', executionFreshnessEligible ? null : 'EXECUTION_PRICE_NOT_VERIFIED']),
    };
  }`,
    'severe risk execution guard',
  );

  source = replaceRequired(
    source,
    `  if (proposed === 'CONSIDER_REDUCE') {
    return {
      marketAction: FINAL_ACTIONS.DO_NOT_BUY,
      holderAction: FINAL_ACTIONS.SELL_NOW,
      nonHolderAction: FINAL_ACTIONS.DO_NOT_BUY,
      urgency: immediateFresh ? 'IMMEDIATE' : 'TODAY',
      reasons: ['DIRECTIONAL_REDUCTION_SIGNAL'],
    };
  }`,
    `  if (proposed === 'CONSIDER_REDUCE') {
    return {
      marketAction: FINAL_ACTIONS.DO_NOT_BUY,
      holderAction: executionFreshnessEligible ? FINAL_ACTIONS.SELL_NOW : FINAL_ACTIONS.HOLD,
      nonHolderAction: FINAL_ACTIONS.DO_NOT_BUY,
      urgency: executionFreshnessEligible && immediateFresh ? 'IMMEDIATE' : 'TODAY',
      reasons: unique(['DIRECTIONAL_REDUCTION_SIGNAL', executionFreshnessEligible ? null : 'EXECUTION_PRICE_NOT_VERIFIED']),
    };
  }`,
    'reduce execution guard',
  );

  source = replaceRequired(
    source,
    `  if (proposed === 'AVOID') {
    return {
      marketAction: FINAL_ACTIONS.AVOID,
      holderAction: weakTrend ? FINAL_ACTIONS.SELL_NOW : FINAL_ACTIONS.HOLD,
      nonHolderAction: FINAL_ACTIONS.AVOID,
      urgency: weakTrend && immediateFresh ? 'IMMEDIATE' : 'TODAY',
      reasons: ['AVOIDANCE_SIGNAL'],
    };
  }`,
    `  if (proposed === 'AVOID') {
    const sellApproved = weakTrend && executionFreshnessEligible;
    return {
      marketAction: FINAL_ACTIONS.AVOID,
      holderAction: sellApproved ? FINAL_ACTIONS.SELL_NOW : FINAL_ACTIONS.HOLD,
      nonHolderAction: FINAL_ACTIONS.AVOID,
      urgency: sellApproved && immediateFresh ? 'IMMEDIATE' : 'TODAY',
      reasons: unique(['AVOIDANCE_SIGNAL', weakTrend && !executionFreshnessEligible ? 'EXECUTION_PRICE_NOT_VERIFIED' : null]),
    };
  }`,
    'avoid execution guard',
  );

  source = replaceRequired(
    source,
    `    if (immediateFresh && adequateLiquidity && positiveTrend && riskScore <= 55 && confidence >= 80) {`,
    `    if (executionFreshnessEligible && immediateFresh && adequateLiquidity && positiveTrend && riskScore <= 55 && confidence >= 80) {`,
    'buy-now execution freshness gate',
  );

  source = replaceRequired(
    source,
    `      reasons: ['BUY_SETUP_NOT_CONFIRMED'],`,
    `      reasons: unique(['BUY_SETUP_NOT_CONFIRMED', executionFreshnessEligible ? null : 'EXECUTION_PRICE_NOT_VERIFIED']),`,
    'buy setup execution reason',
  );

  source = replaceRequired(
    source,
    `    freshness: {
      referencePriceAgeHours: freshness.referencePriceAgeHours,
      dossierAgeHours: freshness.dossierAgeHours,
      latestMarketAgeHours: freshness.latestMarketAgeHours,
    },`,
    `    freshness: {
      referencePriceAgeHours: freshness.referencePriceAgeHours,
      dossierAgeHours: freshness.dossierAgeHours,
      latestMarketAgeHours: freshness.latestMarketAgeHours,
      referencePricePurpose: dossier?.referencePrice?.purpose || null,
      referencePriceFreshnessModel: dossier?.referencePrice?.freshnessModel || null,
      executionFreshnessEligible: dossier?.referencePrice?.executionFreshnessEligible === true,
    },`,
    'final action price-grade transparency',
  );

  write('src/final-action-policy.js', source);
}

patchCanonicalQuoteContract();
patchResearchReferencePrice();
patchFinalActionExecutionGate();

for (const [file, invariants] of Object.entries({
  'src/canonical-market-quote.js': ['analysisReferenceEligible', 'executionFreshnessEligible', 'OFFICIAL_BOUNDED_DELAY_ANALYSIS_ONLY', 'QUOTE_ANALYSIS_REFERENCE_ONLY'],
  'src/research-dossier.js': ["purpose: 'ANALYSIS_REFERENCE'", "purpose: 'HISTORICAL_REFERENCE'", 'executionFreshnessEligible'],
  'src/final-action-policy.js': ['EXECUTION_PRICE_NOT_VERIFIED', 'executionFreshnessEligible', 'referencePriceFreshnessModel'],
})) {
  const source = read(file);
  for (const invariant of invariants) {
    if (!source.includes(invariant)) throw new Error(`v1.2.7 verification failed: ${file} missing ${invariant}`);
  }
}

console.log('Investor Control market intelligence v1.2.7 decision-grade reference model applied.');
