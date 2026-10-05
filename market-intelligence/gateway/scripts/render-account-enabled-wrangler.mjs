import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function clean(value) {
  return String(value || '').trim();
}

function required(name, value, pattern = null) {
  const normalized = clean(value);
  if (!normalized) throw new Error(`${name}_REQUIRED`);
  if (pattern && !pattern.test(normalized)) throw new Error(`${name}_INVALID`);
  return normalized;
}

export function buildAccountEnabledWranglerConfig(baseConfig, input = {}) {
  if (!baseConfig || typeof baseConfig !== 'object' || Array.isArray(baseConfig)) {
    throw new Error('WRANGLER_BASE_CONFIG_INVALID');
  }

  const firebaseProjectId = required(
    'FIREBASE_PROJECT_ID',
    input.firebaseProjectId,
    /^[a-z0-9][a-z0-9-]{3,62}[a-z0-9]$/,
  );
  const databaseId = required(
    'MINBEIS_ACCOUNTS_DB_ID',
    input.databaseId,
    /^[a-f0-9-]{20,64}$/i,
  );
  const databaseName = clean(input.databaseName || 'minbeis-accounts');
  if (!/^[a-z0-9-]{3,63}$/.test(databaseName)) throw new Error('MINBEIS_ACCOUNTS_DB_NAME_INVALID');

  const existingD1 = Array.isArray(baseConfig.d1_databases) ? baseConfig.d1_databases : [];
  const retained = existingD1.filter((item) => item?.binding !== 'MINBEIS_ACCOUNTS_DB');
  const remoteAlertsEnabled = input.remoteAlertsEnabled === true;
  const remoteAlertCron = clean(input.remoteAlertCron || '*/5 * * * *');
  if (remoteAlertsEnabled && remoteAlertCron !== '*/5 * * * *') {
    throw new Error('MINBEIS_REMOTE_ALERT_CRON_INVALID');
  }

  return {
    ...baseConfig,
    vars: {
      ...(baseConfig.vars || {}),
      MINBEIS_ACCOUNT_API_ENABLED: 'true',
      MINBEIS_REMOTE_ALERTS_ENABLED: remoteAlertsEnabled ? 'true' : 'false',
      FIREBASE_PROJECT_ID: firebaseProjectId,
    },
    ...(remoteAlertsEnabled ? {
      triggers: {
        ...(baseConfig.triggers || {}),
        crons: [remoteAlertCron],
      },
    } : {}),
    d1_databases: [
      ...retained,
      {
        binding: 'MINBEIS_ACCOUNTS_DB',
        database_name: databaseName,
        database_id: databaseId,
      },
    ],
  };
}

async function main() {
  const basePath = path.resolve(process.cwd(), process.argv[2] || 'wrangler.jsonc');
  const outputPath = path.resolve(process.cwd(), process.argv[3] || 'wrangler.accounts.generated.json');
  const base = JSON.parse(await readFile(basePath, 'utf8'));
  const rendered = buildAccountEnabledWranglerConfig(base, {
    firebaseProjectId: process.env.FIREBASE_PROJECT_ID,
    databaseId: process.env.MINBEIS_ACCOUNTS_DB_ID,
    databaseName: process.env.MINBEIS_ACCOUNTS_DB_NAME || 'minbeis-accounts',
    remoteAlertsEnabled: String(process.env.MINBEIS_REMOTE_ALERTS_ENABLED || '').toLowerCase() === 'true',
    remoteAlertCron: process.env.MINBEIS_REMOTE_ALERT_CRON || '*/5 * * * *',
  });
  await writeFile(outputPath, `${JSON.stringify(rendered, null, 2)}\n`, 'utf8');
  console.log(`Rendered account-enabled Wrangler config to ${outputPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}
