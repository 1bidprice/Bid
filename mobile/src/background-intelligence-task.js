import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

export const BACKGROUND_INTELLIGENCE_TASK = 'investor-control-background-intelligence-v1';
export const INTELLIGENCE_FEED_STORAGE_KEY = 'investor-control.intelligence-feed.v1';
export const INTELLIGENCE_NOTIFICATION_STATE_KEY = 'investor-control.intelligence-notifications.v1';
export const INTELLIGENCE_FEED_URL = 'https://raw.githubusercontent.com/1bidprice/Bid/investor-control-live-feed/mobile-intelligence-feed.json';

const SUPPORTED_VERSIONS = new Set([1, 2]);
const MAX_FEED_BYTES = 2_000_000;

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function validateFeed(payload) {
  if (payload?.format !== 'investor-control-mobile-intelligence-feed' || !SUPPORTED_VERSIONS.has(Number(payload?.version))) {
    throw new Error('Invalid Investor Control intelligence feed');
  }
  const generatedAt = new Date(payload.generatedAt);
  if (Number.isNaN(generatedAt.getTime())) throw new Error('Invalid intelligence feed timestamp');
  return { ...payload, generatedAt: generatedAt.toISOString() };
}

function finalEvents(feed) {
  return safeArray(feed.decisions)
    .filter((item) => item?.finalAction?.status === 'FINAL' && item.finalAction.marketAction !== 'WATCH')
    .map((item) => ({
      type: 'FINAL_ACTION',
      fingerprint: `final|${item.companyId}|${item.finalAction.marketAction}|${item.finalAction.validUntil || feed.generatedAt}`,
      title: 'Νέο επενδυτικό συμπέρασμα',
      body: `${item.companyName || item.symbol}: ${item.finalAction.marketActionLabel || item.finalAction.marketAction}`,
    }));
}

function discoveryEvents(feed) {
  return safeArray(feed.discoveryRadar)
    .filter((item) => Number(item?.discoveryScore || 0) >= 80)
    .map((item) => ({
      type: 'DISCOVERY',
      fingerprint: `discovery|${item.companyId}|${item.latestEventAt || feed.generatedAt}`,
      title: 'Νέα μετοχή στο ραντάρ',
      body: `${item.companyName || item.symbol} · σήμα ${Math.round(Number(item.discoveryScore || 0))}/100 — περνά σε πλήρη έρευνα.`,
    }));
}

async function loadNotificationState() {
  try {
    const raw = await AsyncStorage.getItem(INTELLIGENCE_NOTIFICATION_STATE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : { initialized: false, fingerprints: [] };
  } catch {
    return { initialized: false, fingerprints: [] };
  }
}

async function notificationsAllowed() {
  const permissions = await Notifications.getPermissionsAsync();
  return permissions.status === 'granted';
}

async function notifyChanges(feed) {
  const state = await loadNotificationState();
  const events = [...finalEvents(feed), ...discoveryEvents(feed)];
  const currentFingerprints = events.map((event) => event.fingerprint);

  if (!state.initialized) {
    await AsyncStorage.setItem(INTELLIGENCE_NOTIFICATION_STATE_KEY, JSON.stringify({
      initialized: true,
      feedGeneratedAt: feed.generatedAt,
      fingerprints: currentFingerprints.slice(0, 200),
    }));
    return 0;
  }

  const seen = new Set(safeArray(state.fingerprints));
  const fresh = events.filter((event) => !seen.has(event.fingerprint)).slice(0, 3);
  if (fresh.length && await notificationsAllowed()) {
    await Notifications.setNotificationChannelAsync('market-intelligence', {
      name: 'Market Intelligence',
      importance: Notifications.AndroidImportance.HIGH,
    });
    for (const event of fresh) {
      await Notifications.scheduleNotificationAsync({
        content: { title: event.title, body: event.body, data: { type: event.type } },
        trigger: null,
      });
    }
  }

  await AsyncStorage.setItem(INTELLIGENCE_NOTIFICATION_STATE_KEY, JSON.stringify({
    initialized: true,
    feedGeneratedAt: feed.generatedAt,
    fingerprints: [...currentFingerprints, ...safeArray(state.fingerprints)].slice(0, 300),
  }));
  return fresh.length;
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
      await notifyChanges(incoming);
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
