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
  regex.lastIndex = 0;
  if (!regex.test(content)) throw new Error(`v1.5.3 decision-basis patch failed: missing ${label}`);
  regex.lastIndex = 0;
  return content.replace(regex, replacement);
}

function patchDaily() {
  let source = read('src/run-daily-intelligence.js');
  source = replaceRequired(
    source,
    "import { evaluateInstrumentCapabilities } from './instrument-capability-evaluator.js';",
    "import { evaluateInstrumentCapabilities } from './instrument-capability-evaluator.js';\nimport { buildStructuredDecisionEvidence } from './decision-evidence.js';\nimport { assessDecisionCorroboration } from './decision-corroboration.js';\nimport { synthesizeFundamentalBaseline } from './fundamental-baseline-synthesis.js';",
    'decision-basis imports',
  );

  source = replaceRegexRequired(
    source,
    /(\s*const instrumentCapabilityPassports = \[\];\n\s*const instrumentCapabilityEvaluations = \[\];)/,
    `$1\n  const structuredDecisionEvidence = [];\n  const decisionCorroborations = [];`,
    'const structuredDecisionEvidence = [];',
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

  source = replaceRegexRequired(
    source,
    /(\s*instrumentCapabilityEvaluationCount:\s*instrumentCapabilityEvaluations\.length,\n\s*instrumentCapabilityEvaluations,)/,
    `$1\n    structuredDecisionEvidenceCount: structuredDecisionEvidence.length,\n    structuredDecisionEvidence,\n    decisionCorroborationCount: decisionCorroborations.length,\n    decisionCorroborations,`,
    'structuredDecisionEvidenceCount:',
    'decision-basis report outputs',
  );
  write('src/run-daily-intelligence.js', source);
}

function patchReadiness() {
  let source = read('src/signal-readiness.js');

  source = replaceRegexRequired(
    source,
    /(\s*const crossCheckReady\s*=\s*input\.crossCheck\?\.recommendationReady\s*===\s*true;)/,
    `$1\n  const decisionBasis = input.decisionBasis || 'EVENT_DRIVEN';\n  const decisionCorroborationReady = input.decisionCorroboration?.ready === true;\n  const baselineDecisionReady = decisionBasis === 'FUNDAMENTAL_BASELINE' && decisionCorroborationReady;`,
    'const baselineDecisionReady =',
    'baseline readiness state',
  );

  source = replaceRegexRequired(
    source,
    /if\s*\(\s*!crossCheckReady\s*\)\s*blockers\.push\(['"]INDEPENDENT_CROSS_CHECK_REQUIRED['"]\);/,
    `if (!crossCheckReady && !baselineDecisionReady) blockers.push('INDEPENDENT_CROSS_CHECK_REQUIRED');`,
    'if (!crossCheckReady && !baselineDecisionReady)',
    'baseline decision cross-check readiness',
  );

  source = replaceRegexRequired(
    source,
    /(\s*crossCheckReady,\n)/,
    `$1      decisionBasis,\n      decisionCorroborationReady,\n      baselineDecisionReady,\n`,
    'decisionCorroborationReady,',
    'readiness decision-basis output',
  );
  write('src/signal-readiness.js', source);
}

function patchDossier() {
  let source = read('src/research-dossier.js');

  source = replaceRegexRequired(
    source,
    /(\s*crossCheck,\n\s*thesis:\s*input\.thesis,)/,
    `    crossCheck,\n    decisionBasis: input.decisionBasis || 'EVENT_DRIVEN',\n    decisionCorroboration: input.decisionCorroboration || null,\n    thesis: input.thesis,`,
    'decisionCorroboration: input.decisionCorroboration || null,',
    'readiness decision inputs',
  );

  source = replaceRegexRequired(
    source,
    /(\s*listing:\s*company\.primaryListing\s*\|\|[^\n]+,\n)/,
    `$1    decisionBasis: input.decisionBasis || 'EVENT_DRIVEN',\n`,
    "decisionBasis: input.decisionBasis || 'EVENT_DRIVEN',",
    'dossier decision basis',
  );

  source = replaceRegexRequired(
    source,
    /(\s*crossCheck,\n)(\s*\},\n\s*readiness:)/,
    `$1      decisionCorroboration: input.decisionCorroboration || null,\n$2`,
    'decisionCorroboration: input.decisionCorroboration || null,\n      canonicalClaim',
    'dossier decision corroboration metric',
  );

  write('src/research-dossier.js', source);
}

function patchFinalAction() {
  let source = read('src/final-action-policy.js');

  source = replaceRegexRequired(
    source,
    /(function dataQualityScore\(dossier\) \{[\s\S]*?const crossCheck = dossier\?\.metrics\?\.crossCheck \|\| \{\};)/,
    `$1\n  const decisionCorroborated = dossier?.decisionBasis === 'FUNDAMENTAL_BASELINE' && dossier?.metrics?.decisionCorroboration?.ready === true;`,
    "function dataQualityScore(dossier) {\n  const crossCheck = dossier?.metrics?.crossCheck || {};\n  const decisionCorroborated",
    'data-quality decision corroboration state',
  );
  source = source.replace(
    /if \(crossCheck\.recommendationReady === true\) score \+= 25;/,
    `if (crossCheck.recommendationReady === true || decisionCorroborated) score += 25;`,
  );

  source = replaceRegexRequired(
    source,
    /(function confidenceScore\(dossier, flags\) \{[\s\S]*?const crossCheck = dossier\?\.metrics\?\.crossCheck \|\| \{\};)/,
    `$1\n  const decisionCorroborated = dossier?.decisionBasis === 'FUNDAMENTAL_BASELINE' && dossier?.metrics?.decisionCorroboration?.ready === true;`,
    "function confidenceScore(dossier, flags) {\n  const crossCheck = dossier?.metrics?.crossCheck || {};\n  const decisionCorroborated",
    'confidence decision corroboration state',
  );
  source = source.replace(
    /if \(crossCheck\.recommendationReady === true\) score \+= 20;/,
    `if (crossCheck.recommendationReady === true || decisionCorroborated) score += 20;`,
  );

  source = replaceRegexRequired(
    source,
    /(\s*const crossCheck = dossier\?\.metrics\?\.crossCheck \|\| null;\n)/,
    `$1  const decisionCorroborated = dossier?.decisionBasis === 'FUNDAMENTAL_BASELINE' && dossier?.metrics?.decisionCorroboration?.ready === true;\n`,
    "const decisionCorroborated = dossier?.decisionBasis === 'FUNDAMENTAL_BASELINE' && dossier?.metrics?.decisionCorroboration?.ready === true;\n  const referencePriceAgeHours",
    'final blocker decision corroboration state',
  );
  source = source.replace(
    /if \(crossCheck\?\.recommendationReady !== true\) blockers\.push\(['"]CROSS_CHECK_NOT_READY['"]\);/,
    `if (crossCheck?.recommendationReady !== true && !decisionCorroborated) blockers.push('CROSS_CHECK_NOT_READY');`,
  );

  source = source.replace(
    /if \(referencePriceAgeHours === null \|\| referencePriceAgeHours > Number\(options\.maxReferencePriceAgeHours \?\? \d+\)\) blockers\.push\(['"]REFERENCE_PRICE_STALE['"]\);/,
    `if (referencePriceAgeHours === null || referencePriceAgeHours > Number(options.maxAnalysisReferencePriceAgeHours ?? 96)) blockers.push('REFERENCE_PRICE_STALE');`,
  );

  write('src/final-action-policy.js', source);
}

patchDaily();
patchReadiness();
patchDossier();
patchFinalAction();

for (const [file, invariants] of Object.entries({
  'src/run-daily-intelligence.js': ['buildStructuredDecisionEvidence', 'assessDecisionCorroboration', 'synthesizeFundamentalBaseline', "'FUNDAMENTAL_BASELINE' : 'EVENT_DRIVEN'", 'structuredDecisionEvidenceCount'],
  'src/signal-readiness.js': ['baselineDecisionReady', 'decisionCorroborationReady', "!crossCheckReady && !baselineDecisionReady"],
  'src/research-dossier.js': ["decisionBasis: input.decisionBasis || 'EVENT_DRIVEN'", 'decisionCorroboration: input.decisionCorroboration || null'],
  'src/final-action-policy.js': ['decisionCorroborated', 'maxAnalysisReferencePriceAgeHours'],
})) {
  const source = read(file);
  for (const invariant of invariants) if (!source.includes(invariant)) throw new Error(`v1.5.3 verification failed: ${file} missing ${invariant}`);
}

console.log('Investor Control v1.5.3 decision-basis separation and fundamental baseline applied.');
