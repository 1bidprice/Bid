(() => {
  'use strict';

  const STORAGE_KEY = 'investor-control-state-v3';
  const SYMBOL = 'ALWN.GR';
  const VERSION = '0.5.0';
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

  function marketIsOpen() {
    const now = new Date();
    const athens = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Athens' }));
    const day = athens.getDay();
    const minutes = athens.getHours() * 60 + athens.getMinutes();
    return day >= 1 && day <= 5 && minutes >= 10 * 60 + 15 && minutes <= 17 * 60 + 25;
  }

  function latestBar(result) {
    const timestamps = result?.timestamp || [];
    const closes = result?.indicators?.quote?.[0]?.close || [];
    for (let i = Math.min(timestamps.length, closes.length) - 1; i >= 0; i -= 1) {
      if (finite(closes[i])) return { price: Number(closes[i]), timestamp: Number(timestamps[i]) };
    }
    const metaPrice = result?.meta?.regularMarketPrice;
    if (finite(metaPrice)) return { price: Number(metaPrice), timestamp: Number(result?.meta?.regularMarketTime || 0) };
    return null;
  }

  async function fetchYahoo(host) {
    const url = `https://${host}/v8/finance/chart/ALWN.AT?range=1d&interval=1m&includePrePost=false&_=${Date.now()}`;
    const response = await fetch(url, { cache: 'no-store', mode: 'cors' });
    if (!response.ok) throw new Error(`Yahoo HTTP ${response.status}`);
    const payload = await response.json();
    const result = payload?.chart?.result?.[0];
    if (!result) throw new Error('Yahoo χωρίς αποτέλεσμα');
    const bar = latestBar(result);
    if (!bar) throw new Error('Yahoo χωρίς έγκυρη τιμή');
    const meta = result.meta || {};
    const updatedAt = bar.timestamp ? new Date(bar.timestamp * 1000).toISOString() : new Date().toISOString();
    return {
      price: bar.price,
      previousClose: finite(meta.chartPreviousClose || meta.previousClose) ? Number(meta.chartPreviousClose || meta.previousClose) : null,
      updatedAt,
      checkedAt: new Date().toISOString(),
      source: 'Yahoo direct 1-minute bar (unofficial)',
      providerSymbol: 'ALWN.AT',
      marketState: meta.marketState || null,
      currency: meta.currency || 'EUR'
    };
  }

  async function fetchPublishedFeed() {
    const response = await fetch(`./market-data.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Feed HTTP ${response.status}`);
    const feed = await response.json();
    const quote = feed?.quotes?.[SYMBOL];
    if (!quote || !finite(quote.price)) throw new Error(feed?.error || 'Δεν υπάρχει έγκυρη τιμή στο feed');
    return {
      ...quote,
      checkedAt: feed.lastCheckedAt || quote.checkedAt || new Date().toISOString(),
      source: quote.source || feed.source || 'Investor Control feed'
    };
  }

  async function getQuote() {
    const errors = [];
    for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
      try { return await fetchYahoo(host); }
      catch (error) { errors.push(error.message); }
    }
    try { return await fetchPublishedFeed(); }
    catch (error) { errors.push(error.message); }
    throw new Error(errors.join(' | '));
  }

  function formatPrice(value) {
    return Number(value).toLocaleString('el-GR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }

  function formatTime(value) {
    if (!value) return '—';
    return new Date(value).toLocaleString('el-GR', {
      timeZone: 'Europe/Athens', day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }

  function quoteDelaySeconds(quote) {
    const timestamp = new Date(quote.updatedAt).getTime();
    if (!Number.isFinite(timestamp)) return null;
    return Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  }

  function updateUi(state, quote, error = null) {
    document.querySelectorAll('.details-list div').forEach(row => {
      const dt = row.querySelector('dt');
      const dd = row.querySelector('dd');
      if (dt?.textContent.trim() === 'Έκδοση' && dd) dd.textContent = VERSION;
    });

    const help = document.querySelector('#marketDataForm .form-help');
    if (help) help.textContent = 'Όσο η εφαρμογή είναι ανοιχτή, ελέγχει νέα τιμή κάθε 30 δευτερόλεπτα. Αν η άμεση πηγή δεν απαντήσει, χρησιμοποιεί το εφεδρικό feed των 5 λεπτών.';

    const select = document.getElementById('providerSelect');
    if (select) {
      const option = [...select.options].find(item => item.value === 'githubfeed');
      if (option) option.textContent = 'Near-live feed (30″ όσο είναι ανοιχτό)';
    }

    const status = document.getElementById('marketFeedStatus');
    if (status) {
      if (error) {
        status.innerHTML = `<strong>Near-live feed: Σφάλμα</strong><p>${escapeHtml(error)}<br>Διατηρείται η τελευταία έγκυρη τιμή.</p>`;
      } else if (quote) {
        const delay = quoteDelaySeconds(quote);
        const delayText = delay == null ? 'άγνωστη' : delay < 60 ? `${delay} δευτ.` : `${Math.round(delay / 60)} λεπτά`;
        status.innerHTML = `<strong>Near-live feed: Ενεργό</strong><p>ALWN: ${formatPrice(quote.price)} €<br>Χρόνος τιμής: ${formatTime(quote.updatedAt)}<br>Καθυστέρηση πηγής: ${delayText}<br>Πηγή: ${escapeHtml(quote.source || '—')}</p>`;
      }
    }

    const lastUpdated = document.getElementById('lastUpdated');
    if (lastUpdated && quote?.updatedAt) lastUpdated.textContent = formatTime(quote.updatedAt);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function notifyAlerts(state, quote) {
    const alert = state?.alerts?.[SYMBOL];
    if (!alert || !finite(quote.price)) return;
    alert.lastTriggered = alert.lastTriggered || {};
    const current = Number(quote.price);
    const previous = finite(quote.previousClose) ? Number(quote.previousClose) : null;
    const change = previous ? ((current - previous) / previous) * 100 : null;
    const now = Date.now();
    const candidates = [];
    if (finite(alert.above) && current >= Number(alert.above)) candidates.push(['above', `ALWN πάνω από ${formatPrice(alert.above)} €`]);
    if (finite(alert.below) && current <= Number(alert.below)) candidates.push(['below', `ALWN κάτω από ${formatPrice(alert.below)} €`]);
    if (finite(alert.changePct) && change != null && Math.abs(change) >= Number(alert.changePct)) candidates.push(['change', `ALWN ημερήσια μεταβολή ${change.toFixed(2)}%`]);

    let changed = false;
    for (const [key, body] of candidates) {
      const last = new Date(alert.lastTriggered[key] || 0).getTime();
      if (now - last < 6 * 60 * 60 * 1000) continue;
      alert.lastTriggered[key] = new Date().toISOString();
      changed = true;
      if ('Notification' in window && Notification.permission === 'granted') {
        navigator.serviceWorker?.ready
          .then(reg => reg.showNotification('Investor Control', { body, icon: './icon.svg', tag: `ic-${key}` }))
          .catch(() => new Notification('Investor Control', { body }));
      }
    }
    if (changed) writeState(state);
  }

  function shouldReload(oldQuote, quote) {
    if (!oldQuote || !finite(oldQuote.price)) return true;
    if (Math.abs(Number(oldQuote.price) - Number(quote.price)) < 0.0005) return false;
    if (document.querySelector('dialog[open]')) return false;
    const active = document.querySelector('.view.active')?.id;
    return document.visibilityState === 'visible' && (active === 'dashboardView' || active === 'alertsView');
  }

  async function sync() {
    if (busy || document.visibilityState === 'hidden') return;
    busy = true;
    try {
      const quote = await getQuote();
      const state = readState();
      if (!state) return;
      state.prices = state.prices || {};
      state.meta = state.meta || {};
      state.settings = state.settings || {};
      const oldQuote = state.prices[SYMBOL];
      const delaySeconds = quoteDelaySeconds(quote);
      state.prices[SYMBOL] = {
        ...quote,
        delaySeconds,
        changePct: finite(quote.previousClose) ? ((Number(quote.price) - Number(quote.previousClose)) / Number(quote.previousClose)) * 100 : null
      };
      state.meta.lastUpdated = quote.updatedAt;
      state.meta.marketFeed = {
        status: delaySeconds != null && delaySeconds > 20 * 60 ? 'stale' : 'ok',
        source: quote.source,
        lastCheckedAt: quote.checkedAt || new Date().toISOString(),
        error: null
      };
      state.settings.provider = 'githubfeed';
      writeState(state);
      notifyAlerts(state, state.prices[SYMBOL]);
      updateUi(state, state.prices[SYMBOL]);

      if (shouldReload(oldQuote, quote)) {
        const lastReload = Number(sessionStorage.getItem(RELOAD_GUARD) || 0);
        if (Date.now() - lastReload > 25 * 1000) {
          sessionStorage.setItem(RELOAD_GUARD, String(Date.now()));
          sessionStorage.setItem('ic-scroll-y', String(window.scrollY));
          location.reload();
          return;
        }
      }
    } catch (error) {
      const state = readState();
      updateUi(state, state?.prices?.[SYMBOL], error.message);
    } finally {
      busy = false;
      scheduleNext();
    }
  }

  function scheduleNext() {
    clearTimeout(timer);
    timer = setTimeout(sync, marketIsOpen() ? OPEN_POLL_MS : CLOSED_POLL_MS);
  }

  function start() {
    const savedY = Number(sessionStorage.getItem('ic-scroll-y') || 0);
    sessionStorage.removeItem('ic-scroll-y');
    if (savedY > 0) setTimeout(() => window.scrollTo(0, savedY), 80);
    setTimeout(sync, 800);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') sync();
    });
    window.addEventListener('online', sync);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
