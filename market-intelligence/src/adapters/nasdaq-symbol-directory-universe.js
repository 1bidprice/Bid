export const NASDAQ_SYMBOL_DIRECTORY_UNIVERSE_VERSION = '2026-08-09.1';

const NASDAQ_LISTED_URL = 'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt';
const OTHER_LISTED_URL = 'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt';

const OTHER_EXCHANGES = Object.freeze({
  A: { exchange: 'NYSE American', mic: 'XASE' },
  N: { exchange: 'New York Stock Exchange', mic: 'XNYS' },
  P: { exchange: 'NYSE Arca', mic: 'ARCX' },
  Z: { exchange: 'Cboe BZX', mic: 'BATS' },
  V: { exchange: 'Investors Exchange', mic: 'IEXG' },
});

function rows(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split('|').map((item) => item.trim());
  return lines.slice(1)
    .filter((line) => !/^File Creation Time:/i.test(line))
    .map((line) => {
      const values = line.split('|');
      return Object.fromEntries(headers.map((header, index) => [header, String(values[index] || '').trim()]));
    });
}

function cleanName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim();
}

function isExcludedStructure(name) {
  const value = cleanName(name).toLowerCase();
  return /\b(warrant|warrants|right|rights|unit|units|preferred|preference|depositary shares.*interest|senior notes?|subordinated notes?|debentures?|bonds?|notes? due|baby bond)\b/i.test(value);
}

function isCommonEquityName(name) {
  const value = cleanName(name);
  if (!value || isExcludedStructure(value)) return false;
  return /\b(common stock|common shares?|ordinary shares?|ordinary share|class [a-z] common|class [a-z] ordinary|american depositary shares?|american depository shares?|\bads\b|\badr\b|shares of common stock)\b/i.test(value);
}

function financialStatusRisk(status) {
  const value = String(status || 'N').toUpperCase();
  if (!value || value === 'N') return [];
  const flags = ['LISTING_FINANCIAL_STATUS_NOT_NORMAL'];
  if (['Q', 'G', 'J', 'K'].includes(value)) flags.push('SEVERE_LISTING_BANKRUPTCY_STATUS');
  if (['D', 'G', 'H', 'K'].includes(value)) flags.push('LISTING_DEFICIENT');
  if (['E', 'H', 'J', 'K'].includes(value)) flags.push('LISTING_DELINQUENT');
  return flags;
}

function nasdaqInstrument(row) {
  const symbol = row.Symbol;
  const name = cleanName(row['Security Name']);
  const isEtf = row.ETF === 'Y';
  if (!symbol || row['Test Issue'] === 'Y') return null;
  if (!isEtf && !isCommonEquityName(name)) return null;
  return {
    instrumentId: `listing:XNAS:${symbol}`,
    displayName: name,
    legalName: name,
    assetClass: isEtf ? 'ETF' : 'EQUITY',
    country: 'US',
    currency: 'USD',
    primaryListing: { symbol, mic: 'XNAS', exchange: 'Nasdaq', currency: 'USD' },
    listingDirectory: {
      source: 'NASDAQ_TRADER_SYMBOL_DIRECTORY',
      sourceUrl: NASDAQ_LISTED_URL,
      marketCategory: row['Market Category'] || null,
      financialStatus: row['Financial Status'] || null,
      roundLotSize: Number(row['Round Lot Size']) || null,
      etf: isEtf,
      nextShares: row.NextShares === 'Y',
    },
    severeRiskFlags: financialStatusRisk(row['Financial Status']),
  };
}

function otherInstrument(row) {
  const symbol = row['ACT Symbol'] || row['NASDAQ Symbol'] || row['CQS Symbol'];
  const name = cleanName(row['Security Name']);
  const venue = OTHER_EXCHANGES[row.Exchange];
  const isEtf = row.ETF === 'Y';
  if (!symbol || !venue || row['Test Issue'] === 'Y') return null;
  if (!isEtf && !isCommonEquityName(name)) return null;
  return {
    instrumentId: `listing:${venue.mic}:${symbol}`,
    displayName: name,
    legalName: name,
    assetClass: isEtf ? 'ETF' : 'EQUITY',
    country: 'US',
    currency: 'USD',
    primaryListing: { symbol, mic: venue.mic, exchange: venue.exchange, currency: 'USD' },
    listingDirectory: {
      source: 'NASDAQ_TRADER_SYMBOL_DIRECTORY',
      sourceUrl: OTHER_LISTED_URL,
      exchangeCode: row.Exchange,
      roundLotSize: Number(row['Round Lot Size']) || null,
      etf: isEtf,
    },
    severeRiskFlags: [],
  };
}

export function parseNasdaqListedUniverse(text) {
  return rows(text).map(nasdaqInstrument).filter(Boolean);
}

export function parseOtherListedUniverse(text) {
  return rows(text).map(otherInstrument).filter(Boolean);
}

async function fetchText(fetchImpl, url) {
  const response = await fetchImpl(url, { headers: { Accept: 'text/plain' } });
  if (!response.ok) throw new Error(`Nasdaq symbol directory request failed: ${response.status} ${url}`);
  return response.text();
}

export function createNasdaqUsListedUniverseProvider(options = {}) {
  return {
    id: 'NASDAQ_US_LISTED_EQUITY_ETF_UNIVERSE',
    sourceRole: 'OFFICIAL_EXCHANGE_DIRECTORY',
    policyVersion: NASDAQ_SYMBOL_DIRECTORY_UNIVERSE_VERSION,
    async discover(context = {}) {
      const requested = new Set(context.assetClasses || ['EQUITY', 'ETF']);
      if (!requested.has('EQUITY') && !requested.has('ETF')) return { instruments: [], diagnostics: [] };
      const fetchImpl = context.fetchImpl || options.fetchImpl || globalThis.fetch;
      if (typeof fetchImpl !== 'function') throw new Error('Nasdaq universe provider requires fetch');
      const [nasdaqText, otherText] = await Promise.all([
        fetchText(fetchImpl, NASDAQ_LISTED_URL),
        fetchText(fetchImpl, OTHER_LISTED_URL),
      ]);
      let instruments = [...parseNasdaqListedUniverse(nasdaqText), ...parseOtherListedUniverse(otherText)];
      instruments = instruments.filter((instrument) => requested.has(instrument.assetClass));
      const limit = Math.max(1, Number(context.limit || options.limit || instruments.length || 1));
      const sliced = instruments.slice(0, limit);
      return {
        format: 'investor-control-universe-provider-result',
        version: 1,
        providerId: this.id,
        generatedAt: new Date(context.now || Date.now()).toISOString(),
        instruments: sliced,
        totalEligibleCount: instruments.length,
        truncated: sliced.length < instruments.length,
        diagnostics: [],
      };
    },
  };
}

export const NASDAQ_US_LISTED_UNIVERSE_URLS = Object.freeze({
  nasdaqListed: NASDAQ_LISTED_URL,
  otherListed: OTHER_LISTED_URL,
});
