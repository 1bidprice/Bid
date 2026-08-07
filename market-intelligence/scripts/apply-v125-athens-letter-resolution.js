import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adapterPath = path.join(root, 'src/adapters/euronext-athens-discovery.js');
let source = fs.readFileSync(adapterPath, 'utf8');

function replaceRequired(from, to, label) {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`v1.2.5 Athens letter-resolution patch failed: missing ${label}`);
  source = source.replace(from, to);
}

replaceRequired(
  "export const ATHENS_DISCOVERY_VERSION = '2026-08-05.3';",
  "export const ATHENS_DISCOVERY_VERSION = '2026-08-05.6';",
  'Athens discovery policy version',
);

const letterResolver = `const ATHENS_VERIFIED_SYMBOL_IDENTITIES = new Map([
  ['ADMIE IPTO', { symbol: 'ADMIE', instrumentUrl: 'https://athens.euronext.com/en/market-data/instruments/stocks/ADMIE' }],
]);

function applyVerifiedSymbolIdentity(company) {
  const key = normalizedName(company?.displayName || company?.legalName);
  const verified = ATHENS_VERIFIED_SYMBOL_IDENTITIES.get(key)
    || [...ATHENS_VERIFIED_SYMBOL_IDENTITIES.entries()].find(([name]) => key.startsWith(name + ' '))?.[1];
  if (!verified) return company;
  return {
    ...company,
    primaryListing: { ...company.primaryListing, symbol: verified.symbol },
    aliases: [...new Set([...(company.aliases || []), verified.symbol])],
    instrumentUrl: verified.instrumentUrl,
  };
}

function issuerDirectoryLetter(company) {
  const normalized = normalizedName(company?.displayName || company?.legalName);
  const first = normalized.match(/[A-Z0-9]/)?.[0] || null;
  return first;
}

async function fetchAthensLetterDirectory(fetchImpl, company, options = {}, diagnostics = []) {
  const letter = issuerDirectoryLetter(company);
  if (!letter) return null;
  const cache = options.letterDirectoryCache instanceof Map
    ? options.letterDirectoryCache
    : new Map();
  options.letterDirectoryCache = cache;
  if (!cache.has(letter)) {
    cache.set(letter, (async () => {
      try {
        const base = ATHENS_TRADING_ISSUERS_URL.split('?')[0];
        const html = await fetchText(fetchImpl, base + '?letter=' + encodeURIComponent(letter), options);
        const parsed = extractAthensTradingDirectory(html);
        if (!parsed.records.length) diagnostics.push({ code: 'ATHENS_LETTER_DIRECTORY_EMPTY', letter });
        return parsed;
      } catch (error) {
        diagnostics.push({
          code: 'ATHENS_LETTER_DIRECTORY_FETCH_FAILED',
          letter,
          errorClass: String(error?.message || error).startsWith('HTTP')
            ? String(error.message)
            : 'NETWORK_OR_PARSE_ERROR',
        });
        return { records: [], diagnostics: [] };
      }
    })());
  }
  const directory = await cache.get(letter);
  const matched = applyTradingDirectoryIdentity(company, directory);
  return matched.primaryListing?.symbol ? matched : null;
}

`;

replaceRequired(
  'async function resolveCompanySymbol(fetchImpl, company, options, diagnostics) {\n  let resolved = applyTradingDirectoryIdentity(company, options.tradingDirectory);\n  if (!resolved.primaryListing?.symbol) resolved = await resolveCompanyIdentity(fetchImpl, resolved, options, diagnostics);',
  `${letterResolver}async function resolveCompanySymbol(fetchImpl, company, options, diagnostics) {\n  let resolved = applyVerifiedSymbolIdentity(applyTradingDirectoryIdentity(company, options.tradingDirectory));\n  if (!resolved.primaryListing?.symbol) {\n    const letterResolved = await fetchAthensLetterDirectory(fetchImpl, resolved, options, diagnostics);\n    if (letterResolved) resolved = letterResolved;\n  }\n  if (!resolved.primaryListing?.symbol) resolved = await resolveCompanyIdentity(fetchImpl, resolved, options, diagnostics);`,
  'official letter-directory fallback and verified ADMIE identity',
);

replaceRequired(
  '    const companies = [];\n\n    for (const companyId of activeCompanyIds) {',
  '    const companies = [];\n    const letterDirectoryCache = new Map();\n\n    for (const companyId of activeCompanyIds) {',
  'shared letter-directory cache',
);

replaceRequired(
  '      companies.push(await resolveCompanySymbol(fetchImpl, company, { ...options, tradingDirectory }, diagnostics));',
  '      companies.push(await resolveCompanySymbol(fetchImpl, company, { ...options, tradingDirectory, letterDirectoryCache }, diagnostics));',
  'letter-directory cache injection',
);

source = source.replaceAll('version: 5,', 'version: 6,');
fs.writeFileSync(adapterPath, source);

const verified = fs.readFileSync(adapterPath, 'utf8');
for (const invariant of [
  'fetchAthensLetterDirectory',
  'ATHENS_LETTER_DIRECTORY_FETCH_FAILED',
  'letterDirectoryCache',
  'ATHENS_VERIFIED_SYMBOL_IDENTITIES',
  "'ADMIE IPTO', { symbol: 'ADMIE'",
  "key.startsWith(name + ' ')",
  'version: 6,',
]) {
  if (!verified.includes(invariant)) throw new Error(`v1.2.5 Athens letter-resolution verification failed: ${invariant}`);
}
console.log('Investor Control v1.2.5 official Athens letter-directory and verified ADMIE resolution applied.');
