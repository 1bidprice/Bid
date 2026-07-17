import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { FINNHUB_TOKEN_KEY, fetchPortfolioQuotes } from './market-data';
import { evaluateAlerts, normalizeAlerts, presentAlertEvents } from './alert-engine';

export const STORAGE_KEY = 'investor-control-mobile-state-v2';
export const BACKGROUND_ALERT_TASK = 'investor-control-background-alerts-v1';

function normalizeState(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    schemaVersion: 4,
    transactions: Array.isArray(source.transactions) ? source.transactions : [],
    prices: source.prices && typeof source.prices === 'object' ? source.prices : {},
    meta: {
      lastCheckedAt: source.meta?.lastCheckedAt || null,
      errors: Array.isArray(source.meta?.errors) ? source.meta.errors : [],
    },
    alerts: normalizeAlerts(source.alerts),
  };
}

TaskManager.defineTask(BACKGROUND_ALERT_TASK, async () => {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    const current = normalizeState(saved ? JSON.parse(saved) : null);
    if (!current.alerts.backgroundEnabled || !current.alerts.rules.some((rule) => rule.enabled)) {
      return BackgroundTask.BackgroundTaskResult.Success;
    }

    const symbols = [...new Set(
      current.transactions
        .map((transaction) => String(transaction.symbol || '').trim().toUpperCase())
        .filter(Boolean),
    )];
    if (!symbols.length) return BackgroundTask.BackgroundTaskResult.Success;

    const token = await SecureStore.getItemAsync(FINNHUB_TOKEN_KEY);
    const result = await fetchPortfolioQuotes(symbols, { finnhubToken: token || '' });
    const prices = { ...current.prices, ...result.quotes };
    const evaluated = evaluateAlerts(current.alerts, prices, { background: true });
    const next = {
      ...current,
      prices,
      alerts: evaluated.alerts,
      meta: { lastCheckedAt: result.checkedAt, errors: result.errors },
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    await presentAlertEvents(evaluated.events);
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    console.error('Investor Control background alert failed', error);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function syncBackgroundAlertTask(enabled) {
  const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_ALERT_TASK);
  if (enabled && !registered) {
    await BackgroundTask.registerTaskAsync(BACKGROUND_ALERT_TASK, { minimumInterval: 15 });
  } else if (!enabled && registered) {
    await BackgroundTask.unregisterTaskAsync(BACKGROUND_ALERT_TASK);
  }
  return TaskManager.isTaskRegisteredAsync(BACKGROUND_ALERT_TASK);
}
