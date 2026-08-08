import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const write = (p, v) => fs.writeFileSync(path.join(root, p), v);

function replaceRequired(content, from, to, label) {
  if (content.includes(to)) return content;
  if (!content.includes(from)) throw new Error(`v1.5.6 patch failed: missing ${label}`);
  return content.replace(from, to);
}

function patchCanonicalQuote() {
  let source = read('src/canonical-market-quote.js');

  source = replaceRequired(
    source,
    "import { evaluateSourceCandidate, PURPOSES, SOURCE_ROLES } from './source-governor.js';",
    "import { evaluateSourceCandidate, PURPOSES, SOURCE_ROLES } from './source-governor.js';\nimport { evaluateMarketSession, evaluateClosedMarketCarry, MARKET_SESSION_POLICY_VERSION } from './market-session.js';",
    'market-session import',
  );
  source = source.replace(
    "export const CANONICAL_QUOTE_CONTRACT_VERSION = '2026-08-04.1';",
    "export const CANONICAL_QUOTE_CONTRACT_VERSION = '2026-08-08.2';",
  );

  source = replaceRequired(
    source,
    'function publicStatus({ price, quoteAt, stale, sourceRole, timestampVerified }) {',
    'function publicStatus({ price, quoteAt, stale, sourceRole, timestampVerified, closedMarketCarry }) {',
    'closed-market public status input',
  );
  source = replaceRequired(
    source,
    "  if (stale) return 'STALE';\n  if (sourceRole === SOURCE_ROLES.FALLBACK_UNVERIFIED) return 'FALLBACK_NOT_VERIFIED';",
    "  if (stale) return 'STALE';\n  if (closedMarketCarry) return 'MARKET_CLOSED_LAST_CLOSE';\n  if (sourceRole === SOURCE_ROLES.FALLBACK_UNVERIFIED) return 'FALLBACK_NOT_VERIFIED';",
    'closed-market public status',
  );
  source = replaceRequired(
    source,
    "  if (status === 'STALE') return 'Η τελευταία τιμή είναι παρωχημένη και δεν χρησιμοποιείται σε αποτίμηση ή απόφαση.';",
    "  if (status === 'STALE') return 'Η τελευταία τιμή είναι παρωχημένη και δεν χρησιμοποιείται σε αποτίμηση ή απόφαση.';\n  if (status === 'MARKET_CLOSED_LAST_CLOSE') return 'Η αγορά είναι εκτός βασικής συνεδρίασης. Χρησιμοποιείται το τελευταίο επαληθευμένο κλείσιμο μόνο για αποτίμηση και ανάλυση, όχι για εκτέλεση.';",
    'closed-market public message',
  );

  source = replaceRequired(
    source,
    `  const maxAgeHours = Number(options.maxCanonicalQuoteAgeHours ?? 6);
  const stale = snapshot.stale === true || ageHours === null || ageHours > maxAgeHours;
  const status = publicStatus({
    price,
    quoteAt: quoteAtValid ? quoteAt.toISOString() : null,
    stale,
    sourceRole: sourceDecision.sourceRole,
    timestampVerified,
  });`,
    `  const maxAgeHours = Number(options.maxCanonicalQuoteAgeHours ?? 6);
  const maxClosedMarketAnalysisAgeHours = Number(options.maxClosedMarketAnalysisAgeHours ?? 120);
  const marketSession = evaluateMarketSession(company, generatedAt);
  const closedCarry = quoteAtValid
    ? evaluateClosedMarketCarry(company, quoteAt, generatedAt, { maxAgeHours: maxClosedMarketAnalysisAgeHours })
    : { eligible: false, reason: 'TIMESTAMP_INVALID', session: marketSession };
  const strictAgeFresh = ageHours !== null && ageHours <= maxAgeHours;
  const closedMarketCarry = closedCarry.eligible === true && !strictAgeFresh;
  const stale = ageHours === null || (!strictAgeFresh && !closedMarketCarry);
  const status = publicStatus({
    price,
    quoteAt: quoteAtValid ? quoteAt.toISOString() : null,
    stale,
    sourceRole: sourceDecision.sourceRole,
    timestampVerified,
    closedMarketCarry,
  });`,
    'closed-market freshness state',
  );

  source = replaceRequired(
    source,
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
    `  const baseEligible = price !== null && quoteAtValid && !stale && sourceDecision.allowed;
  const valuationEligible = baseEligible && sourceDecision.sourceRole !== SOURCE_ROLES.FALLBACK_UNVERIFIED;
  const advertisedDelayMinutes = finite(snapshot.advertisedDelayMinutes);
  const boundedOfficialDelay = valuationEligible
    && sourceDecision.sourceRole === SOURCE_ROLES.PRIMARY_EXCHANGE
    && advertisedDelayMinutes !== null
    && advertisedDelayMinutes > 0
    && advertisedDelayMinutes <= Number(options.maxOfficialAnalysisDelayMinutes ?? 30);
  const analysisReferenceEligible = valuationEligible && (timestampVerified || boundedOfficialDelay);
  const executionFreshnessEligible = valuationEligible
    && strictAgeFresh
    && marketSession.coreOpen === true
    && sourceDecision.decisionEligible
    && timestampVerified;
  const decisionEligible = executionFreshnessEligible;
  const dayChangeEligible = executionFreshnessEligible && previousClose !== null;
  if (closedMarketCarry) diagnostics.push('QUOTE_CLOSED_MARKET_LAST_CLOSE');
  if (analysisReferenceEligible && marketSession.expectedClosed === true) diagnostics.push('QUOTE_EXECUTION_MARKET_CLOSED');
  if (analysisReferenceEligible && !executionFreshnessEligible) diagnostics.push('QUOTE_ANALYSIS_REFERENCE_ONLY');`,
    'closed-market eligibility separation',
  );

  source = replaceRequired(
    source,
    `      advertisedDelayMinutes: advertisedDelayMinutes === null ? null : advertisedDelayMinutes,
      freshnessModel: executionFreshnessEligible
        ? 'VERIFIED_TIMESTAMP'
        : boundedOfficialDelay
          ? 'OFFICIAL_BOUNDED_DELAY_ANALYSIS_ONLY'
          : 'UNVERIFIED',`,
    `      advertisedDelayMinutes: advertisedDelayMinutes === null ? null : advertisedDelayMinutes,
      marketSessionPolicyVersion: MARKET_SESSION_POLICY_VERSION,
      marketSessionState: marketSession.state,
      marketSessionCoreOpen: marketSession.coreOpen === true,
      closedMarketCarryEligible: closedMarketCarry,
      closedMarketCarryReason: closedCarry.reason || null,
      maxClosedMarketAnalysisAgeHours,
      freshnessModel: executionFreshnessEligible
        ? 'VERIFIED_TIMESTAMP'
        : closedMarketCarry
          ? 'CLOSED_MARKET_LAST_VERIFIED_CLOSE'
          : boundedOfficialDelay
            ? 'OFFICIAL_BOUNDED_DELAY_ANALYSIS_ONLY'
            : 'UNVERIFIED',`,
    'closed-market quote contract fields',
  );

  write('src/canonical-market-quote.js', source);
}

patchCanonicalQuote();

const verified = read('src/canonical-market-quote.js');
for (const invariant of [
  "CANONICAL_QUOTE_CONTRACT_VERSION = '2026-08-08.2'",
  'evaluateClosedMarketCarry',
  'CLOSED_MARKET_LAST_VERIFIED_CLOSE',
  'QUOTE_CLOSED_MARKET_LAST_CLOSE',
  'QUOTE_EXECUTION_MARKET_CLOSED',
  'marketSessionCoreOpen',
  'maxClosedMarketAnalysisAgeHours',
]) {
  if (!verified.includes(invariant)) throw new Error(`v1.5.6 verification failed: missing ${invariant}`);
}

console.log('Investor Control v1.5.6 closed-market last-close analysis reference applied.');
