import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { fetchSecRecentFilings } from './adapters/sec-submissions.js';
import { fetchSecCompanyFacts } from './adapters/sec-companyfacts.js';
import { fetchEuronextAthensFundamentals } from './adapters/euronext-athens-fundamentals.js';
import { fetchProfessionalMarketSnapshot, fetchProfessionalHistoricalMetrics } from './professional-market-data.js';
import { fetchEuronextAthensAnnouncements } from './adapters/euronext-athens-announcements.js';
import { fetchTrustedNewsEvidence } from './adapters/trusted-news-rss.js';
import { fetchFinnhubIndependentNews } from './adapters/finnhub-independent-news.js';
import { hydrateEvidenceDocument } from './document-hydrator.js';
import { extractDocumentObservations } from './document-observations.js';
import { extractPdfText } from './pdf-extractor.js';
import { calculateMarketMetrics } from './market-metrics.js';
import { assessFundamentalRisk } from './fundamental-risk.js';
import { extractSecBankRegulatoryCapitalFromEvidence } from './sec-bank-regulatory-capital.js';
import { applyReviewedRegulatoryCapitalToBankPassport } from './sec-bank-passport.js';
import { assessIndependentEvidence } from './cross-check.js';
import { linkEvidenceClaims, selectLeadClaim } from './claim-linker.js';
import { evaluateSignalReadiness } from './signal-readiness.js';
import { synthesizeEvidenceOnlyResearch } from './evidence-synthesis.js';
import { buildResearchDossier } from './research-dossier.js';
import { buildOpportunitiesFeed } from './opportunities-feed.js';
import { candidateFromEvidence } from './event-classifier.js';
import { rankSignalCandidate } from './rank-signal.js';
import { buildInstrumentProfile } from './instrument-profile.js';
import { buildInstrumentRoute } from './instrument-router.js';
import { collectInstrumentCapabilities } from './instrument-capability-collector.js';
import { evaluateInstrumentCapabilities } from './instrument-capability-evaluator.js';
import { buildStructuredDecisionEvidence } from './decision-evidence.js';
import { assessDecisionCorroboration } from './decision-corroboration.js';
import { synthesizeFundamentalBaseline } from './fundamental-baseline-synthesis.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_UNIVERSE_PATH = path.resolve(MODULE_DIR, '../config/universe.seed.json');

async function loadUniverse(universePath = DEFAULT_UNIVERSE_PATH) {
  const raw = await readFile(universePath, 'utf8');
  const universe = JSON.parse(raw);
  if (!Array.isArray(universe)) throw new Error('Universe seed must be an array');
  return universe.filter((company) => company?.active === true);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function guardedSignal(ranked, readiness) {
  if (readiness.publishable) return ranked;
  return {
    ...ranked,
    status: 'DRAFT',
    suggestedAction: 'WATCH',
    reasons: unique([...(ranked.reasons || []), ...(readiness.blockers || [])]),
  };
}

function compactObservationSummary(observations) {
  if (!observations) return null;
  return {
    extractionVersion: observations.extractionVersion,
    documentReviewed: observations.documentReviewed,
    textLength: observations.textLength,
    currencyAmountCount: observations.currencyAmounts.length,
    percentageCount: observations.percentages.length,
    shareCountCount: observations.shareCounts.length,
    dateCount: observations.dates.length,
    sections: observations.sections,
    currencyAmounts: observations.currencyAmounts.slice(0, 8),
    percentages: observations.percentages.slice(0, 8),
    shareCounts: observations.shareCounts.slice(0, 8),
  };
}

function compactFundamentalSummary(snapshot) {
  if (!snapshot) return null;
  return {
    format: snapshot.format,
    version: snapshot.version,
    generatedAt: snapshot.generatedAt,
    sourceUrl: snapshot.sourceUrl,
    coverage: snapshot.coverage,
    metricsReady: snapshot.metricsReady,
    metrics: snapshot.metrics,
    latest: {
      revenue: snapshot.annual?.revenue?.[0] || null,
      netIncome: snapshot.annual?.netIncome?.[0] || null,
      operatingCashFlow: snapshot.annual?.operatingCashFlow?.[0] || null,
      dilutedShares: snapshot.annual?.dilutedShares?.[0] || null,
      cash: snapshot.instant?.cash || null,
      assets: snapshot.instant?.assets || null,
      liabilities: snapshot.instant?.liabilities || null,
      equity: snapshot.instant?.equity || null,
    },
  };
}

function compactMarketSummary(snapshot) {
  if (!snapshot) return null;
  return {
    format: snapshot.format,
    version: snapshot.version,
    generatedAt: snapshot.generatedAt,
    source: snapshot.source,
    sourceUrl: snapshot.sourceUrl,
    symbol: snapshot.symbol,
    currency: snapshot.currency,
    quoteAt: snapshot.quoteAt,
    ageHours: snapshot.ageHours,
    stale: snapshot.stale,
    usable: snapshot.usable,
    currentPrice: snapshot.currentPrice,
    previousClose: snapshot.previousClose,
    open: snapshot.open,
    high: snapshot.high,
    low: snapshot.low,
    dailyChange: snapshot.dailyChange,
    dailyChangePct: snapshot.dailyChangePct,
    sourceQuality: snapshot.sourceQuality || null,
    quoteTimestampVerified: snapshot.quoteTimestampVerified !== false,
    timestampMeaning: snapshot.timestampMeaning || null,
  };
}

function compactHistoricalMetrics(metrics) {
  if (!metrics) return null;
  return {
    format: metrics.format,
    version: metrics.version,
    generatedAt: metrics.generatedAt,
    symbol: metrics.symbol,
    benchmarkSymbol: metrics.benchmarkSymbol,
    currency: metrics.currency,
    observationCount: metrics.observationCount,
    latestTimestamp: metrics.latestTimestamp,
    latestClose: metrics.latestClose,
    returnsPct: metrics.returnsPct,
    trend: metrics.trend,
    risk: metrics.risk,
    liquidity: metrics.liquidity,
    relativeStrength: metrics.relativeStrength,
    dataQuality: metrics.dataQuality || null,
    readiness: metrics.readiness,
  };
}

function toSignalOutput(
  company,
  evidence,
  candidate,
  ranked,
  fundamentalSnapshot,
  marketSnapshot,
  marketMetrics,
  claim,
  crossCheck,
  readiness,
) {
  const guarded = guardedSignal(ranked, readiness);
  const analysisStage = !readiness.checks.documentReviewed
    ? 'INDEX_DISCOVERY'
    : readiness.checks.fundamentalsReady && readiness.checks.marketMetricsReady
      ? 'METRICS_CONFIRMED'
      : 'DOCUMENT_REVIEWED';

  return {
    signalId: `signal:${company.companyId}:${evidence.contentHash.slice(0, 16)}`,
    companyId: company.companyId,
    companyName: company.displayName || company.legalName,
    listing: company.primaryListing,
    analysisStage,
    eventType: candidate.eventType,
    category: guarded.category,
    suggestedAction: guarded.suggestedAction,
    status: guarded.status,
    rankingScore: guarded.rankingScore,
    confidenceScore: guarded.confidenceScore,
    dataQualityScore: guarded.dataQualityScore,
    rationale: candidate.rationale,
    reasons: guarded.reasons,
    publishedAt: evidence.publishedAt,
    document: evidence.document || null,
    observations: compactObservationSummary(evidence.observations),
    fundamentals: compactFundamentalSummary(fundamentalSnapshot),
    market: compactMarketSummary(marketSnapshot),
    historicalMarketMetrics: compactHistoricalMetrics(marketMetrics),
    claim: claim || null,
    crossCheck,
    readiness,
    source: {
      evidenceId: evidence.id,
      sourceName: evidence.sourceName,
      sourceType: evidence.sourceType,
      sourceUrl: evidence.sourceUrl,
      title: evidence.title,
    },
  };
}

async function collectCompanyEvidence(company, options) {
  const profile = options.instrumentProfile || buildInstrumentProfile(company);
  const route = options.instrumentRoute || buildInstrumentRoute(company, { profile });
  const adapter = route.routes?.officialEvidence?.adapter || null;

  if (adapter === 'SEC_SUBMISSIONS') {
    return fetchSecRecentFilings(company, {
      fetchImpl: options.fetchImpl,
      userAgent: options.secUserAgent,
      retrievedAt: options.now,
      limit: options.limit,
    });
  }

  if (adapter === 'EURONEXT_ATHENS_ANNOUNCEMENTS') {
    const issuerId = String(company?.issuerId || profile?.identifiers?.issuerId || '').trim();
    const announcementsUrl = company?.marketData?.euronextIssuerAnnouncementsUrl
      || (issuerId ? `https://athens.euronext.com/en/market-data/issuers/${encodeURIComponent(issuerId)}/announcements` : null);
    if (!announcementsUrl) {
      return { records: [], diagnostics: [{ code: 'INSTRUMENT_OFFICIAL_EVIDENCE_IDENTITY_INCOMPLETE', companyId: company.companyId, assetClass: profile.assetClass }] };
    }
    return fetchEuronextAthensAnnouncements({
      ...company,
      marketData: { ...(company.marketData || {}), euronextIssuerAnnouncementsUrl: announcementsUrl },
    }, {
      fetchImpl: options.fetchImpl,
      retrievedAt: options.now,
      limit: options.limit,
      userAgent: options.documentUserAgent,
    });
  }

  return {
    records: [],
    diagnostics: [{
      code: 'INSTRUMENT_OFFICIAL_EVIDENCE_ADAPTER_UNAVAILABLE',
      companyId: company.companyId,
      assetClass: profile.assetClass,
      analysisModel: profile.analysisModel,
      requiredCapabilities: profile.requiredCapabilities,
    }],
  };
}

async function collectCompanyFundamentals(company, options) {
  const profile = options.instrumentProfile || buildInstrumentProfile(company);
  const route = options.instrumentRoute || buildInstrumentRoute(company, { profile });
  const adapter = route.routes?.fundamentals?.adapter || null;

  if (adapter === 'SEC_COMPANY_FACTS') {
    return fetchSecCompanyFacts(company, {
      fetchImpl: options.fetchImpl,
      userAgent: options.secUserAgent,
      generatedAt: options.now,
    });
  }
  if (adapter === 'EURONEXT_ATHENS_FINANCIALS') {
    return fetchEuronextAthensFundamentals(company, {
      fetchImpl: options.fetchImpl,
      generatedAt: options.now,
      userAgent: options.documentUserAgent || 'Investor-Control-Market-Intelligence/1.0',
      pdfExtractor: options.pdfExtractor,
      maxBytes: options.maxDocumentBytes,
      minReviewedText: options.minReviewedText,
      timeoutMs: options.pdfTimeoutMs,
    });
  }
  return {
    snapshot: null,
    diagnostics: [{
      code: 'INSTRUMENT_ANALYTICS_PROVIDER_REQUIRED',
      companyId: company.companyId,
      assetClass: profile.assetClass,
      analysisModel: profile.analysisModel,
      requiredCapabilities: profile.requiredCapabilities,
    }],
  };
}

async function collectCompanyMarketSnapshot(company, options) {
  const profile = options.instrumentProfile || buildInstrumentProfile(company);
  const route = options.instrumentRoute || buildInstrumentRoute(company, { profile });
  if (!route.routes?.market?.adapter) {
    return { snapshot: null, diagnostics: [{ code: 'INSTRUMENT_MARKET_PROVIDER_REQUIRED', companyId: company.companyId, assetClass: profile.assetClass, analysisModel: profile.analysisModel }] };
  }
  return fetchProfessionalMarketSnapshot(company, {
    fetchImpl: options.fetchImpl,
    token: options.finnhubToken,
    generatedAt: options.now,
  });
}

async function collectCompanyHistoricalMetrics(company, options) {
  const profile = options.instrumentProfile || buildInstrumentProfile(company);
  const route = options.instrumentRoute || buildInstrumentRoute(company, { profile });
  if (!route.routes?.history?.adapter) {
    return { series: null, metrics: null, diagnostics: [{ code: 'INSTRUMENT_HISTORY_PROVIDER_REQUIRED', companyId: company.companyId, assetClass: profile.assetClass, analysisModel: profile.analysisModel }] };
  }
  return fetchProfessionalHistoricalMetrics(company, {
    fetchImpl: options.fetchImpl,
    token: options.finnhubToken,
    generatedAt: options.now,
    lookbackDays: options.lookbackDays,
    benchmarkCache: options.benchmarkCache,
    marketSnapshot: options.marketSnapshot,
    historyCrossCheckTolerancePct: options.historyCrossCheckTolerancePct,
  });
}

async function analyseEvidenceDocument(record, company, options) {
  const hydrated = await hydrateEvidenceDocument(record, {
    fetchImpl: options.fetchImpl,
    retrievedAt: options.now,
    userAgent: company.cik ? options.secUserAgent : options.documentUserAgent,
    maxBytes: options.maxDocumentBytes,
    minReviewedText: options.minReviewedText,
    pdfExtractor: options.pdfExtractor,
    pdfTimeoutMs: options.pdfTimeoutMs,
  });
  const enriched = {
    ...hydrated.record,
    observations: extractDocumentObservations(hydrated.record),
  };
  return { record: enriched, diagnostics: hydrated.diagnostics || [] };
}

function referencePriceForRisk(marketSnapshot, marketMetrics) {
  if (marketSnapshot?.usable && !marketSnapshot.stale && Number(marketSnapshot.currentPrice) > 0) {
    return Number(marketSnapshot.currentPrice);
  }
  if (Number(marketMetrics?.latestClose) > 0) return Number(marketMetrics.latestClose);
  return null;
}

function recordsForClaim(records, claim) {
  if (!claim?.evidenceIds?.length) return records;
  const ids = new Set(claim.evidenceIds);
  return records.filter((record) => ids.has(record.id));
}

function replaceFundamentalRiskAssessment(assessments, companyId, nextAssessment) {
  const index = assessments.findIndex((item) => item?.companyId === companyId);
  if (index >= 0) assessments[index] = nextAssessment;
  else assessments.push(nextAssessment);
}

export async function runDailyIntelligence(options = {}) {
  const now = new Date(options.now || Date.now()).toISOString();
  const universe = options.universe || await loadUniverse(options.universePath);
  const diagnostics = [];
  const evidence = [];
  const signals = [];
  const fundamentalSnapshots = [];
  const marketSnapshots = [];
  const historicalMarketMetrics = [];
  const fundamentalRiskAssessments = [];
  const claimClusters = [];
  const researchDossiers = [];
  const instrumentProfiles = [];
  const instrumentRoutes = [];
  const instrumentCapabilityPassports = [];
  const instrumentCapabilityEvaluations = [];
  const structuredDecisionEvidence = [];
  const decisionCorroborations = [];
  const classificationSnapshots = [...(options.classificationSnapshots || [])];
  const documentLimit = Math.max(0, Number(options.documentLimit ?? 5));
  const benchmarkCache = new Map();
  const pdfExtractor = options.pdfExtractor === undefined ? extractPdfText : options.pdfExtractor;

  for (const company of universe) {
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    const secUserAgent = options.secUserAgent || process.env.SEC_USER_AGENT || '';
    const finnhubToken = options.finnhubToken || process.env.FINNHUB_TOKEN || '';
    let fundamentalSnapshot = null;
    let marketSnapshot = null;
    let marketMetrics = null;
    let fundamentalRisk = null;
    let instrumentCapabilities = null;
    let instrumentCapabilityEvaluation = null;
    const instrumentProfile = buildInstrumentProfile(company);
    const instrumentRoute = buildInstrumentRoute(company, { profile: instrumentProfile });
    instrumentProfiles.push(instrumentProfile);
    instrumentRoutes.push(instrumentRoute);

    try {
      const fundamentalResult = await collectCompanyFundamentals(company, {
        fetchImpl,
        secUserAgent,
        instrumentProfile,
        instrumentRoute,
        documentUserAgent: options.documentUserAgent,
        pdfExtractor,
        maxDocumentBytes: options.maxDocumentBytes,
        minReviewedText: options.minReviewedText,
        pdfTimeoutMs: options.pdfTimeoutMs,
        now,
      });
      fundamentalSnapshot = fundamentalResult.snapshot || null;
      diagnostics.push(...(fundamentalResult.diagnostics || []));
      if (fundamentalSnapshot) fundamentalSnapshots.push(fundamentalSnapshot);
    } catch (error) {
      diagnostics.push({
        code: 'FUNDAMENTALS_ADAPTER_FAILED',
        companyId: company.companyId,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const marketResult = await collectCompanyMarketSnapshot(company, {
        fetchImpl,
        finnhubToken,
        instrumentProfile,
        instrumentRoute,
        now,
      });
      marketSnapshot = marketResult.snapshot || null;
      diagnostics.push(...(marketResult.diagnostics || []));
      if (marketSnapshot) marketSnapshots.push(marketSnapshot);
    } catch (error) {
      diagnostics.push({
        code: 'MARKET_DATA_ADAPTER_FAILED',
        companyId: company.companyId,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const historyResult = await collectCompanyHistoricalMetrics(company, {
        fetchImpl,
        finnhubToken,
        instrumentProfile,
        instrumentRoute,
        now,
        lookbackDays: options.lookbackDays,
        benchmarkCache,
        marketSnapshot,
        historyCrossCheckTolerancePct: options.historyCrossCheckTolerancePct,
      });
      marketMetrics = historyResult.metrics || null;
      if (historyResult.series?.usable && options.historicalSeriesCollector?.set) {
        options.historicalSeriesCollector.set(company.companyId, historyResult.series);
      }
      if (historyResult.benchmarkSeries?.usable && options.benchmarkSeriesCollector?.set) {
        options.benchmarkSeriesCollector.set(company.companyId, historyResult.benchmarkSeries);
      }
      diagnostics.push(...(historyResult.diagnostics || []));
      if (marketMetrics) historicalMarketMetrics.push(marketMetrics);
    } catch (error) {
      diagnostics.push({
        code: 'HISTORICAL_MARKET_DATA_FAILED',
        companyId: company.companyId,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    if (fundamentalSnapshot) {
      fundamentalRisk = assessFundamentalRisk(
        fundamentalSnapshot,
        referencePriceForRisk(marketSnapshot, marketMetrics),
        {
          generatedAt: now,
          companyId: company.companyId,
          currency: company.currency || company.primaryListing?.currency || company.listings?.[0]?.currency || fundamentalSnapshot?.reporting?.currency || 'USD',
        },
      );
      fundamentalRiskAssessments.push(fundamentalRisk);
    }

    try {
      instrumentCapabilities = await collectInstrumentCapabilities(company, instrumentProfile, {
        route: instrumentRoute,
        marketSnapshot,
        marketMetrics,
        providers: options.capabilityProviders || [],
        fetchImpl,
        now,
      });
      instrumentCapabilityPassports.push(instrumentCapabilities);
      diagnostics.push(...(instrumentCapabilities.diagnostics || []).map((item) => ({ ...item, companyId: item.companyId || company.companyId })));
      instrumentCapabilityEvaluation = evaluateInstrumentCapabilities(instrumentProfile, instrumentCapabilities);
      instrumentCapabilityEvaluations.push(instrumentCapabilityEvaluation);
    } catch (error) {
      diagnostics.push({
        code: 'INSTRUMENT_CAPABILITY_ENGINE_FAILED',
        companyId: company.companyId,
        assetClass: instrumentProfile.assetClass,
        analysisModel: instrumentProfile.analysisModel,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const result = await collectCompanyEvidence(company, {
        fetchImpl,
        secUserAgent,
        instrumentProfile,
        instrumentRoute,
        documentUserAgent: options.documentUserAgent,
        now,
        limit: Number(options.limit || 20),
      });
      diagnostics.push(...(result.diagnostics || []));
      if (result.classificationSnapshot) classificationSnapshots.push(result.classificationSnapshot);

      const officialRecords = [];
      const records = result.records || [];
      for (let index = 0; index < records.length; index += 1) {
        let record = records[index];
        if (index < documentLimit) {
          const analysed = await analyseEvidenceDocument(record, company, {
            fetchImpl,
            secUserAgent,
            documentUserAgent: options.documentUserAgent || 'Investor-Control-Market-Intelligence/1.0',
            now,
            maxDocumentBytes: options.maxDocumentBytes,
            minReviewedText: options.minReviewedText,
            pdfExtractor,
            pdfTimeoutMs: options.pdfTimeoutMs,
          });
          record = analysed.record;
          diagnostics.push(...analysed.diagnostics);
        } else {
          diagnostics.push({ code: 'DOCUMENT_REVIEW_DEFERRED_BY_LIMIT', evidenceId: record.id });
          record = {
            ...record,
            observations: extractDocumentObservations(record),
          };
        }
        officialRecords.push(record);
        evidence.push(record);
      }

      if (
        company.cik &&
        fundamentalSnapshot?.model?.type === 'FINANCIAL_INSTITUTION' &&
        fundamentalSnapshot?.specializedModels?.bank
      ) {
        const capitalResult = extractSecBankRegulatoryCapitalFromEvidence(officialRecords);
        diagnostics.push(...(capitalResult.diagnostics || []).map((item) => ({
          ...item,
          companyId: item.companyId || company.companyId,
        })));
        if (capitalResult.capital) {
          const bankPassport = applyReviewedRegulatoryCapitalToBankPassport(
            fundamentalSnapshot.specializedModels.bank,
            capitalResult.capital,
          );
          fundamentalSnapshot.specializedModels = {
            ...(fundamentalSnapshot.specializedModels || {}),
            bank: bankPassport,
          };
          fundamentalSnapshot.model = {
            ...(fundamentalSnapshot.model || {}),
            specializedModelImplemented: true,
            modelReady: bankPassport.modelReady,
            specializedModelStatus: bankPassport.status,
          };
          fundamentalSnapshot.quality = {
            ...(fundamentalSnapshot.quality || {}),
            specializedModelImplemented: true,
            bankPassportStatus: bankPassport.status,
            bankPassportBlockers: bankPassport.blockers,
            regulatoryCapitalEvidenceId: capitalResult.capital.evidenceId,
          };
          fundamentalSnapshot.metricsReady = bankPassport.decisionReady === true;

          fundamentalRisk = assessFundamentalRisk(
            fundamentalSnapshot,
            referencePriceForRisk(marketSnapshot, marketMetrics),
            {
              generatedAt: now,
              companyId: company.companyId,
              currency: company.currency || company.primaryListing?.currency || company.listings?.[0]?.currency || fundamentalSnapshot?.reporting?.currency || 'USD',
            },
          );
          replaceFundamentalRiskAssessment(fundamentalRiskAssessments, company.companyId, fundamentalRisk);
          diagnostics.push({
            code: 'SEC_BANK_REGULATORY_CAPITAL_VERIFIED',
            companyId: company.companyId,
            evidenceId: capitalResult.capital.evidenceId,
            accession: capitalResult.capital.accession,
            form: capitalResult.capital.form,
          });
        }
      }

      let independentRecords = [];
      if (options.collectTrustedNews !== false) {
        const mergeIndependent = (records = []) => {
          const byId = new Map(independentRecords.map((record) => [record.id, record]));
          for (const record of records) byId.set(record.id, record);
          independentRecords = [...byId.values()];
        };
        const recommendationGradeCount = () => independentRecords.filter((record) => record?.document?.reviewed === true && record?.claimType === 'FACT').length;

        if (finnhubToken) {
          try {
            const directNews = await fetchFinnhubIndependentNews(company, {
              fetchImpl,
              token: finnhubToken,
              retrievedAt: now,
              limit: Number(options.newsLimit || 12),
              reviewLimit: Number(options.newsReviewLimit || 4),
              userAgent: options.newsUserAgent || 'Investor-Control-Market-Intelligence/1.5',
            });
            mergeIndependent(directNews.records || []);
            diagnostics.push(...(directNews.diagnostics || []).map((item) => ({ ...item, companyId: item.companyId || company.companyId })));
          } catch (error) {
            diagnostics.push({
              code: 'FINNHUB_DIRECT_NEWS_ADAPTER_FAILED',
              companyId: company.companyId,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }

        // Aggregator RSS remains discovery fallback only. It is queried only
        // when the direct-URL route did not yield a reviewed publisher article.
        if (recommendationGradeCount() === 0 && options.collectAggregatorFallback !== false) {
          try {
            const newsResult = await fetchTrustedNewsEvidence(company, {
              fetchImpl,
              retrievedAt: now,
              limit: Number(options.newsLimit || 12),
              reviewLimit: Number(options.newsReviewLimit || 3),
              userAgent: options.newsUserAgent || 'Investor-Control-Market-Intelligence/1.5',
            });
            mergeIndependent(newsResult.records || []);
            diagnostics.push(...(newsResult.diagnostics || []).map((item) => ({ ...item, companyId: item.companyId || company.companyId })));
          } catch (error) {
            diagnostics.push({
              code: 'TRUSTED_NEWS_ADAPTER_FAILED',
              companyId: company.companyId,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
        evidence.push(...independentRecords);
      }

      const companyRecords = [...officialRecords, ...independentRecords];
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
      researchDossiers.push(dossier);

      for (const record of officialRecords) {
        const signalClaim = companyClaims.find((claim) => claim.evidenceIds.includes(record.id)) || leadClaim;
        const signalRecords = recordsForClaim(companyRecords, signalClaim);
        const signalCrossCheck = assessIndependentEvidence(signalRecords, now);
        const signalSynthesis = synthesizeEvidenceOnlyResearch({
          company,
          evidence: signalRecords,
          fundamentals: fundamentalSnapshot,
          historicalMarketMetrics: marketMetrics,
          fundamentalRisk,
          generatedAt: now,
        });
        const metricsReady =
          fundamentalSnapshot?.metricsReady === true &&
          marketMetrics?.readiness?.marketMetricsReady === true;
        const candidate = candidateFromEvidence(record, {
          hasPosition: options.positionCompanyIds instanceof Set ? options.positionCompanyIds.has(company.companyId) : company?.portfolioContext?.hasPosition === true,
          personalisationScore: 80,
          liquidityScore: marketMetrics?.liquidity?.score ?? 50,
          metricsReady,
        });
        const readiness = evaluateSignalReadiness({
          evidence: record,
          fundamentals: fundamentalSnapshot,
          marketMetrics,
          crossCheck: signalCrossCheck,
          thesis: signalSynthesis.thesis,
          invalidationCondition: signalSynthesis.invalidationCondition,
          risks: signalSynthesis.risks?.map((item) => item.text) || [],
        });
        const ranked = rankSignalCandidate(candidate, now);
        signals.push(toSignalOutput(
          company,
          record,
          candidate,
          ranked,
          fundamentalSnapshot,
          marketSnapshot,
          marketMetrics,
          signalClaim,
          signalCrossCheck,
          readiness,
        ));
      }
    } catch (error) {
      diagnostics.push({
        code: 'SOURCE_ADAPTER_FAILED',
        companyId: company.companyId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  signals.sort((a, b) => {
    if (b.rankingScore !== a.rankingScore) return b.rankingScore - a.rankingScore;
    return String(b.publishedAt).localeCompare(String(a.publishedAt));
  });

  const opportunitiesFeed = buildOpportunitiesFeed(researchDossiers, { generatedAt: now });

  return {
    format: 'investor-control-daily-intelligence',
    version: 5,
    generatedAt: now,
    universe: universe.map((company) => ({
      companyId: company.companyId,
      legalName: company.legalName,
      primaryListing: company.primaryListing,
    })),
    classificationSnapshotCount: classificationSnapshots.length,
    classificationSnapshots,
    evidenceCount: evidence.length,
    independentDiscoveryCount: evidence.filter((record) => record.sourceType === 'FINANCIAL_NEWS').length,
    documentReviewedCount: evidence.filter((record) => record.document?.reviewed === true).length,
    documentPendingCount: evidence.filter((record) => record.document?.reviewed !== true).length,
    pdfReviewedCount: evidence.filter((record) => record.document?.status === 'REVIEWED_PDF').length,
    instrumentProfileCount: instrumentProfiles.length,
    instrumentProfiles,
    instrumentRouteCount: instrumentRoutes.length,
    instrumentRoutes,
    instrumentCapabilityPassportCount: instrumentCapabilityPassports.length,
    instrumentCapabilityPassports,
    instrumentCapabilityEvaluationCount: instrumentCapabilityEvaluations.length,
    instrumentCapabilityEvaluations,
    structuredDecisionEvidenceCount: structuredDecisionEvidence.length,
    structuredDecisionEvidence,
    decisionCorroborationCount: decisionCorroborations.length,
    decisionCorroborations,
    fundamentalSnapshotCount: fundamentalSnapshots.length,
    fundamentalSnapshots,
    fundamentalRiskAssessmentCount: fundamentalRiskAssessments.length,
    fundamentalRiskAssessments,
    marketSnapshotCount: marketSnapshots.length,
    marketSnapshots,
    historicalMarketMetricsCount: historicalMarketMetrics.length,
    historicalMarketMetrics,
    claimClusterCount: claimClusters.length,
    claimClusters,
    researchDossierCount: researchDossiers.length,
    researchDossiers,
    opportunitiesFeed,
    signalCount: signals.length,
    diagnostics,
    signals,
  };
}

async function main() {
  const outputPath = path.resolve(process.cwd(), process.argv[2] || 'out/daily-intelligence.json');
  const report = await runDailyIntelligence();
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${report.signalCount} signal candidates to ${outputPath}`);
  console.log(`Reviewed ${report.documentReviewedCount} official source documents (${report.pdfReviewedCount} PDFs)`);
  console.log(`Collected ${report.independentDiscoveryCount} trusted-publisher discovery records`);
  console.log(`Linked ${report.claimClusterCount} canonical claim clusters`);
  console.log(`Built ${report.fundamentalSnapshotCount} deterministic fundamental snapshots`);
  console.log(`Built ${report.marketSnapshotCount} guarded market snapshots`);
  console.log(`Built ${report.historicalMarketMetricsCount} historical market metric sets`);
  console.log(`Built ${report.researchDossierCount} guarded research dossiers`);
  if (report.diagnostics.length) {
    console.warn(`Diagnostics: ${JSON.stringify(report.diagnostics)}`);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
