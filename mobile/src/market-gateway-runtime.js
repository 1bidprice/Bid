import AsyncStorage from '@react-native-async-storage/async-storage';

const {
  getOrCreateInstallationId,
  normalizeGatewayBaseUrl,
  fetchCanonicalGatewayMarketSnapshot,
} = require('./market-gateway-client');

// This value is intentionally public. Expo inlines EXPO_PUBLIC_* values into the client bundle.
// Never place provider credentials or any other secret in this variable.
const COMPILED_MARKET_GATEWAY_URL = process.env.EXPO_PUBLIC_MARKET_GATEWAY_URL;

export function configuredMarketGatewayUrl(value = COMPILED_MARKET_GATEWAY_URL) {
  return normalizeGatewayBaseUrl(value);
}

export function isMarketGatewayConfigured(value = COMPILED_MARKET_GATEWAY_URL) {
  return Boolean(configuredMarketGatewayUrl(value));
}

export async function fetchConfiguredMarketGatewaySnapshot(symbols, options = {}) {
  const baseUrl = configuredMarketGatewayUrl(options.baseUrl === undefined ? COMPILED_MARKET_GATEWAY_URL : options.baseUrl);
  if (!baseUrl) {
    return {
      enabled: false,
      quoteRegistry: {},
      errors: [],
      checkedAt: new Date().toISOString(),
      fxReference: null,
    };
  }

  const storage = options.storage || AsyncStorage;
  const clientId = await getOrCreateInstallationId(storage, options.installationIdOptions || {});
  const snapshot = await fetchCanonicalGatewayMarketSnapshot(symbols, {
    baseUrl,
    clientId,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  });

  return {
    enabled: true,
    quoteRegistry: snapshot.quoteRegistry || {},
    errors: Array.isArray(snapshot.errors) ? snapshot.errors : [],
    checkedAt: snapshot.checkedAt || new Date().toISOString(),
    fxReference: snapshot.fxReference || null,
    ...(snapshot.fxError ? { fxError: snapshot.fxError } : {}),
  };
}
