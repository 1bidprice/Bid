import * as Notifications from 'expo-notifications';

export const MINBEIS_PUSH_REGISTRATION_VERSION = '2026-10-03.1';

function clean(value) {
  return String(value || '').trim();
}

export function resolveExpoProjectId(constants = {}, env = process.env) {
  return clean(
    constants?.expoConfig?.extra?.eas?.projectId
    || constants?.easConfig?.projectId
    || env.EXPO_PUBLIC_EAS_PROJECT_ID
    || '',
  ) || null;
}

export async function getMinbeisExpoPushRegistration(options = {}) {
  const constants = options.constants || {};
  const projectId = resolveExpoProjectId(constants, options.env || process.env);
  if (!projectId) {
    const error = new Error('REMOTE_PUSH_NOT_CONFIGURED');
    error.code = 'REMOTE_PUSH_NOT_CONFIGURED';
    throw error;
  }

  let permissions = await Notifications.getPermissionsAsync();
  if (permissions.status !== 'granted' && options.requestPermission === true) {
    permissions = await Notifications.requestPermissionsAsync();
  }
  if (permissions.status !== 'granted') {
    const error = new Error('PUSH_PERMISSION_NOT_GRANTED');
    error.code = 'PUSH_PERMISSION_NOT_GRANTED';
    throw error;
  }

  const result = await Notifications.getExpoPushTokenAsync({ projectId });
  const token = clean(result?.data);
  if (!/^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]{16,256}\]$/.test(token)) {
    const error = new Error('PUSH_TOKEN_INVALID');
    error.code = 'PUSH_TOKEN_INVALID';
    throw error;
  }

  return {
    format: 'minbeis-device-push-registration',
    version: 1,
    projectId,
    pushToken: token,
  };
}
