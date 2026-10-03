export const MINBEIS_PUSH_CONTRACT_VERSION = '2026-10-03.1';

const ALERT_KINDS = new Set(['PRICE_ABOVE', 'PRICE_BELOW', 'DAILY_PCT', 'MINBEIS_DECISION_CHANGE']);
const PLATFORMS = new Set(['android', 'ios']);

function clean(value) {
  return String(value || '').trim();
}

export function normalizeExpoPushToken(value) {
  const token = clean(value);
  return /^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]{16,256}\]$/.test(token) ? token : null;
}

export function normalizePushRegistration(input = {}) {
  const tenantId = clean(input.tenantId);
  const installationId = clean(input.installationId);
  const token = normalizeExpoPushToken(input.pushToken);
  const platform = clean(input.platform).toLowerCase();
  if (!/^tenant_[a-f0-9]{40}$/.test(tenantId)) throw new Error('PUSH_TENANT_ID_INVALID');
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(installationId)) throw new Error('PUSH_INSTALLATION_ID_INVALID');
  if (!token) throw new Error('PUSH_TOKEN_INVALID');
  if (!PLATFORMS.has(platform)) throw new Error('PUSH_PLATFORM_INVALID');
  return {
    format: 'minbeis-push-registration',
    version: 1,
    tenantId,
    installationId,
    pushToken: token,
    platform,
    enabled: input.enabled !== false,
    locale: /^[a-z]{2}(?:-[A-Z]{2})?$/.test(clean(input.locale)) ? clean(input.locale) : null,
    privacy: {
      portfolioQuantityStored: false,
      portfolioCostStored: false,
      pnlStored: false,
      notesStored: false,
    },
  };
}

export function normalizeServerAlertRule(input = {}) {
  const ruleId = clean(input.ruleId);
  const tenantId = clean(input.tenantId);
  const symbol = clean(input.symbol).toUpperCase();
  const kind = clean(input.kind).toUpperCase();
  const threshold = input.threshold === null || input.threshold === undefined
    ? null
    : Number(input.threshold);
  if (!/^tenant_[a-f0-9]{40}$/.test(tenantId)) throw new Error('ALERT_TENANT_ID_INVALID');
  if (!/^[A-Za-z0-9:_-]{8,160}$/.test(ruleId)) throw new Error('ALERT_RULE_ID_INVALID');
  if (!/^([A-Z0-9][A-Z0-9.-]{0,19})\.(US|GR)$/.test(symbol)) throw new Error('ALERT_SYMBOL_INVALID');
  if (!ALERT_KINDS.has(kind)) throw new Error('ALERT_KIND_INVALID');
  if (kind !== 'MINBEIS_DECISION_CHANGE' && (!Number.isFinite(threshold) || threshold <= 0)) {
    throw new Error('ALERT_THRESHOLD_INVALID');
  }
  return {
    format: 'minbeis-server-alert-rule',
    version: 1,
    tenantId,
    ruleId,
    symbol,
    kind,
    threshold: kind === 'MINBEIS_DECISION_CHANGE' ? null : threshold,
    enabled: input.enabled !== false,
    privacy: {
      quantityRequired: false,
      costBasisRequired: false,
      pnlRequired: false,
    },
  };
}

export function buildPrivacySafePushMessage(event = {}) {
  const symbol = clean(event.symbol).toUpperCase();
  const kind = clean(event.kind).toUpperCase();
  if (!/^([A-Z0-9][A-Z0-9.-]{0,19})\.(US|GR)$/.test(symbol)) throw new Error('PUSH_EVENT_SYMBOL_INVALID');
  if (!ALERT_KINDS.has(kind)) throw new Error('PUSH_EVENT_KIND_INVALID');

  let body;
  if (kind === 'PRICE_ABOVE') body = `${symbol}: η επαληθευμένη τιμή πέρασε το όριο που έχεις ορίσει.`;
  else if (kind === 'PRICE_BELOW') body = `${symbol}: η επαληθευμένη τιμή έπεσε κάτω από το όριο που έχεις ορίσει.`;
  else if (kind === 'DAILY_PCT') body = `${symbol}: η επαληθευμένη ημερήσια μεταβολή πέρασε το όριο που έχεις ορίσει.`;
  else body = `${symbol}: υπάρχει νέα μεταβολή στην αξιολόγηση MINBEIS.`;

  return {
    title: 'MINBEIS',
    body,
    data: { symbol, kind },
    containsPortfolioQuantity: false,
    containsCostBasis: false,
    containsPnl: false,
  };
}
