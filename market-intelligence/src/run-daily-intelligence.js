import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { fetchSecRecentFilings } from './adapters/sec-submissions.js';
import { fetchAllwynRegulatoryAnnouncements } from './adapters/allwyn-regulatory.js';
import { hydrateEvidenceDocument } from './document-hydrator.js';
import { extractDocumentObservations } from './document-observations.js';
import { candidateFromEvidence } from './event-classifier.js';
import { rankSignalCandidate } from './rank-signal.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_UNIVERSE_PATH = path.resolve(MODULE_DIR, '../config/universe.seed.json');

async function loadUniverse(universePath = DEFAULT_UNIVERSE_PATH) {
  const raw = await readFile(universePath, 'utf8');
  const universe = JSON.parse(raw);
  if (!Array.isArray(universe)) throw new Error('Universe seed must be an array');
  return universe.filter((company) => company?.active === true);
}

function guardedSignal(candidate, ranked) {
  if (candidate.requiresDeepReview) {
    return {
      ...ranked,
      status: 'DRAFT',
      suggestedAction: 'WATCH',
      reasons: [...new Set([...(ranked.reasons || []), 'DOCUMENT_REVIEW_REQUIRED'])],
    };
  }
  if (!candidate.metricsReady) {
    return {
      ...ranked,
      status: 'DRAFT',
      suggestedAction: 'WATCH',
      reasons: [...new Set([...(ranked.reasons || []), 'FUNDAMENTAL_AND_MARKET_METRICS_REQUIRED'])],
    };
  }
  return ranked;
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

function toSignalOutput(company, evidence, candidate, ranked) {
  const guarded = guardedSignal(candidate, ranked);
  const analysisStage = candidate.requiresDeepReview
    ? 'INDEX_DISCOVERY'
    : candidate.metricsReady
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

async function analyseEvidenceDocument(record, company, options) {
  const hydrated = await hydrateEvidenceDocument(record, {
    fetchImpl: options.fetchImpl,
    retrievedAt: options.now,
    userAgent: company.cik
      ? options.secUserAgent
      : options.documentUserAgent,
    maxBytes: options.maxDocumentBytes,
    minReviewedText: options.minReviewedText,
  });
  const enriched = {
    ...hydrated.record,
    observations: extractDocumentObservations(hydrated.record),
  };
  return { record: enriched, diagnostics: hydrated.diagnostics || [] };
}

export async function runDailyIntelligence(options = {}) {
  const now = new Date(options.now || Date.now()).toISOString();
  const universe = options.universe || await loadUniverse(options.universePath);
  const diagnostics = [];
  const evidence = [];
  const signals = [];
  const documentLimit = Math.max(0, Number(options.documentLimit ?? 5));

  for (const company of universe) {
    try {
      const result = await collectCompanyEvidence(company, {
        fetchImpl: options.fetchImpl || globalThis.fetch,
        secUserAgent: options.secUserAgent || process.env.SEC_USER_AGENT || '',
        now,
        limit: Number(options.limit || 20),
      });
      diagnostics.push(...(result.diagnostics || []));

      const records = result.records || [];
      for (let index = 0; index < records.length; index += 1) {
        let record = records[index];
        if (index < documentLimit) {
          const analysed = await analyseEvidenceDocument(record, company, {
            fetchImpl: options.fetchImpl || globalThis.fetch,
            secUserAgent: options.secUserAgent || process.env.SEC_USER_AGENT || '',
            documentUserAgent: options.documentUserAgent || 'Investor-Control-Market-Intelligence/0.2',
            now,
            maxDocumentBytes: options.maxDocumentBytes,
            minReviewedText: options.minReviewedText,
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

        evidence.push(record);
        const candidate = candidateFromEvidence(record, {
          hasPosition: ['company:allwyn-ag', 'company:virgin-galactic-holdings'].includes(company.companyId),
          personalisationScore: 80,
          metricsReady: false,
        });
        const ranked = rankSignalCandidate(candidate, now);
        signals.push(toSignalOutput(company, record, candidate, ranked));
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

  return {
    format: 'investor-control-daily-intelligence',
    version: 2,
    generatedAt: now,
    universe: universe.map((company) => ({
      companyId: company.companyId,
      legalName: company.legalName,
      primaryListing: company.primaryListing,
    })),
    evidenceCount: evidence.length,
    documentReviewedCount: evidence.filter((record) => record.document?.reviewed === true).length,
    documentPendingCount: evidence.filter((record) => record.document?.reviewed !== true).length,
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
  console.log(`Reviewed ${report.documentReviewedCount} official source documents`);
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
