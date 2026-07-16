(() => {
  'use strict';

  const STORAGE_KEY = 'investor-control-state-v3';
  const VERSION = '0.5.1';
  const OPEN_POLL_MS = 30 * 1000;
  const CLOSED_POLL_MS = 5 * 60 * 1000;
  const RELOAD_GUARD = 'ic-live-reload-at';
  let busy = false;
  let timer = null;

  function readState() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null; }
    catch (_) { return null; }
  }

  function writeState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function finite(value) {
    return Number.isFinite(Number(value)) && Number(value) > 0;
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean).map(value => String(value).trim().toUpperCase()))];
  }

  function portfolioSymbols(state) {
    return unique([
      ...(state?.transactions || []).map(item => item?.symbol),
      ...(state?.pendingOrders || []).map(item => item?.symbol),
      ...Object.keys(state?.alerts || {}),
      ...Object.keys(state?.prices || {}),
      'ALWN.GR'
    ]);
  }

  function providerTickers(symbol) {
    const normalized = String(symbol || '').trim().toUpperCase();
    if (normalized === 'ALWN.GR') return ['ALWN.AT', 'OPAP.AT', 'ALWN.ATH', 'OPAP.ATH'];
    if (normalized === 'OPAP.GR') return ['OPAP.AT', 'ALWN.AT'];
    if (normalized.endsWith('.US')) return [normalized.slice(0, -3)];
    if (normalized.endsWith('.NYSE')) return [normalized.slice(0, -5)];
    if (normalized.endsWith('.NASDAQ')) return [normalized.slice(0, -7)];
    if (normalized.endsWith('.GR')) return [`${normalized.slice(0, -3)}.AT`];
    return [normalized];
  }

  function localClock(timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return {
      weekday: values.weekday,
      minutes: Number(values.hour) * 60 + Number(values.minute)
    };
  }

  function exchangeIsOpen(symbol) {
    const weekdays = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
    if (String(symbol).endsWith('.US')) {
      const ny = localClock('America/New_York');
      return weekdays.has(ny.weekday) && ny.minutes >= 9 * 60 + 30 && ny.minutes <= 16 * 60 + 5;
    }
    const athens = localClock('Europe/Athens');
    return weekdays.has(athens.weekday) && athens.minutes >= 10 * 60 + 15 && athens.minutes <= 17 * 60 + 25;
  }

  function anyExchangeOpen(symbols) {
    return symbols.some(exchangeIsOpen);
  }

  function latestBar(result) {
    const timestamps = result?.timestamp || [];
    const closes = result?.indicators?.quote?.[0]?.close || [];
    for (let index = Math.min(timestamps.length, closes.length) - 1; index >= 0; index -= 1) {
      if (finite(closes[index])) return { price: Number(closes[index]), timestamp: Number(timestamps[index]) };
    }
    const metaPrice = result?.meta?.regularMarketPrice;
    if (finite(metaPrice)) return { price: Number(metaPrice), timestamp: Number(result?.meta?.regularMarketTime || 0) };
    return null;
  }

  async function fetchYahooTicker(ticker) {
    const encoded = encodeURIComponent(ticker);
    const errors = [];
    for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
      try {
        const url = `https://${host}/v8/finance/chart/${encoded}?range=1d&interval=1m&includePrePost=false&_=${Date.now()}`;
        const response = await fetch(url, { cache: 'no-store', mode: 'cors' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        const result = payload?.chart?.result?.[0];
        if (!result) throw new Error('χωρίς αποτέλεσμα');
        const bar = latestBar(result);
        if (!bar) throw new Error('χωρίς έγκυρη τιμή');
        const meta = result.meta || {};
        return {
          price: bar.price,
          previousClose: finite(meta.chartPreviousClose || meta.previousClose) ? Number(meta.chartPreviousClose || meta.previousClose) : null,
          updatedAt: bar.timestamp ? new Date(bar.timestamp * 1000).toISOString() : new Date().toISOString(),
          checkedAt: new Date().toISOString(),
          source: 'Yahoo direct latest 1-minute bar (unofficial)',
          providerSymbol: ticker,
          marketState: meta.marketState || null,
          currency: meta.currency || null
        };
      } catch (error) {
        errors.push(`${host}: ${error.message}`);
      }
    }
    throw new Error(errors.join(' | '));
  }

  async function fetchPublishedFeed() {
    const response = await fetch(`./market-data.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Feed HTTP ${response.status}`);
    const feed = await response.json();
    if (!feed || typeof feed !== 'object') throw new Error('Μη έγκυρο feed');
    return feed;
  }

  async function firstDirectQuote(symbol) {
    const errors = [];
    for (const ticker of providerTickers(symbol)) {
      try { return await fetchYahooTicker(ticker); }
      catch (error) { errors.push(`${ticker}: ${error.message}`); }
    }
    throw new Error(errors.join(' | '));
  }

  async function getEurUsd(feed) {
    try {
      const quote = await fetchYahooTicker('EURUSD=X');
      if (finite(quote.price)) return { rate: Number(quote.price), source: quote.source, updatedAt: quote.updatedAt };
    } catch (_) {}
    const fallback = feed?.fxRates?.EURUSD;
    if (finite(fallback?.rate)) return { rate: Number(fallback.rate), source: fallback.source || feed.source, updatedAt: fallback.updatedAt };
    return null;
  }

  function normalizeToEuro(symbol, quote, fx) {
    const nativeCurrency = String(quote.currency || '').toUpperCase() || (String(symbol).endsWith('.US') ? 'USD' : 'EUR');
    const nativePrice = Number(quote.price);
    const nativePreviousClose = finite(quote.previousClose) ? Number(quote.previousClose) : null;

    if (nativeCurrency === 'EUR') {
      return {
        ...quote,
        price: nativePrice,
        previousClose: nativePreviousClose,
        nativePrice,
        nativePreviousClose,
        nativeCurrency: 'EUR',
        currency: 'EUR',
        fxRate: 1
      };
    }

    if (nativeCurrency === 'USD' && finite(fx?.rate)) {
      return {
        ...quote,
        price: nativePrice / Number(fx.rate),
        previousClose: nativePreviousClose ? nativePreviousClose / Number(fx.rate) : null,
        nativePrice,
        nativePreviousClose,
        nativeCurrency: 'USD',
        currency: 'EUR',
        fxRate: Number(fx.rate),
        fxUpdatedAt: fx.updatedAt || null,
        source: `${quote.source} · USD→EUR`
      };
    }

    throw new Error(`${symbol}: δεν υπάρχει ασφαλής μετατροπή ${nativeCurrency}→EUR`);
  }

  async function getPortfolioQuotes(state) {
    const symbols = portfolioSymbols(state);
    const feed = await fetchPublishedFeed().catch(() => ({ quotes: {}, fxRates: {} }));
    const fx = await getEurUsd(feed);
    const results = {};
    const errors = [];

    await Promise.all(symbols.map(async symbol => {
      try {
        const direct = await firstDirectQuote(symbol);
        results[symbol] = normalizeToEuro(symbol, direct, fx);
        return;
      } catch (directError) {
        const fallback = feed?.quotes?.[symbol];
        if (fallback && finite(fallback.price)) {
          results[symbol] = {
            ...fallback,
            checkedAt: feed.lastCheckedAt || fallback.checkedAt || new Date().toISOString(),
            source: fallback.source || feed.source || 'Investor Control feed',
            currency: 'EUR'
          };
          errors.push(`${symbol}: άμεση πηγή απέτυχε, χρησιμοποιήθηκε εφεδρικό feed`);
        } else {
          errors.push(`${symbol}: ${directError.message}`);
        }
      }
    }));

    return { symbols, quotes: results, errors, feed };
  }

  function formatPrice(value) {
    return Number(value).toLocaleString('el-GR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }

  function formatTime(value) {
    if (!value) return '—';
    return new Date(value).toLocaleString('el-GR', {
      timeZone: 'Europe/Athens',
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }

  function quoteDelaySeconds(quote) {
    const timestamp = new Date(quote?.updatedAt).getTime();
    if (!Number.isFinite(timestamp)) return null;
    return Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[character]));
  }

  function updateUi(state, errors = []) {
    document.querySelectorAll('.details-list div').forEach(row => {
      const dt = row.querySelector('dt');
      const dd = row.querySelector('dd');
      if (dt?.textContent.trim() === 'Έκδοση' && dd) dd.textContent = VERSION;
    });

    const help = document.querySelector('#marketDataForm .form-help');
    if (help) help.textContent = 'Οι μετοχές του χαρτοφυλακίου ελέγχονται αυτόματα κάθε 30 δευτερόλεπτα όσο η αντίστοιχη αγορά είναι ανοιχτή. Οι τιμές ξένου νομίσματος μετατρέπονται σε ευρώ.';

    const select = document.getElementById('providerSelect');
    if (select) {
      const option = [...select.options].find(item => item.value === 'githubfeed');
      if (option) option.textContent = 'Αυτόματο πολυ-αγοραστικό feed';
    }

    const status = document.getElementById('marketFeedStatus');
    if (status) {
      const symbols = portfolioSymbols(state);
      const rows = symbols.map(symbol => {
        const quote = state?.prices?.[symbol];
        if (!quote || !finite(quote.price)) return `${escapeHtml(symbol)}: —`;
        const delay = quoteDelaySeconds(quote);
        const delayText = delay == null ? 'άγνωστη καθυστέρηση' : delay < 60 ? `${delay}″` : `${Math.round(delay / 60)}′`;
        const native = quote.nativeCurrency === 'USD' && finite(quote.nativePrice)
          ? ` (${Number(quote.nativePrice).toFixed(2)} USD)`
          : '';
        return `${escapeHtml(symbol)}: ${formatPrice(quote.price)} €${native} · ${delayText}`;
      });
      const warning = errors.length ? `<br><small>Προειδοποίηση: ${escapeHtml(errors.join(' | '))}</small>` : '';
      status.innerHTML = `<strong>Αυτόματο feed: Ενεργό</strong><p>${rows.join('<br>')}${warning}</p>`;
    }

    const latestTimes = Object.values(state?.prices || {})
      .map(quote => new Date(quote?.updatedAt || 0).getTime())
      .filter(Number.isFinite);
    const latest = latestTimes.length ? new Date(Math.max(...latestTimes)).toISOString() : null;
    const lastUpdated = document.getElementById('lastUpdated');
    if (lastUpdated && latest) lastUpdated.textContent = formatTime(latest);
  }

  function notifyAlerts(state, symbol, quote) {
    const alert = state?.alerts?.[symbol];
    if (!alert || !finite(quote?.price)) return;
    alert.lastTriggered = alert.lastTriggered || {};
    const current = Number(quote.price);
    const previous = finite(quote.previousClose) ? Number(quote.previousClose) : null;
    const change = previous ? ((current - previous) / previous) * 100 : null;
    const candidates = [];

    if (finite(alert.above) && current >= Number(alert.above)) candidates.push(['above', `${symbol} πάνω από ${formatPrice(alert.above)} €`]);
    if (finite(alert.below) && current <= Number(alert.below)) candidates.push(['below', `${symbol} κάτω από ${formatPrice(alert.below)} €`]);
    if (finite(alert.changePct) && change != null && Math.abs(change) >= Number(alert.changePct)) candidates.push(['change', `${symbol} ημερήσια μεταβολή ${change.toFixed(2)}%`]);

    let changed = false;
    for (const [key, body] of candidates) {
      const last = new Date(alert.lastTriggered[key] || 0).getTime();
      if (Date.now() - last < 6 * 60 * 60 * 1000) continue;
      alert.lastTriggered[key] = new Date().toISOString();
      changed = true;
      if ('Notification' in window && Notification.permission === 'granted') {
        navigator.serviceWorker?.ready
          .then(registration => registration.showNotification('Investor Control', { body, icon: './icon.svg', tag: `ic-${symbol}-${key}` }))
          .catch(() => new Notification('Investor Control', { body }));
      }
    }
    if (changed) writeState(state);
  }

  function priceChanged(oldQuote, newQuote) {
    if (!oldQuote || !finite(oldQuote.price)) return true;
    return Math.abs(Number(oldQuote.price) - Number(newQuote.price)) >= 0.0005;
  }

  function shouldReload(changes) {
    if (!changes.length || document.querySelector('dialog[open]') || document.visibilityState !== 'visible') return false;
    if (changes.some(change => change.wasMissing)) return true;
    const active = document.querySelector('.view.active')?.id;
    return active === 'dashboardView' || active === 'alertsView';
  }

  async function sync({ force = false } = {}) {
    if (busy || (!force && document.visibilityState === 'hidden')) return;
    busy = true;
    try {
      const state = readState();
      if (!state) return;
      const result = await getPortfolioQuotes(state);
      state.prices = state.prices || {};
      state.meta = state.meta || {};
      state.settings = state.settings || {};
      state.settings.symbols = state.settings.symbols || {};
      const changes = [];

      for (const [symbol, rawQuote] of Object.entries(result.quotes)) {
        const delaySeconds = quoteDelaySeconds(rawQuote);
        const normalized = {
          ...rawQuote,
          delaySeconds,
          changePct: finite(rawQuote.previousClose)
            ? ((Number(rawQuote.price) - Number(rawQuote.previousClose)) / Number(rawQuote.previousClose)) * 100
            : null
        };
        const oldQuote = state.prices[symbol];
        if (priceChanged(oldQuote, normalized)) {
          changes.push({ symbol, wasMissing: !oldQuote || !finite(oldQuote.price) });
        }
        state.prices[symbol] = normalized;
        state.settings.symbols[symbol] = normalized.providerSymbol || providerTickers(symbol)[0];
        notifyAlerts(state, symbol, normalized);
      }

      const latestTimes = Object.values(state.prices)
        .map(quote => new Date(quote?.updatedAt || 0).getTime())
        .filter(Number.isFinite);
      if (latestTimes.length) state.meta.lastUpdated = new Date(Math.max(...latestTimes)).toISOString();
      state.meta.marketFeed = {
        status: result.errors.length && !Object.keys(result.quotes).length ? 'error' : result.errors.length ? 'stale' : 'ok',
        source: 'Investor Control multi-market feed',
        lastCheckedAt: new Date().toISOString(),
        error: result.errors.length ? result.errors.join(' | ') : null,
        symbols: result.symbols
      };
      state.settings.provider = 'githubfeed';
      state.settings.autoRefreshMinutes = 0.5;
      writeState(state);
      updateUi(state, result.errors);

      if (shouldReload(changes)) {
        const lastReload = Number(sessionStorage.getItem(RELOAD_GUARD) || 0);
        if (Date.now() - lastReload > 55 * 1000) {
          sessionStorage.setItem(RELOAD_GUARD, String(Date.now()));
          sessionStorage.setItem('ic-scroll-y', String(window.scrollY));
          location.reload();
          return;
        }
      }
    } catch (error) {
      const state = readState();
      if (state) {
        state.meta = state.meta || {};
        state.meta.marketFeed = {
          status: 'error',
          source: 'Investor Control multi-market feed',
          lastCheckedAt: new Date().toISOString(),
          error: error.message
        };
        writeState(state);
        updateUi(state, [error.message]);
      }
    } finally {
      busy = false;
      scheduleNext();
    }
  }

  function scheduleNext() {
    clearTimeout(timer);
    const state = readState();
    const symbols = portfolioSymbols(state);
    timer = setTimeout(() => sync(), anyExchangeOpen(symbols) ? OPEN_POLL_MS : CLOSED_POLL_MS);
  }

  function rebindRefreshButton() {
    const oldButton = document.getElementById('refreshPricesButton');
    if (!oldButton || oldButton.dataset.multiMarketBound === '1') return;
    const button = oldButton.cloneNode(true);
    button.dataset.multiMarketBound = '1';
    oldButton.replaceWith(button);
    button.addEventListener('click', async event => {
      event.preventDefault();
      const original = button.textContent;
      button.disabled = true;
      button.textContent = 'Ενημέρωση…';
      await sync({ force: true });
      button.disabled = false;
      button.textContent = original || 'Ανανέωση τιμών';
    });
  }

  function start() {
    const savedY = Number(sessionStorage.getItem('ic-scroll-y') || 0);
    sessionStorage.removeItem('ic-scroll-y');
    if (savedY > 0) setTimeout(() => window.scrollTo(0, savedY), 80);
    setTimeout(() => {
      rebindRefreshButton();
      sync({ force: true });
    }, 900);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') sync({ force: true });
    });
    window.addEventListener('online', () => sync({ force: true }));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
