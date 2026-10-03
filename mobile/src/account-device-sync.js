import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { INSTALLATION_ID_SECURE_KEY } from './local-data-ownership';
import { getMinbeisExpoPushRegistration } from './push-registration';
import { registerMinbeisDevice, revokeMinbeisDevice } from './account-client';

export const MINBEIS_DEVICE_SYNC_VERSION = '2026-10-03.1';

function localeNow() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || null;
  } catch {
    return null;
  }
}

async function currentInstallationId() {
  const installationId = await SecureStore.getItemAsync(INSTALLATION_ID_SECURE_KEY);
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(String(installationId || ''))) {
    const error = new Error('DEVICE_INSTALLATION_ID_UNAVAILABLE');
    error.code = 'DEVICE_INSTALLATION_ID_UNAVAILABLE';
    throw error;
  }
  return installationId;
}

export async function enableRemotePushForCurrentDevice(options = {}) {
  const installationId = await currentInstallationId();
  const registration = await getMinbeisExpoPushRegistration({
    constants: options.constants,
    env: options.env,
    requestPermission: true,
  });
  const result = await registerMinbeisDevice({
    pushToken: registration.pushToken,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    enabled: true,
    locale: localeNow(),
  }, {
    installationId,
    tokenProvider: options.tokenProvider,
    fetchImpl: options.fetchImpl,
    baseUrl: options.baseUrl,
  });
  return {
    enabled: true,
    installationId,
    projectId: registration.projectId,
    server: result,
    portfolioUploaded: false,
  };
}

export async function disableRemotePushForCurrentDevice(options = {}) {
  const installationId = await currentInstallationId();
  const result = await revokeMinbeisDevice({
    installationId,
    tokenProvider: options.tokenProvider,
    fetchImpl: options.fetchImpl,
    baseUrl: options.baseUrl,
  });
  return {
    enabled: false,
    installationId,
    server: result,
    portfolioUploaded: false,
  };
}
