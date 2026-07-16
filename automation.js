(() => {
  'use strict';

  const STORAGE_KEY = 'investor-control-state-v3';
  const FEED_URL = './market-data.json';
  const APP_VERSION = '0.4.0';
  const AUTO_MINUTES = 15;
  let syncing = false;
  let toastTimer = null;

  const ready = (fn) => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(fn, 0), { once: true });
    } else {
      setTimeout(fn, 0);
    }
  };

  ready(initAutomation);

  function loadState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null;
    } catch (error) {
      console.error('Investor Control automation: state read failed', error);
      return null;
    }
  }

  function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function initAutomation() {
    const state = loadState();
    if (!state) return;

    state.settings = state.settings || {};
    if (!state.settings.automationMigrated) {
      if (!state.settings.provider || state.settings.provider === 'manual') {
        state.settings.provider = 'githubfeed';
      }
      state.settings.automationMigrated = true;
    }
    state.settings.feedUrl = FEED_URL;
    state.settings.autoRefreshMinutes = AUTO_MINUTES;
    saveState(state);

    upgradeSettingsUI(state);
    bindAutomaticRefresh();
    bindSettingsEnhancements();
    updateVersionLabel();

    if (state.settings.provider === 'githubfeed') {
      syncFeed({ silent: true });
    }

    window.setInterval(() => {
      const current = loadState();
      if (current?.settings?.provider === 'githubfeed' && document.visibilityState === 'visible') {
        syncFeed({ silent: true });
      }
    }, AUTO_MINUTES * 60 * 1000);

    document.addEventListener('visibilitychange', () => {
      const current = loadState();
      if (document.visibilityState === 'visible' && current?.settings?.provider === 'githubfeed') {
        syncFeed({ silent: true });
      }
    });

    window.addEventListener('online', () => {
      const current = loadState();
      if (current?.settings?.provider === 'githubfeed') syncFeed({ silent: true });
    });
  }

  function upgradeSettingsUI(state) {
    const select = document.getElementById('providerSelect');
    if (!select) return;

    if (![...select.options].some(option => option.value === 'githubfeed')) {
      const option = document.createElement('option');
      option.value = 'githubfeed';
      option.textContent = 'Αυτόματο feed (χωρίς API key)';
      select.insertBefore(option, select.firstChild);
    }

    select.value = state.settings.provider || 'githubfeed';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    const form = document.getElementById('marketDataForm');
    const help = form?.querySelector('.form-help');
    if (help) {
      help.textContent = 'Το αυτόματο feed ενημερώνεται στο παρασκήνιο και η εφαρμογή το ελέγχει όταν ανοίγει και ανά 15 λεπτά όσο παραμένει ανοιχτή. Το Twelve Data απαιτεί δικό σου API key.';
    }

    if (form && !document.getElementById('marketFeedStatus')) {
      const status = document.createElement('div');
      status.id = 'marketFeedStatus';
      status.className = 'info-card';
      status.style.marginTop = '14px';
      form.appendChild(status);
    }
    renderFeedStatus(state);
  }

  function bindAutomaticRefresh() {
    const button = document.getElementById('refreshPricesButton');
    if (!button) return;

    button.addEventListener('click', event => {
      const state = loadState();
      if (state?.settings?.provider !== 'githubfeed') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      syncFeed({ silent: false });
    }, true);
  }

  function bindSettingsEnhancements() {
    const form = document.getElementById('marketDataForm');
    const select = document.getElementById('providerSelect');
    if (!form || !select) return;

    form.addEventListener('submit', () => {
      setTimeout(() => {
        const state = loadState();
        if (!state) return;
        state.settings.feedUrl = FEED_URL;
        state.settings.autoRefreshMinutes = AUTO_MINUTES;
        saveState(state);
        renderFeedStatus(state);
        if (state.settings.provider === 'githubfeed') syncFeed({ silent: false });
      }, 80);
    }, true);

    select.addEventListener('change', () => {
      setTimeout(() => {
        const state = loadState();
        if (state) renderFeedStatus(state);
      }, 0);
    });
  }

  function updateVersionLabel() {
    document.querySelectorAll('.details-list div').forEach(row => {
      const dt = row.querySelector('dt');
      const dd = row.querySelector('dd');
      if (dt?.textContent.trim() === 'Έκδοση' && dd) dd.textContent = APP_VERSION;
    });
  }

  async function syncFeed({ silent = false } = {}) {
    if (syncing) return;
    syncing = true;

    const button = document.getElementById('refreshPricesButton');
    const originalText = button?.textContent;
    if (button) {
      button.disabled = true;
      button.textContent = 'Ενημέρωση…';
    }

    try {
      const response = await fetch(`${FEED_URL}?t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const feed = await response.json();
      if (!feed || typeof feed !== 'object') throw new Error('Μη έγκυρη απάντηση feed');

      const state = loadState();
      if (!state) throw new Error('Δεν βρέθηκαν τα τοπικά δεδομένα');
      if (state.settings?.provider !== 'githubfeed') return;

      state.prices = state.prices || {};
      state.meta = state.meta || {};
      const quote = feed.quotes?.['ALWN.GR'];
      const oldQuote = state.prices['ALWN.GR'];
      let priceChanged = false;

      if (quote && Number(quote.price) > 0) {
        const normalized = {
          price: Number(quote.price),
          previousClose: Number(quote.previousClose) > 0 ? Number(quote.previousClose) : null,
          updatedAt: quote.updatedAt || feed.generatedAt || new Date().toISOString(),
          source: quote.source || feed.source || 'Investor Control Auto Feed',
          providerSymbol: quote.providerSymbol || null,
          marketState: quote.marketState || null
        };
        priceChanged = !oldQuote || Number(oldQuote.price) !== normalized.price || Number(oldQuote.previousClose || 0) !== Number(normalized.previousClose || 0);
        state.prices['ALWN.GR'] = normalized;
        state.meta.lastUpdated = normalized.updatedAt;
      }

      state.meta.marketFeed = {
        status: feed.status || (quote ? 'ok' : 'error'),
        source: feed.source || 'Investor Control Auto Feed',
        lastCheckedAt: feed.lastCheckedAt || feed.generatedAt || new Date().toISOString(),
        error: feed.error || null
      };

      saveState(state);
      checkAlerts(state);
      renderFeedStatus(state);
      updateLastUpdated(state);

      if (priceChanged) {
        sessionStorage.setItem('ic-last-auto-sync', String(Date.now()));
        location.reload();
        return;
      }

      if (!silent) {
        if (feed.error) showToast(`Το feed κράτησε την τελευταία διαθέσιμη τιμή: ${feed.error}`);
        else if (quote) showToast('Η τιμή ενημερώθηκε αυτόματα.');
        else showToast('Δεν υπάρχει ακόμη διαθέσιμη αυτόματη τιμή.');
      }
    } catch (error) {
      console.error('Investor Control automation sync failed', error);
      const state = loadState();
      if (state) {
        state.meta = state.meta || {};
        state.meta.marketFeed = {
          status: 'error',
          source: 'Investor Control Auto Feed',
          lastCheckedAt: new Date().toISOString(),
          error: error.message
        };
        saveState(state);
        renderFeedStatus(state);
      }
      if (!silent) showToast(`Αποτυχία αυτόματης ενημέρωσης: ${error.message}`);
    } finally {
      syncing = false;
      if (button) {
        button.disabled = false;
        button.textContent = originalText || 'Ανανέωση τιμών';
      }
    }
  }

  function renderFeedStatus(state) {
    const element = document.getElementById('marketFeedStatus');
    if (!element) return;
    const provider = state?.settings?.provider || 'manual';
    if (provider !== 'githubfeed') {
      element.innerHTML = '<strong>Αυτόματο feed ανενεργό</strong><p>Χρησιμοποιείται ο πάροχος που επέλεξες.</p>';
      return;
    }

    const meta = state.meta?.marketFeed || {};
    const quote = state.prices?.['ALWN.GR'];
    const statusLabel = meta.status === 'ok' ? 'Ενεργό' : meta.status === 'stale' ? 'Προσωρινά παλιά τιμή' : meta.status === 'error' ? 'Σφάλμα' : 'Αναμονή πρώτης ενημέρωσης';
    const checked = meta.lastCheckedAt ? formatDateTime(meta.lastCheckedAt) : '—';
    const price = quote?.price ? `${Number(quote.price).toLocaleString('el-GR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} €` : '—';
    element.innerHTML = `<strong>Αυτόματο feed: ${escapeHtml(statusLabel)}</strong><p>ALWN: ${escapeHtml(price)}<br>Τελευταίος έλεγχος: ${escapeHtml(checked)}${meta.error ? `<br>Προειδοποίηση: ${escapeHtml(meta.error)}` : ''}</p>`;
  }

  function updateLastUpdated(state) {
    const element = document.getElementById('lastUpdated');
    if (element && state.meta?.lastUpdated) element.textContent = formatDateTime(state.meta.lastUpdated);
  }

  function checkAlerts(state) {
    const alerts = state.alerts || {};
    const quote = state.prices?.['ALWN.GR'];
    if (!quote?.price) return;
    const alert = alerts['ALWN.GR'];
    if (!alert) return;

    const current = Number(quote.price);
    const previous = Number(quote.previousClose || 0);
    const change = previous > 0 ? ((current - previous) / previous) * 100 : null;
    const candidates = [];

    if (alert.above != null && current >= Number(alert.above)) {
      candidates.push({ key: 'above', title: 'ALWN.GR πάνω από το όριο', body: `Τιμή ${current.toFixed(3)} €` });
    }
    if (alert.below != null && current <= Number(alert.below)) {
      candidates.push({ key: 'below', title: 'ALWN.GR κάτω από το όριο', body: `Τιμή ${current.toFixed(3)} €` });
    }
    if (alert.changePct != null && change != null && Math.abs(change) >= Number(alert.changePct)) {
      candidates.push({ key: 'change', title: 'ALWN.GR σημαντική ημερήσια μεταβολή', body: `${change >= 0 ? '+' : ''}${change.toFixed(2)}% · ${current.toFixed(3)} €` });
    }

    alert.lastTriggered = alert.lastTriggered || {};
    let changed = false;
    for (const candidate of candidates) {
      const last = alert.lastTriggered[candidate.key];
      if (last && Date.now() - new Date(last).getTime() < 6 * 60 * 60 * 1000) continue;
      alert.lastTriggered[candidate.key] = new Date().toISOString();
      changed = true;
      notify(candidate.title, candidate.body);
    }
    if (changed) saveState(state);
  }

  function notify(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
      if (navigator.serviceWorker) {
        navigator.serviceWorker.ready.then(registration => registration.showNotification(title, {
          body,
          icon: './icon.svg',
          badge: './icon.svg',
          tag: title
        })).catch(() => new Notification(title, { body }));
      } else {
        new Notification(title, { body });
      }
    }
    showToast(`${title}: ${body}`);
  }

  function showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 4200);
  }

  function formatDateTime(value) {
    try {
      return new Intl.DateTimeFormat('el-GR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
    } catch {
      return String(value || '—');
    }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  }
})();
