import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildMobileQuoteContract, quoteFromRegistry, safeProviderDiagnostic } from './quote-contract';
import { routeMobileInstrument } from './instrument-quote-integrity';
import { marketStateForSymbol } from './market-rules';

const EURONEXT_ATHENS_STOCK_URL = (ticker) => `https://athens.euronext.com/en/market-data/instruments/stocks/${encodeURIComponent(ticker)}/related`;
const YAHOO_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const PERSISTED_STATE_KEY = 'investor-control-mobile-state-v2';
const INTELLIGENCE_FEED_STORAGE_KEY = 'investor-control.intelligence-feed.v1';
const inMemoryQuotes = {};

export const MARKET_REFRESH_MS = 30_000;
export const FINNHUB_TOKEN_KEY = 'investor-control-finnhub-token';

const finite = (value) => Number.isFinite(Number(value)) && Number(value) > 0;

function parseLocaleNumber(value) {
  const raw = String(value ?? '').trim().replace(/\s/g, '');
  if (!raw) return null;
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function marketSessionAt(symbol, at = new Date()) {
  return marketStateForSymbol(symbol, at).session;
}

export function exchangeState(symbol, at = new Date()) {
  return marketStateForSymbol(symbol, at);
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&euro;|&#8364;/gi, ' € ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function numberAfterLabel(text, labels) {
  for (const label of labels) {
    const index = text.toLowerCase().indexOf(label.toLowerCase());
    if (index < 0) continue;
    const slice = text.slice(index + label.length, index + label.length + 220);
    const match = slice.match(/(?:€\s*)?([0-9]{1,4}(?:[.,][0-9]{2,4}))(?:\s*€)?/);
    const value = match ? parseLocaleNumber(match[1]) : null;
    if (finite(value)) return value;
  }
  return null;
}

async function fetchText(url, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/json,text/plain,*/*',
        'Cache-Control': 'no-cache',
        'User-Agent': 'InvestorControl/1.7.3',
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`, {
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function yahooSession(meta, timestamp) {
  const zone = String(meta?.exchangeTimezoneName || meta?.timezone || '');
  if (!zone.includes('New_York') || !finite(timestamp)) return 'regular-market';
  return marketSessionAt('YAHOO.US', new Date(Number(timestamp) * 1000));
}

function latestYahooPoint(result) {
  const candidates = [];
  const meta = result?.meta || {};
  const timestamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];

  for (let index = Math.min(timestamps.length, closes.length) - 1; index >= 0; index -= 1) {
    if (finite(closes[index]) && finite(timestamps[index])) {
      const timestamp = Number(timestamps[index]);
      const session = yahooSession(meta, timestamp);
      candidates.push({
        price: Number(closes[index]),
        timestamp,
        kind: session === 'regular-market' ? '1m-bar' : `${session}-1m-bar`,
        session,
        priority: 1,
      });
      break;
    }
  }

  const addMetaPoint = (priceKey, timeKey, kind, session, priority) => {
    if (!finite(meta[priceKey]) || !finite(meta[timeKey])) return;
    candidates.push({
      price: Number(meta[priceKey]),
      timestamp: Number(meta[timeKey]),
      kind,
      session,
      priority,
    });
  };

  addMetaPoint('preMarketPrice', 'preMarketTime', 'pre-market', 'pre-market', 4);
  addMetaPoint('postMarketPrice', 'postMarketTime', 'post-market', 'post-market', 4);
  addMetaPoint('regularMarketPrice', 'regularMarketTime', 'regular-market', 'regular-market', 3);

  if (!candidates.length) return null;
  return candidates.sort((a, b) => (b.timestamp - a.timestamp) || (b.priority - a.priority))[0];
}

async function fetchYahooQuote(ticker) {
  const errors = [];
  for (const host of YAHOO_HOSTS) {
    try {
      const payload = await fetchJson(
        `https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}?range=5d&interval=1m&includePrePost=true&events=div%2Csplits`,
      );
      const result = payload?.chart?.result?.[0];
      if (!result) throw new Error(payload?.chart?.error?.description || 'κενό αποτέλεσμα');
      const point = latestYahooPoint(result);
      if (!point) throw new Error('χωρίς έγκυρη τιμή');
      const meta = result.meta || {};
      // Yahoo's chartPreviousClose can represent the 5-day chart baseline, not today's prior close.
      // Prefer previousClose so the daily percentage matches the broker.
      const previousClose = finite(meta.previousClose || meta.chartPreviousClose)
        ? Number(meta.previousClose || meta.chartPreviousClose)
        : null;
      const regularMarketPrice = finite(meta.regularMarketPrice)
        ? Number(meta.regularMarketPrice)
        : null;
      const changeBase = point.session === 'post-market' && finite(regularMarketPrice)
        ? regularMarketPrice
        : previousClose;
      return {
        nativePrice: point.price,
        nativePreviousClose: previousClose,
        nativeChangeBase: changeBase,
        nativeRegularMarketPrice: regularMarketPrice,
        nativeCurrency: String(meta.currency || '').toUpperCase() || null,
        updatedAt: new Date(point.timestamp * 1000).toISOString(),
        checkedAt: new Date().toISOString(),
        source: `Yahoo Finance ${point.kind} (εφεδρική πηγή)`,
        providerSymbol: ticker,
        quality: 'unofficial',
        session: point.session,
    timestampMeaning: 'provider-market-time',
    priceTimestampVerified: true,
    dayChangeVerified: finite(previousClose),
      };
    } catch (error) {
      errors.push(`${host}: ${error.message}`);
    }
  }
  throw new Error(errors.join(' | '));
}

async function fetchFinnhubQuote(ticker, token) {
  if (!token) throw new Error('δεν έχει αποθηκευτεί Finnhub token');
  const payload = await fetchJson(
    `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(token)}`,
  );
  if (!finite(payload?.c)) throw new Error('το Finnhub δεν επέστρεψε έγκυρη τιμή');
  const timestampVerified = finite(payload?.t);
  const timestamp = timestampVerified ? Number(payload.t) : null;
  const checkedAt = new Date();
  return {
    nativePrice: Number(payload.c),
    nativePreviousClose: finite(payload.pc) ? Number(payload.pc) : null,
    nativeChangeBase: finite(payload.pc) ? Number(payload.pc) : null,
    nativeRegularMarketPrice: Number(payload.c),
    nativeProviderChangePct: Number.isFinite(Number(payload?.dp)) ? Number(payload.dp) : null,
    nativeCurrency: 'USD',
    updatedAt: timestampVerified ? new Date(timestamp * 1000).toISOString() : null,
    checkedAt: checkedAt.toISOString(),
    source: 'Finnhub US quote',
    providerSymbol: ticker,
    quality: 'realtime',
    priceTimestampVerified: timestampVerified,
    session: timestampVerified ? marketSessionAt(`${ticker}.US`, new Date(timestamp * 1000)) : marketSessionAt(`${ticker}.US`, checkedAt),
  };
}

export function openFinnhubTrades(token, symbols, onTrade, onStatus = () => {}) {
  if (!token || !symbols?.length) return () => {};
  const socket = new WebSocket(`wss://ws.finnhub.io?token=${encodeURIComponent(token)}`);
  const clean = [...new Set(symbols.filter(Boolean).map((value) => String(value).trim().toUpperCase()))];

  socket.onopen = () => {
    clean.forEach((symbol) => socket.send(JSON.stringify({ type: 'subscribe', symbol })));
    onStatus('open');
  };

  socket.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload?.type !== 'trade' || !Array.isArray(payload.data)) return;
      const latest = [...payload.data]
        .filter((trade) => clean.includes(String(trade?.s || '').toUpperCase()) && finite(trade?.p) && finite(trade?.t))
        .sort((a, b) => Number(b.t) - Number(a.t))[0];
      if (!latest) return;

      const providerSymbol = String(latest.s).toUpperCase();
      const appSymbol = `${providerSymbol}.US`;
      const timestamp = Number(latest.t);
      const current = inMemoryQuotes[appSymbol];
      const previousClose = finite(current?.nativePreviousClose)
        ? Number(current.nativePreviousClose)
        : 0;
      const regularMarketPrice = finite(current?.nativeRegularMarketPrice)
        ? Number(current.nativeRegularMarketPrice)
        : 0;
      const fxRate = Number(current?.fxRate || 0);
      const session = marketSessionAt(appSymbol, new Date(timestamp));
      const changeBase = session === 'post-market' && regularMarketPrice > 0
        ? regularMarketPrice
        : previousClose;
      const classifiedQuote = classifyQuote(appSymbol, {
        ...current,
        symbol: appSymbol,
        nativePrice: Number(latest.p),
        price: fxRate > 0 ? Number(latest.p) / fxRate : current?.price,
        nativeRegularMarketPrice: session === 'regular-market'
          ? Number(latest.p)
          : current?.nativeRegularMarketPrice,
        updatedAt: new Date(timestamp).toISOString(),
        checkedAt: new Date().toISOString(),
        source: 'Finnhub WebSocket real-time trade',
        providerSymbol,
        quality: 'realtime',
        session,
        nativeChangeBase: changeBase > 0 ? changeBase : current?.nativeChangeBase,
        changePct: changeBase > 0
          ? ((Number(latest.p) - changeBase) / changeBase) * 100
          : current?.changePct,
      });
      inMemoryQuotes[appSymbol] = classifiedQuote;
      onTrade({ symbol: providerSymbol, appSymbol, price: Number(latest.p), timestamp, quote: classifiedQuote });
    } catch (_) {}
  };

  socket.onerror = () => onStatus('error');
  socket.onclose = () => onStatus('closed');
  return () => {
    try {
      clean.forEach((symbol) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'unsubscribe', symbol }));
        }
      });
      socket.close();
    } catch (_) {}
  };
}

async function fetchOfficialAthensQuote(symbol) {
  const route = routeMobileInstrument(symbol);
  if (!route.supported || route.market !== 'GR') throw new Error('μη επαληθευμένη αγορά για επίσημη πηγή Αθήνας');
  const checkedAt = new Date();
  const exchange = exchangeState(symbol, checkedAt);
  const html = await fetchText(EURONEXT_ATHENS_STOCK_URL(route.baseSymbol));
  const text = htmlToText(html);
  if (!/Traded on Euronext Athens/i.test(text) || !/Last Traded Price/i.test(text)) {
    throw new Error('official Euronext Athens stock page identity not verified');
  }
  const priceValue = numberAfterLabel(text, ['Last Traded Price', 'Τελευταία Τιμή Διαπραγμάτευσης']);
  const previousClose = numberAfterLabel(text, ['Previous Close', 'Προηγούμενο Κλείσιμο']);
  if (!finite(priceValue)) throw new Error(`η Euronext Athens δεν επέστρεψε τιμή για ${route.baseSymbol}`);
  return {
    nativePrice: priceValue,
    nativePreviousClose: finite(previousClose) ? previousClose : null,
    nativeChangeBase: finite(previousClose) ? previousClose : null,
    nativeRegularMarketPrice: priceValue,
    nativeCurrency: 'EUR',
    updatedAt: null,
    checkedAt: checkedAt.toISOString(),
    source: 'Euronext Athens — επίσημα δεδομένα με καθυστέρηση 15′',
    providerSymbol: route.baseSymbol,
    quality: 'primary_exchange_delayed',
    advertisedDelayMinutes: Number(route.advertisedDelayMinutes || 15),
    session: exchange.session,
    timestampMeaning: 'exact-trade-time-not-provided-by-adapter',
    priceTimestampVerified: false,
    dayChangeVerified: false,
  };
}

async function fetchEurUsd() {
  const quote = await fetchYahooQuote('EURUSD=X');
  if (!finite(quote.nativePrice)) throw new Error('δεν υπάρχει ισοτιμία EUR/USD');
  return {
    rate: Number(quote.nativePrice),
    updatedAt: quote.updatedAt,
    source: quote.source,
  };
}

export function classifyQuote(symbol, quote) {
  if (!quote || !finite(quote.nativePrice)) return quote;
  const exchange = exchangeState(symbol);
  const quoteContract = buildMobileQuoteContract(symbol, quote, {
    now: Date.now(),
    exchangeOpen: exchange.open,
    exchangeSession: exchange.session,
    exchangeCalendarVerified: exchange.calendarVerified !== false,
  });
  const updatedMs = new Date(quote.updatedAt || 0).getTime();
  const ageSeconds = Number.isFinite(updatedMs) && updatedMs > 0
    ? Math.max(0, Math.round((Date.now() - updatedMs) / 1000))
    : null;
  let status = 'unverified';
  if (quoteContract.publicStatus === 'STALE') status = 'stale';
  else if (quoteContract.publicStatus === 'FALLBACK_NOT_VERIFIED' || quoteContract.publicStatus === 'INSTRUMENT_UNVERIFIED' || quoteContract.publicStatus === 'UNAVAILABLE') status = 'unverified';
  else if (!exchange.open) {
    if (quote.session === 'pre-market') status = 'pre-market';
    else if (quote.session === 'post-market') status = 'post-market';
    else status = 'closed';
  } else if (quoteContract.publicStatus === 'TIMESTAMP_NOT_VERIFIED' || quoteContract.sourceRole === 'PRIMARY_EXCHANGE') status = 'delayed';
  else status = quote.quality === 'realtime' ? 'live' : 'near-live';

  return {
    ...quote,
    ageSeconds,
    status,
    exchangeOpen: exchange.open,
    quoteContract,
    instrumentIntegrity: quoteContract.instrumentIntegrity,
    usable: quoteContract.valuationEligible === true,
    dayChangeVerified: quoteContract.dayChangeEligible === true,
  };
}

function quoteTimestamp(quote) {
  const value = new Date(quote?.updatedAt || quote?.checkedAt || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

function checkedTimestamp(quote) {
  const value = new Date(quote?.checkedAt || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

function quotePriority(quote) {
  const quality = { realtime: 400, delayed15: 300, unofficial: 200 }[quote?.quality] || 100;
  const source = String(quote?.source || '');
  return quality + (/WebSocket/i.test(source) ? 25 : 0) + (/Euronext/i.test(source) ? 10 : 0);
}

function repairSession(symbol, quote) {
  const at = new Date(quote?.updatedAt || 0);
  if (/WebSocket/i.test(String(quote?.source || '')) && Number.isFinite(at.getTime())) {
    return marketSessionAt(symbol, at);
  }
  return quote?.session;
}

export function chooseMostRecentQuote(symbol, currentQuote, incomingQuote) {
  if (!currentQuote && !incomingQuote) return null;
  if (!currentQuote) return classifyQuote(symbol, incomingQuote);
  if (!incomingQuote) return classifyQuote(symbol, currentQuote);

  const currentTime = quoteTimestamp(currentQuote);
  const incomingTime = quoteTimestamp(incomingQuote);
  const toleranceMs = 1000;
  const currentApproved = currentQuote?.quoteContract?.valuationEligible === true;
  const incomingApproved = incomingQuote?.quoteContract?.valuationEligible === true;
  let selected;

  if (currentApproved !== incomingApproved) selected = incomingApproved ? incomingQuote : currentQuote;
  else if (incomingTime > currentTime + toleranceMs) selected = incomingQuote;
  else if (currentTime > incomingTime + toleranceMs) selected = currentQuote;
  else selected = quotePriority(incomingQuote) >= quotePriority(currentQuote)
    ? incomingQuote
    : currentQuote;

  const incomingChecked = checkedTimestamp(incomingQuote);
  const currentChecked = checkedTimestamp(currentQuote);
  const checkedAt = incomingChecked >= currentChecked
    ? incomingQuote.checkedAt
    : currentQuote.checkedAt;

  // The newest traded price and the freshest reference values are not always
  // from the same payload. A persisted WebSocket trade may be newer than the
  // REST quote, while the REST quote carries the correct previous close.
  const referenceQuote = incomingChecked >= currentChecked ? incomingQuote : currentQuote;
  const session = repairSession(symbol, selected);
  const previousClose = finite(referenceQuote?.nativePreviousClose)
    ? Number(referenceQuote.nativePreviousClose)
    : finite(selected?.nativePreviousClose)
      ? Number(selected.nativePreviousClose)
      : null;
  const regularMarketPrice = finite(referenceQuote?.nativeRegularMarketPrice)
    ? Number(referenceQuote.nativeRegularMarketPrice)
    : finite(selected?.nativeRegularMarketPrice)
      ? Number(selected.nativeRegularMarketPrice)
      : null;
  const changeBase = session === 'post-market' && finite(regularMarketPrice)
    ? regularMarketPrice
    : previousClose;

  return classifyQuote(symbol, {
    ...selected,
    nativePreviousClose: previousClose,
    nativeRegularMarketPrice: regularMarketPrice,
    nativeChangeBase: changeBase,
    changePct: finite(changeBase)
      ? ((Number(selected.nativePrice) - Number(changeBase)) / Number(changeBase)) * 100
      : selected.changePct,
    session,
    checkedAt: checkedAt || new Date().toISOString(),
  });
}

export function mergePortfolioQuotes(current = {}, incoming = {}) {
  const symbols = new Set([...Object.keys(current || {}), ...Object.keys(incoming || {})]);
  const merged = {};
  symbols.forEach((symbol) => {
    const quote = chooseMostRecentQuote(symbol, current?.[symbol], incoming?.[symbol]);
    if (quote) merged[symbol] = quote;
  });
  return merged;
}

async function readPersistedPrices() {
  try {
    const raw = await AsyncStorage.getItem(PERSISTED_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed?.prices && typeof parsed.prices === 'object' ? parsed.prices : {};
  } catch (_) {
    return {};
  }
}

async function readCanonicalFeedQuotes(symbols = []) {
  try {
    const raw = await AsyncStorage.getItem(INTELLIGENCE_FEED_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const registry = parsed?.quoteRegistry && typeof parsed.quoteRegistry === 'object'
      ? parsed.quoteRegistry
      : {};
    const quotes = {};
    for (const symbol of symbols) {
      const quote = quoteFromRegistry(symbol, registry[symbol], { now: Date.now() });
      if (quote) quotes[symbol] = quote;
    }
    return quotes;
  } catch (_) {
    return {};
  }
}

function applyFx(symbol, quote, fx) {
  const route = routeMobileInstrument(symbol);
  if (!route.supported) throw new Error('MARKET_ROUTE_UNVERIFIED');
  const nativeCurrency = String(quote?.nativeCurrency || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(nativeCurrency)) throw new Error('CURRENCY_NOT_VERIFIED');
  if (route.expectedCurrency !== nativeCurrency) throw new Error('QUOTE_CURRENCY_MISMATCH');
  if (nativeCurrency === 'EUR') {
    return {
      ...quote,
      price: Number(quote.nativePrice),
      previousClose: quote.nativePreviousClose == null ? null : Number(quote.nativePreviousClose),
      currency: 'EUR',
      nativeCurrency,
      fxRate: 1,
      fxUpdatedAt: null,
    };
  }
  if (nativeCurrency !== 'USD') throw new Error('UNSUPPORTED_NATIVE_CURRENCY');
  if (!finite(fx?.rate)) throw new Error('λείπει η ισοτιμία EUR/USD');
  return {
    ...quote,
    price: Number(quote.nativePrice) / Number(fx.rate),
    previousClose: quote.nativePreviousClose == null ? null : Number(quote.nativePreviousClose) / Number(fx.rate),
    currency: 'EUR',
    nativeCurrency,
    fxRate: Number(fx.rate),
    fxUpdatedAt: fx.updatedAt,
  };
}

async function fetchNativeQuote(symbol, finnhubToken) {
  const route = routeMobileInstrument(symbol);
  if (!route.supported) throw new Error(route.blocker || 'MARKET_ROUTE_UNVERIFIED');

  if (route.market === 'US') {
    if (finnhubToken) {
      const licensed = await fetchFinnhubQuote(route.baseSymbol, finnhubToken).catch(() => null);
      if (licensed) return licensed;
    }
    return await fetchYahooQuote(route.baseSymbol);
  }

  if (route.market === 'GR') {
    try {
      return await fetchOfficialAthensQuote(symbol);
    } catch (officialError) {
      const fallback = await fetchYahooQuote(`${route.baseSymbol}.AT`);
      return {
        ...fallback,
        nativeCurrency: 'EUR',
        source: fallback.source,
        userNotice: 'Η επίσημη πηγή Euronext Athens δεν ήταν διαθέσιμη. Η εφεδρική τιμή είναι μόνο πληροφοριακή.',
        providerDiagnostic: safeProviderDiagnostic(officialError, 'OFFICIAL_ATHENS_QUOTE_UNAVAILABLE'),
      };
    }
  }

  throw new Error('MARKET_ROUTE_UNVERIFIED');
}

export async function fetchPortfolioQuotes(symbols, { finnhubToken = '' } = {}) {
  const cleanSymbols = [...new Set(
    symbols.filter(Boolean).map((value) => String(value).trim().toUpperCase()),
  )];
  const needsUsd = cleanSymbols.some((symbol) => symbol.endsWith('.US'));
  const fx = needsUsd
    ? await fetchEurUsd().catch(() => null)
    : { rate: 1, updatedAt: null, source: null };
  const fetched = {};
  const errors = [];
  const canonicalFeedQuotes = await readCanonicalFeedQuotes(cleanSymbols);

  await Promise.all(cleanSymbols.map(async (symbol) => {
    try {
      const native = await fetchNativeQuote(symbol, finnhubToken);
      const withFx = applyFx(symbol, native, fx);
      const changeBase = finite(withFx.nativeChangeBase)
        ? Number(withFx.nativeChangeBase)
        : finite(withFx.nativePreviousClose)
          ? Number(withFx.nativePreviousClose)
          : null;
      fetched[symbol] = classifyQuote(symbol, {
        ...withFx,
        symbol,
        changePct: Number.isFinite(Number(withFx.nativeProviderChangePct))
          ? Number(withFx.nativeProviderChangePct)
          : finite(changeBase)
            ? ((Number(withFx.nativePrice) - changeBase) / changeBase) * 100
            : null,
      });
    } catch (error) {
      errors.push(`${symbol}: ${safeProviderDiagnostic(error)}`);
    }
  }));

  const persisted = await readPersistedPrices();
  const baseline = mergePortfolioQuotes(persisted, inMemoryQuotes);
  const canonicalBaseline = mergePortfolioQuotes(baseline, canonicalFeedQuotes);
  const newest = mergePortfolioQuotes(canonicalBaseline, fetched);
  const quotes = {};

  cleanSymbols.forEach((symbol) => {
    const selected = newest[symbol];
    if (!selected) return;
    try {
      const withFx = applyFx(symbol, selected, fx);
      quotes[symbol] = classifyQuote(symbol, {
        ...withFx,
        checkedAt: new Date().toISOString(),
      });
      inMemoryQuotes[symbol] = quotes[symbol];
    } catch (error) {
      errors.push(`${symbol}: ${safeProviderDiagnostic(error)}`);
    }
  });

  return {
    quotes,
    errors,
    checkedAt: new Date().toISOString(),
    fxRates: fx ? { EURUSD: fx } : {},
  };
}

export function quoteStatusText(quote) {
  if (!quote) return 'Χωρίς δεδομένα';
  if (quote.status === 'live') return 'Real-time';
  if (quote.status === 'near-live') return 'Near-live';
  if (quote.status === 'delayed') return 'Καθυστέρηση 15′';
  if (quote.status === 'pre-market') return 'Προσυνεδριακή';
  if (quote.status === 'post-market') return 'Μετασυνεδριακή';
  if (quote.status === 'closed') return quote?.quoteContract?.timestampVerified === false ? 'Επίσημη αναφορά · χρόνος μη επιβεβαιωμένος' : 'Τιμή κλεισίματος';
  if (quote.status === 'unverified') return 'Μη επαληθευμένη — δεν υπολογίζεται';
  return 'Παρωχημένη τιμή — δεν υπολογίζεται';
}
