import { evaluateSourceCandidate, PURPOSES, SOURCE_ROLES } from './source-governor.js';
import { evaluateMarketSession, evaluateClosedMarketCarry, MARKET_SESSION_POLICY_VERSION } from './market-session.js';

export const CANONICAL_QUOTE_CONTRACT_VERSION = '2026-08-08.2';

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positive(value) {
  const number = finite(value);
  return number !== null && number > 0 ? number : null;
}

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function marketOf(company = {}) {
  const mic = String(company.primaryListing?.mic || '').toUpperCase();
  const exchange = String(company.primaryListing?.exchange || '').toUpperCase();
  const country = String(company.country || '').toUpperCase();
  if (mic === 'XATH' || exchange.includes('ATHENS') || country === 'GR') return 'GR';
  if (['XNYS', 'XNAS', 'ARCX'].includes(mic) || country === 'US' || exchange.includes('NASDAQ') || exchange.includes('NEW YORK')) return 'US';
  return country || 'GLOBAL';
}

function appSymbol(snapshot = {}, company = {}) {
  const symbol = String(snapshot.symbol || company.primaryListing?.symbol || '').trim().toUpperCase();
  if (!symbol) return null;
  const market = marketOf(company);
  if (market === 'GR' && !symbol.endsWith('.GR')) return `${symbol}.GR`;
  if (market === 'US' && !symbol.endsWith('.US')) return `${symbol}.US`;
  return symbol;
}

function deriveSourceDecision(snapshot = {}, company = {}) {
  const source = String(snapshot.source || '');
  const sourceUrl = snapshot.sourceUrl || null;
  const sourceQuality = String(snapshot.sourceQuality || '').toUpperCase();
  const market = marketOf(company);

  if (/Euronext/i.test(source) || /euronext\.com/i.test(String(sourceUrl || ''))) {
    return {
      allowed: true,
      sourceRole: SOURCE_ROLES.PRIMARY_EXCHANGE,
      tier: 1,
      decisionEligible: true,
      corroborationEligible: false,
      reasons: [],
    };
  }
  if (/Finnhub/i.test(source) || sourceQuality === 'PRIMARY_LICENSED') {
    return {
      allowed: true,
      sourceRole: SOURCE_ROLES.LICENSED_MARKET_DATA,
      tier: 1,
      decisionEligible: true,
      corroborationEligible: false,
      reasons: [],
    };
  }
  if (/Yahoo/i.test(source) || sourceQuality.includes('FALLBACK')) {
    return {
      allowed: true,
      sourceRole: SOURCE_ROLES.FALLBACK_UNVERIFIED,
      tier: 4,
      decisionEligible: false,
      corroborationEligible: false,
      reasons: ['FALLBACK_SOURCE_NOT_DECISION_ELIGIBLE'],
    };
  }

  return evaluateSourceCandidate({
    purpose: PURPOSES.CURRENT_QUOTE,
    market,
    url: sourceUrl,
    sourceName: source,
    issuerUrl: company.investorRelationsUrl || company.website,
  });
}

function publicStatus({ price, quoteAt, stale, sourceRole, timestampVerified, closedMarketCarry }) {
  if (price === null || !quoteAt) return 'UNAVAILABLE';
  if (stale) return 'STALE';
  if (closedMarketCarry) return 'MARKET_CLOSED_LAST_CLOSE';
  if (sourceRole === SOURCE_ROLES.FALLBACK_UNVERIFIED) return 'FALLBACK_NOT_VERIFIED';
  if (!timestampVerified) return 'TIMESTAMP_NOT_VERIFIED';
  if (sourceRole === SOURCE_ROLES.PRIMARY_EXCHANGE) return 'OFFICIAL_DELAYED_OR_EXCHANGE';
  return 'VERIFIED';
}

function publicMessage(status, snapshot = {}) {
  if (status === 'UNAVAILABLE') return 'Δεν υπάρχει διαθέσιμη και επαληθεύσιμη τιμή.';
  if (status === 'STALE') return 'Η τελευταία τιμή είναι παρωχημένη και δεν χρησιμοποιείται σε αποτίμηση ή απόφαση.';
  if (status === 'MARKET_CLOSED_LAST_CLOSE') return 'Η αγορά είναι εκτός βασικής συνεδρίασης. Χρησιμοποιείται το τελευταίο επαληθευμένο κλείσιμο μόνο για αποτίμηση και ανάλυση, όχι για εκτέλεση.';
  if (status === 'FALLBACK_NOT_VERIFIED') return 'Η εφεδρική τιμή εμφανίζεται μόνο πληροφοριακά και δεν χρησιμοποιείται σε αποτίμηση ή τελική απόφαση.';
  if (status === 'TIMESTAMP_NOT_VERIFIED') return 'Η τιμή προέρχεται από επιτρεπόμενη πηγή, αλλά ο χρόνος της δεν έχει επιβεβαιωθεί επαρκώς.';
  if (status === 'OFFICIAL_DELAYED_OR_EXCHANGE') {
    return Number(snapshot.advertisedDelayMinutes || 0) > 0
      ? `Επίσημη χρηματιστηριακή τιμή με δηλωμένη καθυστέρηση ${Number(snapshot.advertisedDelayMinutes)} λεπτών.`
      : 'Επίσημη χρηματιστηριακή τιμή.';
  }
  return 'Επαληθευμένη χρηματιστηριακή τιμή από εγκεκριμένη πηγή.';
}

export function canonicalizeMarketSnapshot(snapshot, company = {}, options = {}) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const generatedAt = new Date(options.generatedAt || snapshot.generatedAt || Date.now());
  const quoteAt = snapshot.quoteAt ? new Date(snapshot.quoteAt) : null;
  const quoteAtValid = quoteAt && !Number.isNaN(quoteAt.getTime());
  const ageHours = quoteAtValid
    ? Math.max(0, (generatedAt.getTime() - quoteAt.getTime()) / 3_600_000)
    : finite(snapshot.ageHours);
  const price = positive(snapshot.currentPrice);
  const previousClose = positive(snapshot.previousClose);
  const sourceDecision = deriveSourceDecision(snapshot, company);
  const timestampVerified = snapshot.quoteTimestampVerified !== false && Boolean(quoteAtValid);
  const maxAgeHours = Number(options.maxCanonicalQuoteAgeHours ?? 6);
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
  });

  const diagnostics = [];
  if (price === null) diagnostics.push('QUOTE_PRICE_MISSING');
  if (!quoteAtValid) diagnostics.push('QUOTE_TIMESTAMP_MISSING');
  if (stale) diagnostics.push('QUOTE_STALE');
  if (!sourceDecision.allowed) diagnostics.push('QUOTE_SOURCE_NOT_APPROVED');
  if (!sourceDecision.decisionEligible) diagnostics.push('QUOTE_SOURCE_NOT_DECISION_ELIGIBLE');
  if (!timestampVerified) diagnostics.push('QUOTE_TIMESTAMP_NOT_VERIFIED');
  if (previousClose === null) diagnostics.push('PREVIOUS_CLOSE_NOT_VERIFIED');

  const baseEligible = price !== null && quoteAtValid && !stale && sourceDecision.allowed;
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
  if (analysisReferenceEligible && !executionFreshnessEligible) diagnostics.push('QUOTE_ANALYSIS_REFERENCE_ONLY');

  return {
    ...snapshot,
    appSymbol: appSymbol(snapshot, company),
    companyId: snapshot.companyId || company.companyId || null,
    companyName: snapshot.companyName || company.displayName || company.legalName || null,
    currentPrice: price,
    previousClose,
    ageHours: ageHours === null ? null : round(ageHours, 2),
    stale,
    usable: valuationEligible,
    quoteContract: {
      version: CANONICAL_QUOTE_CONTRACT_VERSION,
      sourceRole: sourceDecision.sourceRole,
      sourceTier: sourceDecision.tier ?? null,
      sourceApproved: sourceDecision.allowed === true,
      timestampVerified,
      valuationEligible,
      analysisReferenceEligible,
      executionFreshnessEligible,
      decisionEligible,
      dayChangeEligible,
      advertisedDelayMinutes: advertisedDelayMinutes === null ? null : advertisedDelayMinutes,
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
            : 'UNVERIFIED',
      publicStatus: status,
      publicMessage: publicMessage(status, snapshot),
      diagnosticCodes: [...new Set([...diagnostics, ...(sourceDecision.reasons || [])])],
    },
  };
}

export function buildCanonicalQuoteRegistry(snapshots = []) {
  const registry = {};
  for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
    const symbol = snapshot?.appSymbol || snapshot?.symbol;
    if (!symbol) continue;
    registry[String(symbol).toUpperCase()] = {
      appSymbol: String(symbol).toUpperCase(),
      companyId: snapshot.companyId || null,
      companyName: snapshot.companyName || null,
      price: positive(snapshot.currentPrice),
      previousClose: positive(snapshot.previousClose),
      currency: snapshot.currency || null,
      quoteAt: snapshot.quoteAt || null,
      checkedAt: snapshot.generatedAt || null,
      source: snapshot.source || null,
      sourceUrl: snapshot.sourceUrl || null,
      sourceQuality: snapshot.sourceQuality || null,
      quoteContract: snapshot.quoteContract || null,
    };
  }
  return registry;
}
