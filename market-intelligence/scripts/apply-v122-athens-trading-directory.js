import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adapterPath = path.join(root, 'src/adapters/euronext-athens-discovery.js');
let source = fs.readFileSync(adapterPath, 'utf8');

function replaceRequired(from, to, label) {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`v1.2.2 Athens directory patch failed: missing ${label}`);
  source = source.replace(from, to);
}

replaceRequired(
  "export const ATHENS_SEARCH_URL = 'https://athens.euronext.com/en/search';",
  "export const ATHENS_SEARCH_URL = 'https://athens.euronext.com/en/search';\nexport const ATHENS_TRADING_ISSUERS_URL = 'https://athens.euronext.com/en/trade/trading-products/trading-issuers';",
  'official trading directory URL',
);

replaceRequired(
  "export const ATHENS_DISCOVERY_VERSION = '2026-08-04.3';",
  "export const ATHENS_DISCOVERY_VERSION = '2026-08-05.1';",
  'Athens discovery policy version',
);

const directoryFunctions = `function validOasisSymbol(value) {
  const symbol = plainText(value).toUpperCase();
  if (!/^[A-Z0-9._-]{1,16}$/.test(symbol)) return null;
  if (/^(ISSUER|ISIN|CODE|OASIS|MARKET|MIFID|PRODUCT|STOCK|SHARE|MAIN|ALTERNATIVE)$/.test(symbol)) return null;
  if (/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(symbol)) return null;
  return symbol;
}

export function extractAthensTradingDirectory(html) {
  const records = [];
  const diagnostics = [];
  const byName = new Map();

  for (const row of tableRows(html)) {
    const values = cells(row);
    if (values.length < 3) continue;
    const issuerName = values[0];
    if (!issuerName || /^(issuer|company)$/i.test(issuerName)) continue;

    const rowText = values.join(' ');
    if (/bond|treasury bill|derivative|future|option|warrant|etf/i.test(rowText) && !/stock|share|common/i.test(rowText)) continue;

    const isin = values.find((value) => /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(String(value).trim().toUpperCase())) || null;
    const preferred = validOasisSymbol(values[2]);
    const fallback = values.slice(1).map(validOasisSymbol).find(Boolean) || null;
    const linked = bestIdentityCandidate(stockLinkCandidates(row), { displayName: issuerName, legalName: issuerName });
    const symbol = linked?.symbol || preferred || fallback;
    if (!symbol) continue;

    const issuer = bestIdentityCandidate(issuerLinkCandidates(row), { displayName: issuerName, legalName: issuerName });
    const record = {
      issuerName,
      normalizedIssuerName: normalizedName(issuerName),
      symbol,
      isin,
      issuerId: issuer?.issuerId || null,
      issuerUrl: issuer?.sourceUrl || null,
      instrumentUrl: linked?.sourceUrl || null,
      sourceName: 'Euronext Athens Trading Issuers',
      sourceUrl: ATHENS_TRADING_ISSUERS_URL,
    };

    const existing = byName.get(record.normalizedIssuerName);
    const score = (linked ? 4 : 0) + (/stock|share|common/i.test(rowText) ? 2 : 0) + (isin ? 1 : 0);
    if (!existing || score > existing._score) {
      const selected = { ...record, _score: score };
      byName.set(record.normalizedIssuerName, selected);
    }
  }

  for (const item of byName.values()) {
    const { _score, ...record } = item;
    records.push(record);
  }
  if (!records.length) diagnostics.push({ code: 'ATHENS_TRADING_DIRECTORY_EMPTY' });
  return { records, diagnostics };
}

function matchTradingDirectory(company, directory) {
  const records = Array.isArray(directory?.records) ? directory.records : [];
  const target = normalizedName(company?.displayName || company?.legalName);
  if (!target) return null;
  const exact = records.find((item) => item.normalizedIssuerName === target);
  if (exact) return exact;
  const candidates = records.filter((item) => item.normalizedIssuerName
    && (item.normalizedIssuerName.includes(target) || target.includes(item.normalizedIssuerName)));
  return candidates.length === 1 ? candidates[0] : null;
}

function applyTradingDirectoryIdentity(company, directory) {
  const match = matchTradingDirectory(company, directory);
  if (!match?.symbol) return company;
  return {
    ...company,
    issuerId: match.issuerId || company.issuerId || null,
    investorRelationsUrl: match.issuerUrl || company.investorRelationsUrl || null,
    primaryListing: { ...company.primaryListing, symbol: match.symbol },
    aliases: [...new Set([...(company.aliases || []), match.symbol])],
    instrumentUrl: match.instrumentUrl || company.instrumentUrl || null,
    isin: match.isin || company.isin || null,
    identitySource: 'EURONEXT_ATHENS_TRADING_ISSUERS',
  };
}

`;

replaceRequired(
  'export function extractAthensRelatedInstrument(html, company) {',
  `${directoryFunctions}export function extractAthensRelatedInstrument(html, company) {`,
  'trading directory parser',
);

replaceRequired(
  'async function resolveCompanySymbol(fetchImpl, company, options, diagnostics) {\n  let resolved = await resolveCompanyIdentity(fetchImpl, company, options, diagnostics);',
  "async function resolveCompanySymbol(fetchImpl, company, options, diagnostics) {\n  let resolved = applyTradingDirectoryIdentity(company, options.tradingDirectory);\n  if (!resolved.primaryListing?.symbol) resolved = await resolveCompanyIdentity(fetchImpl, resolved, options, diagnostics);",
  'directory-first identity resolution',
);

replaceRequired(
  '    const [issuerHtml, announcementHtml] = await Promise.all([\n      fetchText(fetchImpl, options.issuersUrl || ATHENS_ISSUERS_URL, options),\n      fetchText(fetchImpl, options.announcementsUrl || ATHENS_ANNOUNCEMENTS_URL, options),\n    ]);',
  "    const [issuerHtml, announcementHtml, tradingIssuersHtml] = await Promise.all([\n      fetchText(fetchImpl, options.issuersUrl || ATHENS_ISSUERS_URL, options),\n      fetchText(fetchImpl, options.announcementsUrl || ATHENS_ANNOUNCEMENTS_URL, options),\n      fetchText(fetchImpl, options.tradingIssuersUrl || ATHENS_TRADING_ISSUERS_URL, options).catch(() => ''),\n    ]);",
  'official trading directory fetch',
);

replaceRequired(
  '    const announcements = extractAthensAnnouncements(announcementHtml, universe.companies, { retrievedAt: generatedAt });\n    const companyPool = announcements.companies || universe.companies;',
  "    const announcements = extractAthensAnnouncements(announcementHtml, universe.companies, { retrievedAt: generatedAt });\n    const tradingDirectory = extractAthensTradingDirectory(tradingIssuersHtml);\n    const companyPool = announcements.companies || universe.companies;",
  'directory normalization',
);

replaceRequired(
  '    const diagnostics = [...universe.diagnostics, ...announcements.diagnostics]\n      .filter((item) => !(item.code === \'ATHENS_ISSUER_UNIVERSE_EMPTY\' && companyPool.length));',
  "    const diagnostics = [...universe.diagnostics, ...announcements.diagnostics, ...tradingDirectory.diagnostics]\n      .filter((item) => !(item.code === 'ATHENS_ISSUER_UNIVERSE_EMPTY' && companyPool.length));",
  'directory diagnostics',
);

replaceRequired(
  '      companies.push(await resolveCompanySymbol(fetchImpl, company, options, diagnostics));',
  '      companies.push(await resolveCompanySymbol(fetchImpl, company, { ...options, tradingDirectory }, diagnostics));',
  'directory resolution injection',
);

source = source.replaceAll('version: 3,', 'version: 4,');

fs.writeFileSync(adapterPath, source);

const verified = fs.readFileSync(adapterPath, 'utf8');
for (const invariant of [
  'ATHENS_TRADING_ISSUERS_URL',
  'extractAthensTradingDirectory',
  'EURONEXT_ATHENS_TRADING_ISSUERS',
  'version: 4,',
]) {
  if (!verified.includes(invariant)) throw new Error(`v1.2.2 Athens directory verification failed: ${invariant}`);
}
console.log('Investor Control v1.2.2 official Athens trading-directory identity resolution applied.');
