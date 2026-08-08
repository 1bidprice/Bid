import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const write = (p, v) => fs.writeFileSync(path.join(root, p), v);

function replaceRequired(content, from, to, label) {
  if (content.includes(to)) return content;
  if (!content.includes(from)) throw new Error(`v1.5.3 decision-basis patch failed: missing ${label}`);
  return content.replace(from, to);
}

function replaceRegexRequired(content, regex, replacement, marker, label) {
  if (content.includes(marker)) return content;
  let matched = false;
  const next = content.replace(regex, () => {
    matched = true;
    return replacement;
  });
  if (!matched) throw new Error(`v1.5.3 decision-basis patch failed: missing ${label}`);
  return next;
}

function patchDaily() {
  let source = read('src/run-daily-intelligence.js');
  source = replaceRequired(
    source,
    "import { evaluateInstrumentCapabilities } from './instrument-capability-evaluator.js';",
    "import { evaluateInstrumentCapabilities } from './instrument-capability-evaluator.js';\nimport { buildStructuredDecisionEvidence } from './decision-evidence.js';\nimport { assessDecisionCorroboration } from './decision-corroboration.js';\nimport { synthesizeFundamentalBaseline } from './fundamental-baseline-synthesis.js';",
    'decision-basis imports',
  );

  source = replaceRequired(
    source,
    `  const instrumentCapabilityPassports = [];
  const instrumentCapabilityEvaluations = [];
  const documentLimit =`,
    `  const instrumentCapabilityPassports = [];
  const instrumentCapabilityEvaluations = [];
  const structuredDecisionEvidence = [];
  const decisionCorroborations = [];
  const documentLimit =`,
    'decision-basis output arrays',
  );

  const replacement = `      const companyRecords = [...officialRecords, ...independentRecords];
      const companyClaims = linkEvidenceClaims(companyRecords, { now });
      claimClusters.push(...companyClaims);
      const leadClaim = selectLeadClaim(companyClaims);
      const leadRecords = recordsForClaim(companyRecords, leadClaim);
      const eventCrossCheck = assessIndependentEvidence(leadRecords, now);
      const eventSynthesis = synthesizeEvidenceOnlyResearch({
        company,
        evidence: leadRecords,
        fundamentals: fundamentalSnapshot,
        historicalMarketMetrics: marketMetrics,
        fundamentalRisk,
        generatedAt: now,
      });

      const structured = buildStructuredDecisionEvidence({
        company,
        fundamentals: fundamentalSnapshot,
        marketSnapshot,
        marketMetrics,
        generatedAt: now,
      });
      structuredDecisionEvidence.push(...structured.records);
      evidence.push(...structured.records);
      diagnostics.push(...(structured.diagnostics || []));

      const decisionCorroboration = assessDecisionCorroboration({
        company,
        instrumentProfile,
        structuredEvidence: structured.records,
        fundamentals: fundamentalSnapshot,
        fundamentalRisk,
        marketSnapshot,
        marketMetrics,
        eventCrossCheck,
      });
      decisionCorroborations.push(decisionCorroboration);
      const baselineSynthesis = synthesizeFundamentalBaseline({
        company,
        instrumentProfile,
        decisionCorroboration,
        fundamentals: fundamentalSnapshot,
        fundamentalRisk,
        historicalMarketMetrics: marketMetrics,
        generatedAt: now,
      });

      const eventBasisReady = leadClaim?.recommendationGrade === true
        && eventCrossCheck?.recommendationReady === true
        && (eventSynthesis?.blockers || []).length === 0;
      const baselineBasisReady = decisionCorroboration.ready === true
        && (baselineSynthesis?.blockers || []).length === 0;
      const useBaseline = !eventBasisReady && baselineBasisReady;
      const synthesis = useBaseline ? baselineSynthesis : eventSynthesis;
      const dossierEvidence = useBaseline ? structured.records : leadRecords;
      const decisionBasis = useBaseline ? 'FUNDAMENTAL_BASELINE' : 'EVENT_DRIVEN';

      const dossier = buildResearchDossier({
        company,
        instrumentProfile,
        instrumentRoute,
        instrumentCapabilities,
        instrumentCapabilityEvaluation,
        generatedAt: now,
        decisionBasis,
        decisionCorroboration,
        category: synthesis.category,
        proposedAction: synthesis.proposedAction,
        timeHorizon: synthesis.timeHorizon,
        evidence: dossierEvidence,
        leadClaim: useBaseline ? null : leadClaim,
        requireCanonicalClaim: useBaseline ? false : true,
        fundamentals: fundamentalSnapshot,
        marketSnapshot,
        historicalMarketMetrics: marketMetrics,
        fundamentalRisk,
        crossCheck: eventCrossCheck,
        thesis: synthesis.thesis,
        causalMechanism: synthesis.causalMechanism,
        catalysts: synthesis.catalysts,
        bullCase: synthesis.bullCase,
        bearCase: synthesis.bearCase,
        risks: synthesis.risks,
        invalidationCondition: synthesis.invalidationCondition,
        reviewDate: synthesis.reviewDate,
      });
      researchDossiers.push(dossier);`;

  source = replaceRegexRequired(
    source,
    /      const companyRecords = \[\.\.\.officialRecords, \.\.\.independentRecords\];[\s\S]*?      researchDossiers\.push\(dossier\);/,
    replacement,
    "const decisionBasis = useBaseline ? 'FUNDAMENTAL_BASELINE' : 'EVENT_DRIVEN';",
    'company decision-basis block',
  );

  source = replaceRequired(
    source,
    `    instrumentCapabilityEvaluationCount: instrumentCapabilityEvaluations.length,
    instrumentCapabilityEvaluations,
    fundamentalSnapshotCount:`,
    `    instrumentCapabilityEvaluationCount: instrumentCapabilityEvaluations.length,
    instrumentCapabilityEvaluations,
    structuredDecisionEvidenceCount: structuredDecisionEvidence.length,
    structuredDecisionEvidence,
    decisionCorroborationCount: decisionCorroborations.length,
    decisionCorroborations,
    fundamentalSnapshotCount:`,
    'decision-basis report outputs',
  );
  write('src/run-daily-intelligence.js', source);
}

function patchReadiness() {
  let source = read('src/signal-readiness.js');
  source = replaceRequired(
    source,
    `  if (input.crossCheck?.recommendationReady !== true) blockers.push('INDEPENDENT_CROSS_CHECK_REQUIRED');`,
    `  const baselineDecisionReady = input.decisionBasis === 'FUNDAMENTAL_BASELINE' && input.decisionCorroboration?.ready === true;
  if (input.crossCheck?.recommendationReady !== true && !baselineDecisionReady) blockers.push('INDEPENDENT_CROSS_CHECK_REQUIRED');`,
    'baseline decision cross-check readiness',
  );
  source = replaceRequired(
    source,
    `    crossCheckReady: input.crossCheck?.recommendationReady === true,`,
    `    crossCheckReady: input.crossCheck?.recommendationReady === true,
    decisionBasis: input.decisionBasis || 'EVENT_DRIVEN',
    decisionCorroborationReady: input.decisionCorroboration?.ready === true,
    baselineDecisionReady,`,
    'readiness decision-basis output',
  );
  write('src/signal-readiness.js', source);
}

function patchDossier() {
  let source = read('src/research-dossier.js');
  source = replaceRequired(
    source,
    `  if (input.crossCheck?.recommendationReady !== true) blockers.push('INDEPENDENT_CROSS_CHECK_REQUIRED');`,
    `  const baselineDecisionReady = input.decisionBasis === 'FUNDAMENTAL_BASELINE' && input.decisionCorroboration?.ready === true;
  if (input.crossCheck?.recommendationReady !== true && !baselineDecisionReady) blockers.push('INDEPENDENT_CROSS_CHECK_REQUIRED');`,
    'dossier baseline corroboration',
  );
  source = replaceRequired(
    source,
    `    crossCheck: input.crossCheck,
    thesis: input.thesis,`,
    `    crossCheck: input.crossCheck,
    decisionBasis: input.decisionBasis || 'EVENT_DRIVEN',
    decisionCorroboration: input.decisionCorroboration || null,
    requireCanonicalClaim: input.requireCanonicalClaim === true,
    thesis: input.thesis,`,
    'readiness decision inputs',
  );
  source = replaceRequired(
    source,
    `    origin: company.origin || 'FOCUS_UNIVERSE',`,
    `    origin: company.origin || 'FOCUS_UNIVERSE',
    decisionBasis: input.decisionBasis || 'EVENT_DRIVEN',`,
    'dossier decision basis',
  );
  source = replaceRequired(
    source,
    `      crossCheck: input.crossCheck || null,
      canonicalClaim: input.leadClaim || null,`,
    `      crossCheck: input.crossCheck || null,
      decisionCorroboration: input.decisionCorroboration || null,
      canonicalClaim: input.leadClaim || null,`,
    'dossier decision corroboration metric',
  );
  write('src/research-dossier.js', source);
}

function patchFinalAction() {
  let source = read('src/final-action-policy.js');
  source = replaceRequired(
    source,
    `  if (crossCheck.recommendationReady === true) score += 25;`,
    `  const decisionCorroborated = dossier?.decisionBasis === 'FUNDAMENTAL_BASELINE' && dossier?.metrics?.decisionCorroboration?.ready === true;
  if (crossCheck.recommendationReady === true || decisionCorroborated) score += 25;`,
    'data-quality decision corroboration',
  );
  source = replaceRequired(
    source,
    `  if (crossCheck.recommendationReady === true) score += 20;`,
    `  const decisionCorroborated = dossier?.decisionBasis === 'FUNDAMENTAL_BASELINE' && dossier?.metrics?.decisionCorroboration?.ready === true;
  if (crossCheck.recommendationReady === true || decisionCorroborated) score += 20;`,
    'confidence decision corroboration',
  );
  source = replaceRequired(
    source,
    `  if (crossCheck?.recommendationReady !== true) blockers.push('CROSS_CHECK_NOT_READY');`,
    `  const decisionCorroborated = dossier?.decisionBasis === 'FUNDAMENTAL_BASELINE' && dossier?.metrics?.decisionCorroboration?.ready === true;
  if (crossCheck?.recommendationReady !== true && !decisionCorroborated) blockers.push('CROSS_CHECK_NOT_READY');`,
    'final blocker decision corroboration',
  );
  source = replaceRequired(
    source,
    `  if (referencePriceAgeHours === null || referencePriceAgeHours > Number(options.maxReferencePriceAgeHours ?? 6)) blockers.push('REFERENCE_PRICE_STALE');`,
    `  if (referencePriceAgeHours === null || referencePriceAgeHours > Number(options.maxAnalysisReferencePriceAgeHours ?? 96)) blockers.push('REFERENCE_PRICE_STALE');`,
    'analysis reference freshness horizon',
  );
  write('src/final-action-policy.js', source);
}

patchDaily();
patchReadiness();
patchDossier();
patchFinalAction();

for (const [file, invariants] of Object.entries({
  'src/run-daily-intelligence.js': ['buildStructuredDecisionEvidence', 'assessDecisionCorroboration', 'synthesizeFundamentalBaseline', "'FUNDAMENTAL_BASELINE' : 'EVENT_DRIVEN'", 'structuredDecisionEvidenceCount'],
  'src/signal-readiness.js': ['baselineDecisionReady', 'decisionCorroborationReady'],
  'src/research-dossier.js': ['decisionBasis: input.decisionBasis', 'decisionCorroboration: input.decisionCorroboration', 'baselineDecisionReady'],
  'src/final-action-policy.js': ['decisionCorroborated', 'maxAnalysisReferencePriceAgeHours'],
})) {
  const source = read(file);
  for (const invariant of invariants) if (!source.includes(invariant)) throw new Error(`v1.5.3 verification failed: ${file} missing ${invariant}`);
}

console.log('Investor Control v1.5.3 decision-basis separation and fundamental baseline applied.');
