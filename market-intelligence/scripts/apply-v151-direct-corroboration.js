import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filePath = path.join(root, 'src/run-daily-intelligence.js');
let source = fs.readFileSync(filePath, 'utf8');

function replaceRequired(from, to, label) {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`v1.5.1 direct corroboration patch failed: missing ${label}`);
  source = source.replace(from, to);
}

function replaceRegexRequired(regex, replacement, marker, label) {
  if (source.includes(marker)) return;
  let matched = false;
  source = source.replace(regex, () => {
    matched = true;
    return replacement;
  });
  if (!matched) throw new Error(`v1.5.1 direct corroboration patch failed: missing ${label}`);
}

replaceRequired(
  "import { fetchTrustedNewsEvidence } from './adapters/trusted-news-rss.js';",
  "import { fetchTrustedNewsEvidence } from './adapters/trusted-news-rss.js';\nimport { fetchFinnhubIndependentNews } from './adapters/finnhub-independent-news.js';",
  'Finnhub direct-news import',
);

const replacement = `      let independentRecords = [];
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

      const companyRecords =`;

replaceRegexRequired(
  /      let independentRecords = \[\];[\s\S]*?\n      const companyRecords =/,
  replacement,
  'FINNHUB_DIRECT_NEWS_ADAPTER_FAILED',
  'independent evidence collection block',
);

fs.writeFileSync(filePath, source);
const verified = fs.readFileSync(filePath, 'utf8');
for (const invariant of [
  'fetchFinnhubIndependentNews',
  'FINNHUB_DIRECT_NEWS_ADAPTER_FAILED',
  'recommendationGradeCount',
  'collectAggregatorFallback',
]) {
  if (!verified.includes(invariant)) throw new Error(`v1.5.1 verification failed: missing ${invariant}`);
}
console.log('Investor Control v1.5.1 direct publisher corroboration discovery applied.');
