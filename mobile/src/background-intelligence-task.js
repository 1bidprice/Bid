import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { finalActionIsCurrent } from './decision-validity';
import {
  NOTIFICATION_POLICY_VERSION,
  buildDecisionChangeEvents,
  buildDecisionSnapshot,
  buildNotificationPayload,
  mergeActionSnapshots,
} from './intelligence-notification-policy';
import { buildOpenPositionLedger } from './portfolio-engine';
import { PORTFOLIO_STATE_STORAGE_KEY } from './portfolio-state-storage';

export const BACKGROUND_INTELLIGENCE_TASK = 'investor-control-background-intelligence-v1';
export const INTELLIGENCE_FEED_STORAGE_KEY = 'investor-control.intelligence-feed.v1';
export const INTELLIGENCE_NOTIFICATION_STATE_KEY = 'investor-control.intelligence-notifications.v1';
export const INTELLIGENCE_FEED_URL = 'https://raw.githubusercontent.com/1bidprice/Bid/investor-control-live-feed/mobile-intelligence-feed.json';

const SUPPORTED_VERSIONS = new Set([1, 2]);
const MAX_FEED_BYTES = 2_000_000;
const FRESH_NOTIFICATION_MAX_AGE_MS = 4 * 3_600_000;

function validateFeed(payload) {
  if (payload?.format !== 'investor-control-mobile-intelligence-feed' || !SUPPORTED_VERSIONS.has(Number(payload?.version))) {
    throw new Error('Invalid Investor Control intelligence feed');
  }
  const generatedAt = new Date(payload.generatedAt);
  if (Number.isNaN(generatedAt.getTime())) throw new Error('Invalid intelligence feed timestamp');
  return { ...payload, generatedAt: generatedAt.toISOString() };
}

async function loadNotificationState() {
  try {
    const raw = await AsyncStorage.getItem(INTELLIGENCE_NOTIFICATION_STATE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object'
      ? parsed
      : { policyVersion: null, lastActions: {} };
  } catch {
    return { policyVersion: null, lastActions: {} };
  }
}

async function saveNotificationState(feed, lastActions) {
  await AsyncStorage.setItem(INTELLIGENCE_NOTIFICATION_STATE_KEY, JSON.stringify({
    policyVersion: NOTIFICATION_POLICY_VERSION,
    feedGeneratedAt: feed.generatedAt,
    lastActions,
  }));
}

async function loadPortfolioPositions() {
  try {
    const raw = await AsyncStorage.getItem(PORTFOLIO_STATE_STORAGE_KEY);
    if (!raw) return { available: true, positions: [] };
    const parsed = JSON.parse(raw);
    const transactions = Array.isArray(parsed?.transactions) ? parsed.transactions : [];
    return { available: true, positions: buildOpenPositionLedger(transactions) };
  } catch (error) {
    console.warn('Investor Control notification ownership state unavailable', error);
    return { available: false, positions: [] };
  }
}

async function notificationsAllowed() {
  const permissions = await Notifications.getPermissionsAsync();
  return permissions.status === 'granted';
}

function notificationDecisionOptions(feed, nowMs = Date.now()) {
  const generatedAtMs = new Date(feed?.generatedAt || '').getTime();
  const ageMs = Number.isFinite(generatedAtMs) ? Math.max(0, nowMs - generatedAtMs) : Number.POSITIVE_INFINITY;
  const feedFresh = ageMs <= FRESH_NOTIFICATION_MAX_AGE_MS;
  const systemReady = feed?.operationalHealth?.status === 'OPERATIONAL';
  return {
    isCurrentDecision: (finalAction) => finalActionIsCurrent(finalAction, {
      now: nowMs,
      feedFresh,
      systemReady,
    }),
  };
}

async function notifyChanges(feed, openPositions) {
  const state = await loadNotificationState();
  const options = notificationDecisionOptions(feed);
  const currentSnapshot = buildDecisionSnapshot(feed, openPositions, options);

  // A notification policy migration establishes a clean baseline without
  // replaying older research conclusions as if they were newly actionable.
  if (state.policyVersion !== NOTIFICATION_POLICY_VERSION) {
    await saveNotificationState(feed, currentSnapshot);
    return 0;
  }

  const { events } = buildDecisionChangeEvents(
    feed,
    openPositions,
    state.lastActions && typeof state.lastActions === 'object' ? state.lastActions : {},
    options,
  );
  const payload = buildNotificationPayload(events);

  if (payload && await notificationsAllowed()) {
    await Notifications.setNotificationChannelAsync('market-intelligence', {
      name: 'Market Intelligence',
      importance: Notifications.AndroidImportance.HIGH,
    });
    await Notifications.scheduleNotificationAsync({
      content: { title: payload.title, body: payload.body, data: payload.data },
      trigger: null,
    });
  }

  await saveNotificationState(
    feed,
    mergeActionSnapshots(
      state.lastActions && typeof state.lastActions === 'object' ? state.lastActions : {},
      currentSnapshot,
    ),
  );
  return payload ? 1 : 0;
}

async function fetchFeed() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${INTELLIGENCE_FEED_URL}?background=${Date.now()}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Feed HTTP ${response.status}`);
    const text = await response.text();
    if (!text || text.length > MAX_FEED_BYTES) throw new Error('Invalid feed size');
    return validateFeed(JSON.parse(text));
  } finally {
    clearTimeout(timeout);
  }
}

TaskManager.defineTask(BACKGROUND_INTELLIGENCE_TASK, async () => {
  try {
    const incoming = await fetchFeed();
    let cached = null;
    try {
      const raw = await AsyncStorage.getItem(INTELLIGENCE_FEED_STORAGE_KEY);
      cached = raw ? validateFeed(JSON.parse(raw)) : null;
    } catch {}
    const incomingTime = new Date(incoming.generatedAt).getTime();
    const cachedTime = cached ? new Date(cached.generatedAt).getTime() : 0;
    if (incomingTime >= cachedTime) {
      await AsyncStorage.setItem(INTELLIGENCE_FEED_STORAGE_KEY, JSON.stringify(incoming));
      const portfolio = await loadPortfolioPositions();
      if (portfolio.available) {
        await notifyChanges(incoming, portfolio.positions);
      }
    }
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    console.error('Investor Control background intelligence failed', error);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function syncBackgroundIntelligenceTask(enabled = true) {
  const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_INTELLIGENCE_TASK);
  if (enabled && !registered) {
    await BackgroundTask.registerTaskAsync(BACKGROUND_INTELLIGENCE_TASK, { minimumInterval: 60 });
  } else if (!enabled && registered) {
    await BackgroundTask.unregisterTaskAsync(BACKGROUND_INTELLIGENCE_TASK);
  }
  return TaskManager.isTaskRegisteredAsync(BACKGROUND_INTELLIGENCE_TASK);
}
