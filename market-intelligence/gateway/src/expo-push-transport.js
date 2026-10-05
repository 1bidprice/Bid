import { normalizeExpoPushToken } from './push-contract.js';

export const MINBEIS_EXPO_PUSH_TRANSPORT_VERSION = '2026-10-03.1';
export const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
export const EXPO_RECEIPTS_ENDPOINT = 'https://exp.host/--/api/v2/push/getReceipts';
export const EXPO_PUSH_BATCH_SIZE = 100;
export const EXPO_RECEIPT_BATCH_SIZE = 1000;

const clean = (value) => String(value || '').trim();

function safeData(data = {}) {
  const allowed = new Set(['symbol', 'kind']);
  if (Object.keys(data || {}).some((key) => !allowed.has(key))) throw new Error('PUSH_DATA_PRIVACY_CONTRACT_INVALID');
  const symbol = clean(data.symbol).toUpperCase();
  const kind = clean(data.kind).toUpperCase();
  if (!/^([A-Z0-9][A-Z0-9.-]{0,19})\.(US|GR)$/.test(symbol)) throw new Error('PUSH_DATA_SYMBOL_INVALID');
  if (!['PRICE_ABOVE','PRICE_BELOW','DAILY_PCT','MINBEIS_DECISION_CHANGE'].includes(kind)) throw new Error('PUSH_DATA_KIND_INVALID');
  return { symbol, kind };
}

export function normalizeExpoPushMessage(input = {}) {
  const to = normalizeExpoPushToken(input.to);
  if (!to) throw new Error('PUSH_TOKEN_INVALID');
  const title = clean(input.title);
  const body = clean(input.body);
  if (!title || title.length > 80) throw new Error('PUSH_TITLE_INVALID');
  if (!body || body.length > 500) throw new Error('PUSH_BODY_INVALID');
  const data = safeData(input.data);
  return {
    to,
    title,
    body,
    data,
    sound: 'default',
    priority: 'high',
    ...(clean(input.channelId) ? { channelId: clean(input.channelId).slice(0, 64) } : {}),
  };
}

export function chunkExpoPushMessages(messages = []) {
  const normalized = messages.map(normalizeExpoPushMessage);
  const chunks = [];
  for (let index = 0; index < normalized.length; index += EXPO_PUSH_BATCH_SIZE) {
    chunks.push(normalized.slice(index, index + EXPO_PUSH_BATCH_SIZE));
  }
  return chunks;
}

const retryable = (status) => status === 429 || (status >= 500 && status <= 599);

async function delay(ms, sleep) {
  if (typeof sleep === 'function') return sleep(ms);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJson(url, body, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('PUSH_FETCH_UNAVAILABLE');
  const maxAttempts = Math.max(1, Math.min(4, Number(options.maxAttempts || 3)));
  let lastStatus = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(clean(options.accessToken) ? { Authorization: `Bearer ${clean(options.accessToken)}` } : {}),
      },
      body: JSON.stringify(body),
    });
    lastStatus = response.status;
    if (response.ok) return response.json();
    if (!retryable(response.status) || attempt === maxAttempts) {
      const error = new Error(`PUSH_HTTP_${response.status}`);
      error.status = response.status;
      throw error;
    }
    await delay(250 * (2 ** (attempt - 1)), options.sleep);
  }
  throw new Error(`PUSH_HTTP_${lastStatus || 'UNKNOWN'}`);
}

export async function sendExpoPushMessages(messages = [], options = {}) {
  const chunks = chunkExpoPushMessages(messages);
  const tickets = [];
  const invalidTokens = [];

  for (const chunk of chunks) {
    const payload = await postJson(EXPO_PUSH_ENDPOINT, chunk, options);
    const data = Array.isArray(payload?.data) ? payload.data : [payload?.data].filter(Boolean);
    for (let index = 0; index < data.length; index += 1) {
      const ticket = data[index] || {};
      const token = chunk[index]?.to || null;
      tickets.push({ token, ...ticket });
      if (ticket?.status === 'error' && ticket?.details?.error === 'DeviceNotRegistered' && token) {
        invalidTokens.push(token);
      }
    }
  }

  return {
    sentMessageCount: messages.length,
    requestCount: chunks.length,
    tickets,
    invalidTokens: [...new Set(invalidTokens)],
  };
}

export async function fetchExpoPushReceipts(ids = [], options = {}) {
  const cleanIds = [...new Set(ids.map(clean).filter((id) => /^[A-Za-z0-9-]{8,128}$/.test(id)))];
  const receipts = {};
  for (let index = 0; index < cleanIds.length; index += EXPO_RECEIPT_BATCH_SIZE) {
    const chunk = cleanIds.slice(index, index + EXPO_RECEIPT_BATCH_SIZE);
    const payload = await postJson(EXPO_RECEIPTS_ENDPOINT, { ids: chunk }, options);
    Object.assign(receipts, payload?.data || {});
  }
  const invalidReceiptIds = Object.entries(receipts)
    .filter(([, receipt]) => receipt?.status === 'error' && receipt?.details?.error === 'DeviceNotRegistered')
    .map(([id]) => id);
  return { receiptCount: Object.keys(receipts).length, receipts, invalidReceiptIds };
}
