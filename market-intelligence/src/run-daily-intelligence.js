import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { fetchSecRecentFilings } from './adapters/sec-submissions.js';
import { fetchAllwynRegulatoryAnnouncements } from './adapters/allwyn-regulatory.js';
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
  if (!candidate.requiresDeepReview) return ranked;
  return {
    ...ranked,
    status: 'DRAFT',
    suggestedAction: 'WATCH',
    reasons: [...new Set([...(ranked.reasons || []), 'DOCUMENT_REVIEW_REQUIRED'])],
  };
}

function toSignalOutput(company, evidence, candidate, ranked) {
  const guarded = guardedSignal(candidate, ranked);
  return {
    signalId: `signal:${company.companyId}:${evidence.contentHash.slice(0, 16)}`,
    companyId: company.companyId,
    companyName: company.displayName || company.legalName,
    listing: company.primaryListing,
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

export async function runDailyIntelligence(options = {}) {
  const now = new Date(options.now || Date.now()).toISOString();
  const universe = options.universe || await loadUniverse(options.universePath);
  const diagnostics = [];
  const evidence = [];
  const signals = [];

  for (const company of universe) {
    try {
      const result = await collectCompanyEvidence(company, {
        fetchImpl: options.fetchImpl || globalThis.fetch,
        secUserAgent: options.secUserAgent || process.env.SEC_USER_AGENT || '',
        now,
        limit: Number(options.limit || 20),
      });
      diagnostics.push(...(result.diagnostics || []));

      for (const record of result.records || []) {
        evidence.push(record);
        const candidate = candidateFromEvidence(record, {
          hasPosition: ['company:allwyn-ag', 'company:virgin-galactic-holdings'].includes(company.companyId),
          personalisationScore: 80,
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
    version: 1,
    generatedAt: now,
    universe: universe.map((company) => ({
      companyId: company.companyId,
      legalName: company.legalName,
      primaryListing: company.primaryListing,
    })),
    evidenceCount: evidence.length,
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
