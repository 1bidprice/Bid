import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adapterPath = path.join(root, 'src/adapters/euronext-athens-discovery.js');
let source = fs.readFileSync(adapterPath, 'utf8');

function replaceRequired(from, to, label) {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`v1.2.3 Athens pagination patch failed: missing ${label}`);
  source = source.replace(from, to);
}

replaceRequired(
  "export const ATHENS_DISCOVERY_VERSION = '2026-08-05.1';",
  "export const ATHENS_DISCOVERY_VERSION = '2026-08-05.2';",
  'Athens discovery policy version',
);

const paginationHelpers = `function tradingDirectoryLastPage(html) {
  const pages = [...String(html || '').matchAll(/[?&]page=(\\d+)/gi)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
  return pages.length ? Math.max(...pages) : 0;
}

async function fetchCompleteAthensTradingDirectory(fetchImpl, firstPageHtml, options = {}) {
  const maxPublishedPage = tradingDirectoryLastPage(firstPageHtml);
  const maxPage = Math.min(maxPublishedPage, Math.max(0, Number(options.tradingDirectoryMaxPage ?? 50)));
  const pages = [String(firstPageHtml || '')];
  const diagnostics = [];
  const batchSize = Math.max(1, Math.min(6, Number(options.tradingDirectoryConcurrency ?? 4)));

  for (let start = 1; start <= maxPage; start += batchSize) {
    const pageNumbers = Array.from({ length: Math.min(batchSize, maxPage - start + 1) }, (_, index) => start + index);
    const results = await Promise.all(pageNumbers.map(async (page) => {
      try {
        const separator = ATHENS_TRADING_ISSUERS_URL.includes('?') ? '&' : '?';
        const pageUrl = ATHENS_TRADING_ISSUERS_URL + separator + 'page=' + page;
        const html = await fetchText(fetchImpl, pageUrl, options);
        return { page, html };
      } catch (error) {
        return {
          page,
          html: '',
          errorClass: String(error?.message || error).startsWith('HTTP')
            ? String(error.message)
            : 'NETWORK_OR_PARSE_ERROR',
        };
      }
    }));
    for (const result of results) {
      if (result.html) pages.push(result.html);
      else diagnostics.push({
        code: 'ATHENS_TRADING_DIRECTORY_PAGE_FAILED',
        page: result.page,
        errorClass: result.errorClass,
      });
    }
  }

  return {
    html: pages.join('\\n'),
    diagnostics,
    requestedPageCount: maxPage + 1,
    loadedPageCount: pages.length,
    complete: diagnostics.length === 0 && pages.length === maxPage + 1,
  };
}

`;

replaceRequired(
  'export async function fetchAthensDiscovery(options = {}) {',
  `${paginationHelpers}export async function fetchAthensDiscovery(options = {}) {`,
  'complete trading directory loader',
);

replaceRequired(
  '    const [issuerHtml, announcementHtml, tradingIssuersHtml] = await Promise.all([\n      fetchText(fetchImpl, options.issuersUrl || ATHENS_ISSUERS_URL, options),\n      fetchText(fetchImpl, options.announcementsUrl || ATHENS_ANNOUNCEMENTS_URL, options),\n      fetchText(fetchImpl, options.tradingIssuersUrl || ATHENS_TRADING_ISSUERS_URL, options).catch(() => \'\'),\n    ]);',
  "    const [issuerHtml, announcementHtml, tradingIssuersFirstPage] = await Promise.all([\n      fetchText(fetchImpl, options.issuersUrl || ATHENS_ISSUERS_URL, options),\n      fetchText(fetchImpl, options.announcementsUrl || ATHENS_ANNOUNCEMENTS_URL, options),\n      fetchText(fetchImpl, options.tradingIssuersUrl || ATHENS_TRADING_ISSUERS_URL, options).catch(() => ''),\n    ]);\n    const tradingDirectoryFetch = await fetchCompleteAthensTradingDirectory(\n      fetchImpl,\n      tradingIssuersFirstPage,\n      options,\n    );\n    const tradingIssuersHtml = tradingDirectoryFetch.html;",
  'complete directory fetch integration',
);

replaceRequired(
  "    const diagnostics = [...universe.diagnostics, ...announcements.diagnostics, ...tradingDirectory.diagnostics]\n      .filter((item) => !(item.code === 'ATHENS_ISSUER_UNIVERSE_EMPTY' && companyPool.length));",
  "    const diagnostics = [\n      ...universe.diagnostics,\n      ...announcements.diagnostics,\n      ...tradingDirectoryFetch.diagnostics,\n      ...tradingDirectory.diagnostics,\n    ].filter((item) => !(item.code === 'ATHENS_ISSUER_UNIVERSE_EMPTY' && companyPool.length));",
  'directory page diagnostics',
);

replaceRequired(
  '      companies,\n      records: announcements.records,\n      diagnostics,',
  "      companies,\n      records: announcements.records,\n      tradingDirectoryHealth: {\n        requestedPageCount: tradingDirectoryFetch.requestedPageCount,\n        loadedPageCount: tradingDirectoryFetch.loadedPageCount,\n        complete: tradingDirectoryFetch.complete,\n        instrumentCount: tradingDirectory.records.length,\n      },\n      diagnostics,",
  'directory completeness contract',
);

source = source.replaceAll('version: 4,', 'version: 5,');
fs.writeFileSync(adapterPath, source);

const verified = fs.readFileSync(adapterPath, 'utf8');
for (const invariant of [
  'fetchCompleteAthensTradingDirectory',
  'ATHENS_TRADING_DIRECTORY_PAGE_FAILED',
  'tradingDirectoryHealth',
  'version: 5,',
]) {
  if (!verified.includes(invariant)) throw new Error(`v1.2.3 Athens pagination verification failed: ${invariant}`);
}
console.log('Investor Control v1.2.3 complete official Athens trading directory applied.');
