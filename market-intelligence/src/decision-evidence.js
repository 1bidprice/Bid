import { contentHash } from './content-hash.js';

export const DECISION_EVIDENCE_VERSION = '2026-08-08.1';

function host(url) {
  try { return new URL(String(url || '')).hostname.toLowerCase(); } catch { return null; }
}

function officialFundamentalSource(snapshot) {
  const sourceUrl = snapshot?.sourceUrl || snapshot?.sourceDocument?.detailUrl || snapshot?.sourceDocument?.indexUrl || null;
  const sourceHost = host(sourceUrl);
  const official = sourceHost === 'data.sec.gov'
    || sourceHost === 'www.sec.gov'
    || sourceHost === 'sec.gov'
    || sourceHost === 'athens.euronext.com';
  return { sourceUrl, sourceHost, official };
}

function marketSource(snapshot, metrics) {
  const contract = snapshot?.quoteContract || null;
  const role = contract?.sourceRole || snapshot?.sourceRole || null;
  const approvedRole = ['PRIMARY_EXCHANGE', 'LICENSED_MARKET_DATA', 'SECONDARY_MARKET_DATA'].includes(role);
  const analysisReady = contract
    ? contract.analysisReferenceEligible === true || contract.valuationEligible === true
    : snapshot?.usable === true && snapshot?.sourceVerified !== false;
  const historyReady = metrics?.readiness?.marketMetricsReady === true;
  return { role, approvedRole, analysisReady, historyReady };
}

function evidenceId(prefix, payload) {
  return `evidence:${prefix}:${contentHash(payload).slice(0, 24)}`;
}

export function buildStructuredDecisionEvidence(input = {}) {
  const company = input.company || {};
  const generatedAt = new Date(input.generatedAt || Date.now()).toISOString();
  const records = [];
  const diagnostics = [];
  const fundamentals = input.fundamentals || null;
  const marketSnapshot = input.marketSnapshot || null;
  const marketMetrics = input.marketMetrics || null;

  if (fundamentals?.metricsReady === true) {
    const source = officialFundamentalSource(fundamentals);
    if (source.official && source.sourceUrl) {
      const payload = {
        companyId: company.companyId,
        sourceUrl: source.sourceUrl,
        generatedAt: fundamentals.generatedAt || generatedAt,
        model: fundamentals?.model?.type || null,
        coverage: fundamentals?.coverage || null,
        reporting: fundamentals?.reporting || null,
      };
      records.push({
        id: evidenceId('verified-fundamentals', payload),
        sourceType: 'STRUCTURED_FUNDAMENTALS',
        sourceName: source.sourceHost?.includes('sec.gov') ? 'SEC structured financial data' : 'Euronext Athens reviewed financial data',
        sourceUrl: source.sourceUrl,
        sourceDocumentId: fundamentals?.sourceDocument?.title || null,
        publishedAt: fundamentals?.sourceDocument?.modifiedAt || fundamentals?.generatedAt || generatedAt,
        retrievedAt: generatedAt,
        eventAt: null,
        title: `Verified structured fundamentals — ${company.displayName || company.legalName || company.companyId || 'instrument'}`,
        rawText: null,
        contentHash: contentHash(payload),
        language: 'en',
        companyIds: [company.companyId],
        claimType: 'FACT',
        reliabilityTier: 1,
        isPrimarySource: true,
        independenceGroup: `structured-fundamentals:${source.sourceHost}`,
        supportsClaimIds: [],
        contradictsClaimIds: [],
        expiresAt: null,
        notes: 'Machine-normalized financial facts accepted only after the fundamental model and source-integrity gates passed.',
        document: {
          reviewed: true,
          status: 'VERIFIED_STRUCTURED_DATA',
          contentType: 'application/json',
          sourceRole: 'PRIMARY_REGULATORY_OR_EXCHANGE_FINANCIAL_DATA',
        },
        decisionEvidenceRole: 'FUNDAMENTAL_BASELINE',
        eventClaimEligible: false,
      });
    } else {
      diagnostics.push({ code: 'DECISION_FUNDAMENTAL_SOURCE_NOT_OFFICIAL', companyId: company.companyId, sourceUrl: source.sourceUrl });
    }
  }

  const market = marketSource(marketSnapshot, marketMetrics);
  if (market.historyReady && market.approvedRole) {
    const sourceUrl = marketSnapshot?.sourceUrl || marketMetrics?.sourceUrl || null;
    const payload = {
      companyId: company.companyId,
      sourceRole: market.role,
      sourceUrl,
      latestTimestamp: marketMetrics?.latestTimestamp || null,
      observationCount: marketMetrics?.observationCount || null,
      readiness: marketMetrics?.readiness || null,
    };
    records.push({
      id: evidenceId('verified-market', payload),
      sourceType: 'VERIFIED_MARKET_DATA',
      sourceName: marketSnapshot?.source || 'Verified market data',
      sourceUrl,
      sourceDocumentId: null,
      publishedAt: marketSnapshot?.quoteAt || generatedAt,
      retrievedAt: generatedAt,
      eventAt: null,
      title: `Verified market state — ${company.displayName || company.legalName || company.companyId || 'instrument'}`,
      rawText: null,
      contentHash: contentHash(payload),
      language: 'en',
      companyIds: [company.companyId],
      claimType: 'FACT',
      reliabilityTier: market.role === 'PRIMARY_EXCHANGE' || market.role === 'LICENSED_MARKET_DATA' ? 1 : 2,
      isPrimarySource: false,
      independenceGroup: `market-data:${market.role || 'approved'}`,
      supportsClaimIds: [],
      contradictsClaimIds: [],
      expiresAt: new Date(new Date(generatedAt).getTime() + 120 * 3_600_000).toISOString(),
      notes: 'Independent market dimension; valid for decision corroboration only and never used to corroborate a corporate event claim.',
      document: {
        reviewed: true,
        status: 'VERIFIED_STRUCTURED_DATA',
        contentType: 'application/json',
        sourceRole: market.role,
      },
      decisionEvidenceRole: 'MARKET_BASELINE',
      eventClaimEligible: false,
    });
  }

  return {
    format: 'investor-control-structured-decision-evidence',
    version: 1,
    policyVersion: DECISION_EVIDENCE_VERSION,
    companyId: company.companyId || null,
    generatedAt,
    records,
    diagnostics,
    invariant: 'STRUCTURED_DATA_MAY_CORROBORATE_DECISION_BASIS_NOT_EVENT_CLAIMS',
  };
}
