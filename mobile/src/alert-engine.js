import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

export const ALERT_CHANNEL_ID = 'price-alerts';
export const DEFAULT_ALERTS = {
  backgroundEnabled: false,
  rules: [],
  runtime: {},
  history: [],
  lastBackgroundCheckAt: null,
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const finitePositive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;

export function normalizeAlerts(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    backgroundEnabled: source.backgroundEnabled === true,
    rules: Array.isArray(source.rules)
      ? source.rules
        .filter((rule) => rule && typeof rule === 'object' && rule.symbol)
        .map((rule) => ({
          symbol: String(rule.symbol).trim().toUpperCase(),
          enabled: rule.enabled !== false,
          above: finitePositive(rule.above) ? Number(rule.above) : null,
          below: finitePositive(rule.below) ? Number(rule.below) : null,
          dailyPct: finitePositive(rule.dailyPct) ? Number(rule.dailyPct) : null,
        }))
      : [],
    runtime: source.runtime && typeof source.runtime === 'object' ? source.runtime : {},
    history: Array.isArray(source.history) ? source.history.slice(0, 100) : [],
    lastBackgroundCheckAt: source.lastBackgroundCheckAt || null,
  };
}

export function getRule(alerts, symbol) {
  const normalized = normalizeAlerts(alerts);
  return normalized.rules.find((rule) => rule.symbol === String(symbol).toUpperCase()) || {
    symbol: String(symbol).toUpperCase(),
    enabled: true,
    above: null,
    below: null,
    dailyPct: 5,
  };
}

export function upsertRule(alerts, rule) {
  const normalized = normalizeAlerts(alerts);
  const clean = {
    symbol: String(rule.symbol || '').trim().toUpperCase(),
    enabled: rule.enabled !== false,
    above: finitePositive(rule.above) ? Number(rule.above) : null,
    below: finitePositive(rule.below) ? Number(rule.below) : null,
    dailyPct: finitePositive(rule.dailyPct) ? Number(rule.dailyPct) : null,
  };
  return {
    ...normalized,
    rules: [
      ...normalized.rules.filter((item) => item.symbol !== clean.symbol),
      clean,
    ].sort((a, b) => a.symbol.localeCompare(b.symbol)),
  };
}

function eventFor(symbol, kind, quote, threshold, message) {
  return {
    id: `${symbol}-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    symbol,
    kind,
    nativePrice: Number(quote.nativePrice),
    nativeCurrency: quote.nativeCurrency || (symbol.endsWith('.US') ? 'USD' : 'EUR'),
    changePct: Number.isFinite(Number(quote.changePct)) ? Number(quote.changePct) : null,
    threshold,
    message,
    triggeredAt: new Date().toISOString(),
  };
}

export function evaluateAlerts(alertsInput, quotes, options = {}) {
  const alerts = normalizeAlerts(alertsInput);
  const runtime = { ...alerts.runtime };
  const events = [];
  const background = options.background === true;

  for (const rule of alerts.rules) {
    if (!rule.enabled) continue;
    const quote = quotes?.[rule.symbol];
    if (!quote?.usable || !finitePositive(quote.nativePrice)) continue;

    const price = Number(quote.nativePrice);
    const currency = quote.nativeCurrency || (rule.symbol.endsWith('.US') ? 'USD' : 'EUR');
    const priceLabel = new Intl.NumberFormat('el-GR', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 3,
    }).format(price);

    if (finitePositive(rule.above)) {
      const key = `${rule.symbol}:above`;
      const active = price >= Number(rule.above);
      const wasActive = runtime[key]?.active === true;
      if (active && !wasActive) {
        events.push(eventFor(
          rule.symbol,
          'above',
          quote,
          Number(rule.above),
          `${rule.symbol} ανέβηκε στα ${priceLabel}, πάνω από το όριο.`,
        ));
      }
      runtime[key] = { active, checkedAt: new Date().toISOString() };
    }

    if (finitePositive(rule.below)) {
      const key = `${rule.symbol}:below`;
      const active = price <= Number(rule.below);
      const wasActive = runtime[key]?.active === true;
      if (active && !wasActive) {
        events.push(eventFor(
          rule.symbol,
          'below',
          quote,
          Number(rule.below),
          `${rule.symbol} έπεσε στα ${priceLabel}, κάτω από το όριο.`,
        ));
      }
      runtime[key] = { active, checkedAt: new Date().toISOString() };
    }

    if (finitePositive(rule.dailyPct) && Number.isFinite(Number(quote.changePct))) {
      const key = `${rule.symbol}:daily`;
      const marketDay = String(quote.updatedAt || new Date().toISOString()).slice(0, 10);
      const active = Math.abs(Number(quote.changePct)) >= Number(rule.dailyPct);
      const alreadyTriggeredToday = runtime[key]?.triggeredDay === marketDay;
      if (active && !alreadyTriggeredToday) {
        const direction = Number(quote.changePct) >= 0 ? 'ανεβαίνει' : 'πέφτει';
        events.push(eventFor(
          rule.symbol,
          'daily',
          quote,
          Number(rule.dailyPct),
          `${rule.symbol} ${direction} ${Math.abs(Number(quote.changePct)).toFixed(2)}% σήμερα.`,
        ));
        runtime[key] = {
          active: true,
          triggeredDay: marketDay,
          checkedAt: new Date().toISOString(),
        };
      } else {
        runtime[key] = {
          ...runtime[key],
          active,
          checkedAt: new Date().toISOString(),
        };
      }
    }
  }

  const history = [...events].reverse().concat(alerts.history).slice(0, 100);
  return {
    alerts: {
      ...alerts,
      runtime,
      history,
      lastBackgroundCheckAt: background ? new Date().toISOString() : alerts.lastBackgroundCheckAt,
    },
    events,
  };
}

export async function configureNotificationsAsync({ request = false } = {}) {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(ALERT_CHANNEL_ID, {
      name: 'Ειδοποιήσεις τιμών',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 200, 250],
      lightColor: '#0B66FF',
      sound: 'default',
    });
  }

  let permissions = await Notifications.getPermissionsAsync();
  if (request && permissions.status !== 'granted') {
    permissions = await Notifications.requestPermissionsAsync();
  }
  return permissions.status;
}

export async function presentAlertEvents(events) {
  if (!Array.isArray(events) || !events.length) return;
  const status = await configureNotificationsAsync({ request: false });
  if (status !== 'granted') return;

  for (const event of events) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `Investor Control · ${event.symbol}`,
        body: event.message,
        sound: 'default',
        data: { symbol: event.symbol, kind: event.kind },
      },
      trigger: Platform.OS === 'android' ? { channelId: ALERT_CHANNEL_ID } : null,
    });
  }
}

export async function sendTestNotificationAsync() {
  const status = await configureNotificationsAsync({ request: true });
  if (status !== 'granted') return false;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Investor Control',
      body: 'Οι ειδοποιήσεις λειτουργούν σωστά σε αυτή τη συσκευή.',
      sound: 'default',
    },
    trigger: Platform.OS === 'android' ? { channelId: ALERT_CHANNEL_ID } : null,
  });
  return true;
}
