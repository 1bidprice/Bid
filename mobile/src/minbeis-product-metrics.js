import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  normalizeMinbeisProductMetrics,
  recordMinbeisProductFeedback,
  startMinbeisProductSession,
  summarizeMinbeisProductMetrics,
} from './minbeis-product-metrics-core';

export const MINBEIS_PRODUCT_METRICS_STORAGE_KEY = 'investor-control.minbeis-product-metrics.v1';

async function readState(storage = AsyncStorage) {
  try {
    const raw = await storage.getItem(MINBEIS_PRODUCT_METRICS_STORAGE_KEY);
    return normalizeMinbeisProductMetrics(raw ? JSON.parse(raw) : {});
  } catch {
    return normalizeMinbeisProductMetrics({});
  }
}

async function writeState(state, storage = AsyncStorage) {
  await storage.setItem(MINBEIS_PRODUCT_METRICS_STORAGE_KEY, JSON.stringify(normalizeMinbeisProductMetrics(state)));
}

export async function startLocalMinbeisProductSession(options = {}) {
  const storage = options.storage || AsyncStorage;
  const openedAt = options.openedAt || new Date().toISOString();
  const current = await readState(storage);
  const started = startMinbeisProductSession(current, openedAt);
  await writeState(started.state, storage);
  return {
    sessionStartedAt: started.sessionStartedAt,
    summary: summarizeMinbeisProductMetrics(started.state, openedAt),
  };
}

export async function recordLocalMinbeisClarityFeedback(sessionStartedAt, useful, options = {}) {
  const storage = options.storage || AsyncStorage;
  const feedbackAt = options.feedbackAt || new Date().toISOString();
  const current = await readState(storage);
  const next = recordMinbeisProductFeedback(current, { sessionStartedAt, useful, feedbackAt });
  await writeState(next, storage);
  return summarizeMinbeisProductMetrics(next, feedbackAt);
}

export async function loadLocalMinbeisProductMetrics(options = {}) {
  const storage = options.storage || AsyncStorage;
  const now = options.now || new Date().toISOString();
  return summarizeMinbeisProductMetrics(await readState(storage), now);
}
