import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { fetchSecRecentFilings } from './adapters/sec-submissions.js';
import { fetchSecCompanyFacts } from './adapters/sec-companyfacts.js';
import { fetchFinnhubQuote } from './adapters/finnhub-quote.js';
import { fetchFinnhubCandlesForSymbol, fetchFinnhubCompanyCandles } from './adapters/finnhub-candles.js';
import { fetchAllwynRegulatoryAnnouncements } from './adapters/allwyn-regulatory.js';
import { fetchTrustedNewsEvidence } from './adapters/trusted-news-rss.js';
import { hydrateEvidenceDocument } from './document-hydrator.js';
import { extractDocumentObservations } from './document-observations.js';
import { extractPdfText } from './pdf-extractor.js';
import { calculateMarketMetrics } from './market-metrics.js';
import { assessFundamentalRisk } from './fundamental-risk.js';
import { assessIndependentEvidence } from './cross-check.js';
import { linkEvidenceClaims, selectLeadClaim } from './claim-linker.js';
import { evaluateSignalReadiness } from './signal-readiness.js';
import { synthesizeEvidenceOnlyResearch } from './evidence-synthesis.js';
import { buildResearchDossier } from './research-dossier.js';
import { buildOpportunitiesFeed } from './opportunities-feed.js';
import { candidateFromEvidence } from './event-classifier.js';
import { rankSignalCandidate } from './rank-signal.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_UNIVERSE_PATH = path.resolve(MODULE_DIR, '../config/universe.seed.json');
const POSITION_COMPANY_IDS = new Set(['company:allwyn-ag', 'company:virgin-galactic-holdings']);

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
  if (company.cik) {
    return fetchSecRecentFilings(company, {
      fetchImpl: options.fetchImpl,
      userAgent: options.secUserAgent,
      retrievedAt: options.now,
      limit: options.limit,
    });
  }

  if (company.companyId === 'company:allwyn-ag') {
    return fetchAllwynRegulatoryAnnouncements(company, {
      fetchImpl: options.fetchImpl,
      retrievedAt: options.now,
      limit: options.limit,
    });
  }

  return {
    records: [],
    diagnostics: [{ code: 'NO_OFFICIAL_SOURCE_ADAPTER', companyId: company.companyId }],
  };
}

async function collectCompanyFundamentals(company, options) {
  if (company.cik) {
    return fetchSecCompanyFacts(company, {
      fetchImpl: options.fetchImpl,
      userAgent: options.secUserAgent,
      generatedAt: options.now,
    });
  }
  return {
    snapshot: null,
    diagnostics: [{ code: 'FUNDAMENTALS_ADAPTER_PENDING', companyId: company.companyId }],
  };
}

async function collectCompanyMarketSnapshot(company, options) {
  if (company.country === 'US') {
    return fetchFinnhubQuote(company, {
      fetchImpl: options.fetchImpl,
      token: options.finnhubToken,
      generatedAt: options.now,
    });
  }
  return {
    snapshot: null,
    diagnostics: [{ code: 'MARKET_DATA_ADAPTER_PENDING', companyId: company.companyId }],
  };
}

async function collectCompanyHistoricalMetrics(company, options) {
  if (company.country !== 'US') {
    return {
      series: null,
      metrics: null,
      diagnostics: [{ code: 'HISTORICAL_MARKET_DATA_ADAPTER_PENDING', companyId: company.companyId }],
    };
  }

  const companyResult = await fetchFinnhubCompanyCandles(company, {
    fetchImpl: options.fetchImpl,
    token: options.finnhubToken,
    generatedAt: options.now,
    lookbackDays: options.lookbackDays,
  });
  const diagnostics = [...(companyResult.diagnostics || [])];
  if (!companyResult.series?.usable) {
    return { series: companyResult.series || null, metrics: null, diagnostics };
  }

  let benchmarkSeries = options.benchmarkCache.get('SPY') || null;
  if (!benchmarkSeries) {
    const benchmarkResult = await fetchFinnhubCandlesForSymbol('SPY', {
      fetchImpl: options.fetchImpl,
      token: options.finnhubToken,
      generatedAt: options.now,
      lookbackDays: options.lookbackDays,
      currency: 'USD',
    });
    diagnostics.push(...(benchmarkResult.diagnostics || []).map((item) => ({ ...item, benchmark: true })));
    benchmarkSeries = benchmarkResult.series || null;
    if (benchmarkSeries) options.benchmarkCache.set('SPY', benchmarkSeries);
  }

  const metrics = calculateMarketMetrics(companyResult.series, benchmarkSeries, {
    companyId: company.companyId,
    symbol: company.primaryListing?.symbol,
    benchmarkSymbol: 'SPY',
    currency: company.currency || company.listings?.[0]?.currency || null,
    generatedAt: options.now,
  });
  return { series: companyResult.series, metrics, diagnostics };
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

    try {
      const fundamentalResult = await collectCompanyFundamentals(company, {
        fetchImpl,
        secUserAgent,
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
        now,
        lookbackDays: options.lookbackDays,
        benchmarkCache,
      });
      marketMetrics = historyResult.metrics || null;
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
          currency: company.currency || company.listings?.[0]?.currency || 'USD',
        },
      );
      fundamentalRiskAssessments.push(fundamentalRisk);
    }

    try {
      const result = await collectCompanyEvidence(company, {
        fetchImpl,
        secUserAgent,
        now,
        limit: Number(options.limit || 20),
      });
      diagnostics.push(...(result.diagnostics || []));

      const officialRecords = [];
      const records = result.records || [];
      for (let index = 0; index < records.length; index += 1) {
        let record = records[index];
        if (index < documentLimit) {
          const analysed = await analyseEvidenceDocument(record, company, {
            fetchImpl,
            secUserAgent,
            documentUserAgent: options.documentUserAgent || 'Investor-Control-Market-Intelligence/0.5',
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

      let independentRecords = [];
      if (options.collectTrustedNews !== false) {
        try {
          const newsResult = await fetchTrustedNewsEvidence(company, {
            fetchImpl,
            retrievedAt: now,
            limit: Number(options.newsLimit || 12),
            userAgent: options.newsUserAgent || 'Investor-Control-Market-Intelligence/0.5',
          });
          independentRecords = newsResult.records || [];
          diagnostics.push(...(newsResult.diagnostics || []).map((item) => ({ ...item, companyId: item.companyId || company.companyId })));
          evidence.push(...independentRecords);
        } catch (error) {
          diagnostics.push({
            code: 'TRUSTED_NEWS_ADAPTER_FAILED',
            companyId: company.companyId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const companyRecords = [...officialRecords, ...independentRecords];
      const companyClaims = linkEvidenceClaims(companyRecords, { now });
      claimClusters.push(...companyClaims);
      const leadClaim = selectLeadClaim(companyClaims);
      const leadRecords = recordsForClaim(companyRecords, leadClaim);
      const crossCheck = assessIndependentEvidence(leadRecords, now);
      const synthesis = synthesizeEvidenceOnlyResearch({
        company,
        evidence: leadRecords,
        fundamentals: fundamentalSnapshot,
        historicalMarketMetrics: marketMetrics,
        fundamentalRisk,
        generatedAt: now,
      });

      const dossier = buildResearchDossier({
        company,
        generatedAt: now,
        category: synthesis.category,
        proposedAction: synthesis.proposedAction,
        timeHorizon: synthesis.timeHorizon,
        evidence: leadRecords,
        leadClaim,
        requireCanonicalClaim: true,
        fundamentals: fundamentalSnapshot,
        marketSnapshot,
        historicalMarketMetrics: marketMetrics,
        fundamentalRisk,
        crossCheck,
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
          hasPosition: POSITION_COMPANY_IDS.has(company.companyId),
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
    version: 4,
    generatedAt: now,
    universe: universe.map((company) => ({
      companyId: company.companyId,
      legalName: company.legalName,
      primaryListing: company.primaryListing,
    })),
    evidenceCount: evidence.length,
    independentDiscoveryCount: evidence.filter((record) => record.sourceType === 'FINANCIAL_NEWS').length,
    documentReviewedCount: evidence.filter((record) => record.document?.reviewed === true).length,
    documentPendingCount: evidence.filter((record) => record.document?.reviewed !== true).length,
    pdfReviewedCount: evidence.filter((record) => record.document?.status === 'REVIEWED_PDF').length,
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
