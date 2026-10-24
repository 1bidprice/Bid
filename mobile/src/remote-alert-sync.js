import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  deleteMinbeisServerAlert,
  upsertMinbeisServerAlert,
} from './account-client';

export const MINBEIS_REMOTE_ALERT_SYNC_VERSION = '2026-10-04.1';
export const REMOTE_PUSH_ENABLED_STORAGE_KEY = 'minbeis.remote-push-enabled.v1';

const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;

function cleanSymbol(value) {
  const symbol = String(value || '').trim().toUpperCase();
  return /^([A-Z0-9][A-Z0-9.-]{0,19}).(US|GR)$/.test(symbol) ? symbol : null;
}

function ruleId(symbol, suffix) {
  return `local:${symbol.replace(/[^A-Z0-9_-]/g, '_')}:${suffix}`;
}

export async function isRemotePushEnabledLocally(storage = AsyncStorage) {
  return (await storage.getItem(REMOTE_PUSH_ENABLED_STORAGE_KEY)) === 'true';
}

export async function setRemotePushEnabledLocally(enabled, storage = AsyncStorage) {
  if (enabled) await storage.setItem(REMOTE_PUSH_ENABLED_STORAGE_KEY, 'true');
  else await storage.removeItem(REMOTE_PUSH_ENABLED_STORAGE_KEY);
}

export function buildRemoteAlertOperations(localRule = {}) {
  const symbol = cleanSymbol(localRule.symbol);
  if (!symbol) return [];
  const enabled = localRule.enabled !== false;
  const definitions = [
    { suffix: 'above', kind: 'PRICE_ABOVE', threshold: positive(localRule.above) ? Number(localRule.above) : null },
    { suffix: 'below', kind: 'PRICE_BELOW', threshold: positive(localRule.below) ? Number(localRule.below) : null },
    { suffix: 'daily', kind: 'DAILY_PCT', threshold: positive(localRule.dailyPct) ? Number(localRule.dailyPct) : null },
  ];

  return definitions.map((item) => ({
    action: enabled && item.threshold !== null ? 'UPSERT' : 'DELETE',
    ruleId: ruleId(symbol, item.suffix),
    symbol,
    kind: item.kind,
    threshold: item.threshold,
  }));
}

export async function syncRemoteAlertRule(localRule, options = {}) {
  const enabled = options.remotePushEnabled === true
    || (options.remotePushEnabled === undefined && await isRemotePushEnabledLocally(options.storage || AsyncStorage));
  if (!enabled) return { synced: false, reason: 'REMOTE_PUSH_NOT_ENABLED', operations: 0 };

  const installationId = String(options.installationId || '').trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(installationId)) {
    throw new Error('REMOTE_ALERT_INSTALLATION_ID_INVALID');
  }

  const operations = buildRemoteAlertOperations(localRule);
  for (const operation of operations) {
    if (operation.action === 'UPSERT') {
      await upsertMinbeisServerAlert(operation.ruleId, {
        symbol: operation.symbol,
        kind: operation.kind,
        threshold: operation.threshold,
        enabled: true,
      }, {
        installationId,
        tokenProvider: options.tokenProvider,
        fetchImpl: options.fetchImpl,
        baseUrl: options.baseUrl,
      });
    } else {
      try {
        await deleteMinbeisServerAlert(operation.ruleId, {
          installationId,
          tokenProvider: options.tokenProvider,
          fetchImpl: options.fetchImpl,
          baseUrl: options.baseUrl,
        });
      } catch (error) {
        if (Number(error?.status) !== 404) throw error;
      }
    }
  }

  return { synced: true, operations: operations.length };
}

export async function syncAllRemoteAlertRules(rules = [], options = {}) {
  const enabled = options.remotePushEnabled === true
    || (options.remotePushEnabled === undefined && await isRemotePushEnabledLocally(options.storage || AsyncStorage));
  if (!enabled) return { synced: false, reason: 'REMOTE_PUSH_NOT_ENABLED', ruleCount: 0 };

  let count = 0;
  for (const rule of Array.isArray(rules) ? rules : []) {
    await syncRemoteAlertRule(rule, { ...options, remotePushEnabled: true });
    count += 1;
  }
  return { synced: true, ruleCount: count };
}
