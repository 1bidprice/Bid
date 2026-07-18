const EURONEXT_ALWN_URL = 'https://athens.euronext.com/en/market-data/instruments/stocks/ALWN/related';
const YAHOO_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];

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

export function exchangeState(symbol, at = new Date()) {
  const isUs = String(symbol).toUpperCase().endsWith('.US');
  const timeZone = isUs ? 'America/New_York' : 'Europe/Athens';
  const parts = zoneParts(timeZone, at);
  const weekdays = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const open = isUs
    ? weekdays.has(parts.weekday) && minutes >= 9 * 60 + 30 && minutes <= 16 * 60
    : weekdays.has(parts.weekday) && minutes >= 10 * 60 + 15 && minutes <= 17 * 60 + 25;
  return { open, timeZone, localDate: `${parts.year}-${parts.month}-${parts.day}` };
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
        'User-Agent': 'InvestorControl/0.4.1',
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
  const parts = zoneParts('America/New_York', new Date(Number(timestamp) * 1000));
  const weekdays = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  if (!weekdays.has(parts.weekday)) return 'off-hours';
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return 'pre-market';
  if (minutes >= 9 * 60 + 30 && minutes <= 16 * 60) return 'regular-market';
  if (minutes > 16 * 60 && minutes <= 20 * 60) return 'post-market';
  return 'off-hours';
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
  const payload = await fetchJson(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(token)}`);
  if (!finite(payload?.c)) throw new Error('το Finnhub δεν επέστρεψε έγκυρη τιμή');
  const timestamp = finite(payload?.t) ? Number(payload.t) : Math.floor(Date.now() / 1000);
  return {
    nativePrice: Number(payload.c),
    nativePreviousClose: finite(payload.pc) ? Number(payload.pc) : null,
    nativeChangeBase: finite(payload.pc) ? Number(payload.pc) : null,
    nativeCurrency: 'USD',
    updatedAt: new Date(timestamp * 1000).toISOString(),
    checkedAt: new Date().toISOString(),
    source: 'Finnhub real-time US quote',
    providerSymbol: ticker,
    quality: 'realtime',
    session: 'regular-market',
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
      if (latest) onTrade({ symbol: latest.s, price: Number(latest.p), timestamp: Number(latest.t) });
    } catch (_) {}
  };
  socket.onerror = () => onStatus('error');
  socket.onclose = () => onStatus('closed');
  return () => {
    try {
      clean.forEach((symbol) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'unsubscribe', symbol }));
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

function classifyQuote(symbol, quote) {
  const exchange = exchangeState(symbol);
  const ageSeconds = Math.max(0, Math.round((Date.now() - new Date(quote.updatedAt).getTime()) / 1000));
  const allowedAge = symbol === 'ALWN.GR' ? 25 * 60 : 3 * 60;
  let status;
  if (!exchange.open) {
    if (quote.session === 'pre-market') status = 'pre-market';
    else if (quote.session === 'post-market') status = 'post-market';
    else status = 'closed';
  } else if (quote.quality === 'delayed15') status = 'delayed';
  else if (ageSeconds <= allowedAge) status = quote.quality === 'realtime' ? 'live' : 'near-live';
  else status = 'stale';
  return { ...quote, ageSeconds, status, exchangeOpen: exchange.open, usable: status !== 'stale' };
}

async function fetchNativeQuote(symbol, finnhubToken) {
  if (symbol === 'ALWN.GR') {
    try {
      return await fetchOfficialAllwynQuote();
    } catch (officialError) {
      const fallback = await fetchYahooQuote('ALWN.AT');
      return { ...fallback, nativeCurrency: 'EUR', source: `${fallback.source} · Euronext error: ${officialError.message}` };
    }
  }
  if (symbol === 'SPCE.US') {
    if (finnhubToken) {
      try {
        return await fetchFinnhubQuote('SPCE', finnhubToken);
      } catch (finnhubError) {
        const fallback = await fetchYahooQuote('SPCE');
        return { ...fallback, nativeCurrency: 'USD', source: `${fallback.source} · Finnhub error: ${finnhubError.message}` };
      }
    }
    const fallback = await fetchYahooQuote('SPCE');
    return { ...fallback, nativeCurrency: 'USD' };
  }
  const ticker = symbol.endsWith('.US') ? symbol.slice(0, -3) : symbol.endsWith('.GR') ? `${symbol.slice(0, -3)}.AT` : symbol;
  return await fetchYahooQuote(ticker);
}

export async function fetchPortfolioQuotes(symbols, { finnhubToken = '' } = {}) {
  const cleanSymbols = [...new Set(symbols.filter(Boolean).map((value) => String(value).trim().toUpperCase()))];
  const needsUsd = cleanSymbols.some((symbol) => symbol.endsWith('.US'));
  const fx = needsUsd ? await fetchEurUsd().catch(() => null) : { rate: 1, updatedAt: null, source: null };
  const quotes = {};
  const errors = [];

  await Promise.all(cleanSymbols.map(async (symbol) => {
    try {
      const native = await fetchNativeQuote(symbol, finnhubToken);
      const nativeCurrency = native.nativeCurrency || (symbol.endsWith('.US') ? 'USD' : 'EUR');
      if (nativeCurrency === 'USD' && !finite(fx?.rate)) throw new Error('λείπει η ισοτιμία EUR/USD');
      const eurPrice = nativeCurrency === 'USD' ? Number(native.nativePrice) / Number(fx.rate) : Number(native.nativePrice);
      const eurPreviousClose = native.nativePreviousClose == null
        ? null
        : nativeCurrency === 'USD'
          ? Number(native.nativePreviousClose) / Number(fx.rate)
          : Number(native.nativePreviousClose);
      const changeBase = finite(native.nativeChangeBase)
        ? Number(native.nativeChangeBase)
        : finite(native.nativePreviousClose)
          ? Number(native.nativePreviousClose)
          : null;
      const changePct = finite(changeBase)
        ? ((Number(native.nativePrice) - changeBase) / changeBase) * 100
        : null;
      quotes[symbol] = classifyQuote(symbol, {
        ...native,
        symbol,
        price: eurPrice,
        previousClose: eurPreviousClose,
        currency: 'EUR',
        nativeCurrency,
        fxRate: nativeCurrency === 'USD' ? Number(fx.rate) : 1,
        fxUpdatedAt: nativeCurrency === 'USD' ? fx.updatedAt : null,
        changePct,
      });
    } catch (error) {
      errors.push(`${symbol}: ${error.message}`);
    }
  }));

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
