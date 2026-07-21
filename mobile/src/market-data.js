import AsyncStorage from '@react-native-async-storage/async-storage';

const EURONEXT_ALWN_URL = 'https://athens.euronext.com/en/market-data/instruments/stocks/ALWN/related';
const YAHOO_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const PERSISTED_STATE_KEY = 'investor-control-mobile-state-v2';
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

function zoneParts(timeZone, at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(at);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function marketSessionAt(symbol, at = new Date()) {
  const isUs = String(symbol).toUpperCase().endsWith('.US');
  const timeZone = isUs ? 'America/New_York' : 'Europe/Athens';
  const parts = zoneParts(timeZone, at);
  const weekdays = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  if (!weekdays.has(parts.weekday)) return 'closed';

  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  if (isUs) {
    if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return 'pre-market';
    if (minutes >= 9 * 60 + 30 && minutes <= 16 * 60) return 'regular-market';
    if (minutes > 16 * 60 && minutes <= 20 * 60) return 'post-market';
    return 'closed';
  }

  return minutes >= 10 * 60 + 15 && minutes <= 17 * 60 + 25
    ? 'regular-market'
    : 'closed';
}

export function exchangeState(symbol, at = new Date()) {
  const isUs = String(symbol).toUpperCase().endsWith('.US');
  const timeZone = isUs ? 'America/New_York' : 'Europe/Athens';
  const parts = zoneParts(timeZone, at);
  const session = marketSessionAt(symbol, at);
  return {
    open: session === 'regular-market',
    timeZone,
    localDate: `${parts.year}-${parts.month}-${parts.day}`,
    session,
  };
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
        'User-Agent': 'InvestorControl/0.6.2',
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
      const previousClose = finite(meta.chartPreviousClose || meta.previousClose)
        ? Number(meta.chartPreviousClose || meta.previousClose)
        : null;
      const regularMarketPrice = finite(meta.regularMarketPrice)
        ? Number(meta.regularMarketPrice)
        : null;
      const changeBase = ['pre-market', 'post-market'].includes(point.session) && finite(regularMarketPrice)
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
  const timestamp = finite(payload?.t) ? Number(payload.t) : Math.floor(Date.now() / 1000);
  return {
    nativePrice: Number(payload.c),
    nativePreviousClose: finite(payload.pc) ? Number(payload.pc) : null,
    nativeChangeBase: finite(payload.pc) ? Number(payload.pc) : null,
    nativeRegularMarketPrice: Number(payload.c),
    nativeCurrency: 'USD',
    updatedAt: new Date(timestamp * 1000).toISOString(),
    checkedAt: new Date().toISOString(),
    source: 'Finnhub US quote',
    providerSymbol: ticker,
    quality: 'realtime',
    session: marketSessionAt(`${ticker}.US`, new Date(timestamp * 1000)),
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
      const previousClose = Number(current?.nativePreviousClose || 0);
      const fxRate = Number(current?.fxRate || 0);
      const session = marketSessionAt(appSymbol, new Date(timestamp));
      inMemoryQuotes[appSymbol] = classifyQuote(appSymbol, {
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
        changePct: previousClose > 0
          ? ((Number(latest.p) - previousClose) / previousClose) * 100
          : current?.changePct,
      });
      onTrade({ symbol: providerSymbol, price: Number(latest.p), timestamp });
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

async function fetchOfficialAllwynQuote() {
  const html = await fetchText(EURONEXT_ALWN_URL);
  const text = htmlToText(html);
  const priceValue = numberAfterLabel(text, ['Last Traded Price', 'Τελευταία Τιμή Διαπραγμάτευσης']);
  const previousClose = numberAfterLabel(text, ['Previous Close', 'Προηγούμενο Κλείσιμο']);
  if (!finite(priceValue)) throw new Error('η Euronext Athens δεν επέστρεψε τιμή ALWN');
  return {
    nativePrice: priceValue,
    nativePreviousClose: finite(previousClose) ? previousClose : null,
    nativeChangeBase: finite(previousClose) ? previousClose : null,
    nativeRegularMarketPrice: priceValue,
    nativeCurrency: 'EUR',
    updatedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    checkedAt: new Date().toISOString(),
    source: 'Euronext Athens — επίσημα δεδομένα με καθυστέρηση 15′',
    providerSymbol: 'ALWN',
    quality: 'delayed15',
    advertisedDelayMinutes: 15,
    session: 'regular-market',
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
  if (!quote || !finite(quote.nativePrice) || !quote.updatedAt) return quote;
  const exchange = exchangeState(symbol);
  const updatedMs = new Date(quote.updatedAt).getTime();
  const ageSeconds = Number.isFinite(updatedMs)
    ? Math.max(0, Math.round((Date.now() - updatedMs) / 1000))
    : Number.POSITIVE_INFINITY;
  const allowedAge = symbol === 'ALWN.GR' ? 25 * 60 : 3 * 60;
  let status;

  if (!exchange.open) {
    if (quote.session === 'pre-market') status = 'pre-market';
    else if (quote.session === 'post-market') status = 'post-market';
    else status = 'closed';
  } else if (quote.quality === 'delayed15') status = 'delayed';
  else if (ageSeconds <= allowedAge) status = quote.quality === 'realtime' ? 'live' : 'near-live';
  else status = 'stale';

  return {
    ...quote,
    ageSeconds,
    status,
    exchangeOpen: exchange.open,
    usable: status !== 'stale',
  };
}

function quoteTimestamp(quote) {
  const value = new Date(quote?.updatedAt || 0).getTime();
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
  let selected;

  if (incomingTime > currentTime + toleranceMs) selected = incomingQuote;
  else if (currentTime > incomingTime + toleranceMs) selected = currentQuote;
  else selected = quotePriority(incomingQuote) >= quotePriority(currentQuote)
    ? incomingQuote
    : currentQuote;

  const checkedAt = checkedTimestamp(incomingQuote) >= checkedTimestamp(currentQuote)
    ? incomingQuote.checkedAt
    : currentQuote.checkedAt;

  return classifyQuote(symbol, {
    ...selected,
    session: repairSession(symbol, selected),
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

function applyFx(symbol, quote, fx) {
  const nativeCurrency = quote?.nativeCurrency || (symbol.endsWith('.US') ? 'USD' : 'EUR');
  if (nativeCurrency !== 'USD') {
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
  if (!finite(fx?.rate)) throw new Error('λείπει η ισοτιμία EUR/USD');
  return {
    ...quote,
    price: Number(quote.nativePrice) / Number(fx.rate),
    previousClose: quote.nativePreviousClose == null
      ? null
      : Number(quote.nativePreviousClose) / Number(fx.rate),
    currency: 'EUR',
    nativeCurrency,
    fxRate: Number(fx.rate),
    fxUpdatedAt: fx.updatedAt,
  };
}

async function fetchNativeQuote(symbol, finnhubToken) {
  if (symbol === 'ALWN.GR') {
    try {
      return await fetchOfficialAllwynQuote();
    } catch (officialError) {
      const fallback = await fetchYahooQuote('ALWN.AT');
      return {
        ...fallback,
        nativeCurrency: 'EUR',
        source: `${fallback.source} · Euronext error: ${officialError.message}`,
      };
    }
  }

  if (symbol === 'SPCE.US') {
    const providers = [];
    if (finnhubToken) providers.push(fetchFinnhubQuote('SPCE', finnhubToken).catch(() => null));
    providers.push(fetchYahooQuote('SPCE').catch(() => null));
    const results = (await Promise.all(providers)).filter(Boolean);
    if (!results.length) throw new Error('καμία πηγή δεν επέστρεψε έγκυρη τιμή SPCE');
    return results.reduce((best, candidate) => {
      if (!best) return candidate;
      const bestTime = quoteTimestamp(best);
      const candidateTime = quoteTimestamp(candidate);
      if (candidateTime > bestTime + 1000) return candidate;
      if (bestTime > candidateTime + 1000) return best;
      return quotePriority(candidate) >= quotePriority(best) ? candidate : best;
    }, null);
  }

  const ticker = symbol.endsWith('.US')
    ? symbol.slice(0, -3)
    : symbol.endsWith('.GR')
      ? `${symbol.slice(0, -3)}.AT`
      : symbol;
  return await fetchYahooQuote(ticker);
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
        changePct: finite(changeBase)
          ? ((Number(withFx.nativePrice) - changeBase) / changeBase) * 100
          : null,
      });
    } catch (error) {
      errors.push(`${symbol}: ${error.message}`);
    }
  }));

  const persisted = await readPersistedPrices();
  const baseline = mergePortfolioQuotes(persisted, inMemoryQuotes);
  const newest = mergePortfolioQuotes(baseline, fetched);
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
      errors.push(`${symbol}: ${error.message}`);
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
  if (quote.status === 'closed') return 'Τιμή κλεισίματος';
  return 'Παρωχημένη τιμή — δεν υπολογίζεται';
}
