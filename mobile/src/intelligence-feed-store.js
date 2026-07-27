import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

export const INTELLIGENCE_FEED_STORAGE_KEY = 'investor-control.intelligence-feed.v1';
const FEED_FORMAT = 'investor-control-mobile-intelligence-feed';
const FEED_VERSION = 1;

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeItem(item) {
  const status = ['DRAFT_RESEARCH', 'REVIEW_READY', 'PUBLISHED'].includes(item?.status)
    ? item.status
    : 'DRAFT_RESEARCH';
  return {
    ...item,
    status,
    action: status === 'DRAFT_RESEARCH' ? 'WATCH' : item?.action || 'WATCH',
    blockers: safeArray(item?.blockers),
    blockerLabels: safeArray(item?.blockerLabels),
    catalysts: safeArray(item?.catalysts),
    risks: safeArray(item?.risks),
    sources: safeArray(item?.sources),
  };
}

export function normalizeIntelligenceFeed(payload) {
  if (payload?.format !== FEED_FORMAT || Number(payload?.version) !== FEED_VERSION) {
    throw new Error('Το αρχείο δεν είναι έγκυρη ροή Market Intelligence του Investor Control.');
  }
  const generatedAt = new Date(payload.generatedAt);
  if (Number.isNaN(generatedAt.getTime())) throw new Error('Η ροή δεν έχει έγκυρη ημερομηνία δημιουργίας.');
  const published = safeArray(payload.published).map(normalizeItem).filter((item) => item.status === 'PUBLISHED');
  const reviewReady = safeArray(payload.reviewReady).map(normalizeItem).filter((item) => item.status === 'REVIEW_READY');
  const research = safeArray(payload.research).map(normalizeItem).filter((item) => item.status === 'DRAFT_RESEARCH');
  const urgentIds = new Set(safeArray(payload.urgent).map((item) => item?.id).filter(Boolean));
  const all = [...published, ...reviewReady, ...research];
  const urgent = all.filter((item) => urgentIds.has(item.id));
  return {
    format: FEED_FORMAT,
    version: FEED_VERSION,
    generatedAt: generatedAt.toISOString(),
    summary: {
      publishedCount: published.length,
      reviewReadyCount: reviewReady.length,
      researchCount: research.length,
      urgentCount: urgent.length,
      unresolvedDiagnosticCount: Number(payload.summary?.unresolvedDiagnosticCount || 0),
    },
    today: payload.today && typeof payload.today === 'object' ? payload.today : { headline: 'Δεν υπάρχει διαθέσιμη σύνοψη.', primaryItem: null },
    published,
    reviewReady,
    research,
    urgent,
    assistantContext: safeArray(payload.assistantContext),
    disclosure: String(payload.disclosure || ''),
  };
}

export async function loadCachedIntelligenceFeed() {
  const raw = await AsyncStorage.getItem(INTELLIGENCE_FEED_STORAGE_KEY);
  if (!raw) return null;
  try {
    return normalizeIntelligenceFeed(JSON.parse(raw));
  } catch {
    await AsyncStorage.removeItem(INTELLIGENCE_FEED_STORAGE_KEY);
    return null;
  }
}

export async function cacheIntelligenceFeed(feed) {
  const normalized = normalizeIntelligenceFeed(feed);
  await AsyncStorage.setItem(INTELLIGENCE_FEED_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export async function importIntelligenceFeedAsync() {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/json', 'text/plain'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset?.uri) throw new Error('Δεν επιλέχθηκε έγκυρο αρχείο.');
  const text = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.UTF8 });
  const normalized = normalizeIntelligenceFeed(JSON.parse(text));
  await AsyncStorage.setItem(INTELLIGENCE_FEED_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export async function clearIntelligenceFeed() {
  await AsyncStorage.removeItem(INTELLIGENCE_FEED_STORAGE_KEY);
}
