export const MINBEIS_PRODUCT_METRICS_VERSION = 1;
export const MAX_LOCAL_MINBEIS_SESSIONS = 180;

function iso(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function dayKey(value) {
  const normalized = iso(value);
  return normalized ? normalized.slice(0, 10) : null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function boundedSessions(sessions = []) {
  return sessions
    .filter((item) => item?.openedAt && iso(item.openedAt))
    .map((item) => ({
      openedAt: iso(item.openedAt),
      day: item.day || dayKey(item.openedAt),
      firstFeedbackAt: item.firstFeedbackAt ? iso(item.firstFeedbackAt) : null,
      useful: typeof item.useful === 'boolean' ? item.useful : null,
      timeToClaritySec: Number.isFinite(Number(item.timeToClaritySec))
        ? Math.max(0, Math.round(Number(item.timeToClaritySec)))
        : null,
    }))
    .slice(-MAX_LOCAL_MINBEIS_SESSIONS);
}

export function normalizeMinbeisProductMetrics(raw = {}) {
  return {
    format: 'minbeis-local-product-metrics',
    version: MINBEIS_PRODUCT_METRICS_VERSION,
    sessions: boundedSessions(raw?.sessions),
  };
}

export function startMinbeisProductSession(raw = {}, openedAt = new Date().toISOString()) {
  const state = normalizeMinbeisProductMetrics(raw);
  const timestamp = iso(openedAt) || new Date().toISOString();
  const session = {
    openedAt: timestamp,
    day: dayKey(timestamp),
    firstFeedbackAt: null,
    useful: null,
    timeToClaritySec: null,
  };
  return {
    state: {
      ...state,
      sessions: boundedSessions([...state.sessions, session]),
    },
    sessionStartedAt: timestamp,
  };
}

export function recordMinbeisProductFeedback(raw = {}, input = {}) {
  const state = normalizeMinbeisProductMetrics(raw);
  const sessionStartedAt = iso(input.sessionStartedAt);
  const feedbackAt = iso(input.feedbackAt || new Date().toISOString());
  if (!sessionStartedAt || !feedbackAt || typeof input.useful !== 'boolean') return state;

  const sessions = [...state.sessions];
  let index = sessions.findIndex((item) => item.openedAt === sessionStartedAt);
  if (index < 0) {
    sessions.push({
      openedAt: sessionStartedAt,
      day: dayKey(sessionStartedAt),
      firstFeedbackAt: null,
      useful: null,
      timeToClaritySec: null,
    });
    index = sessions.length - 1;
  }

  const current = sessions[index];
  const firstFeedbackAt = current.firstFeedbackAt || feedbackAt;
  const elapsed = Math.max(0, (new Date(firstFeedbackAt).getTime() - new Date(sessionStartedAt).getTime()) / 1000);
  sessions[index] = {
    ...current,
    firstFeedbackAt,
    useful: input.useful,
    timeToClaritySec: input.useful === true ? Math.round(elapsed) : null,
  };

  return {
    ...state,
    sessions: boundedSessions(sessions),
  };
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarizeMinbeisProductMetrics(raw = {}, now = new Date().toISOString()) {
  const state = normalizeMinbeisProductMetrics(raw);
  const nowTime = new Date(now).getTime();
  const cutoff = nowTime - (30 * 24 * 60 * 60 * 1000);
  const recent = state.sessions.filter((item) => new Date(item.openedAt).getTime() >= cutoff);
  const activeDays = unique(recent.map((item) => item.day));
  const usefulDays = unique(recent.filter((item) => item.useful === true).map((item) => item.day));
  const feedbackRows = recent.filter((item) => typeof item.useful === 'boolean');
  const usefulRows = recent.filter((item) => item.useful === true);
  const clarity = usefulRows.map((item) => Number(item.timeToClaritySec)).filter(Number.isFinite);
  const positiveRatePct = feedbackRows.length
    ? Number(((usefulRows.length / feedbackRows.length) * 100).toFixed(1))
    : null;
  const repeatUsefulnessPct = activeDays.length
    ? Number(((usefulDays.length / activeDays.length) * 100).toFixed(1))
    : null;
  const medianClarity = median(clarity);
  const minimumEvidenceMet = activeDays.length >= 5 && feedbackRows.length >= 5 && usefulRows.length >= 3;

  return {
    format: 'minbeis-local-product-metrics-summary',
    version: MINBEIS_PRODUCT_METRICS_VERSION,
    windowDays: 30,
    activeDays: activeDays.length,
    usefulDays: usefulDays.length,
    sessions: recent.length,
    feedbackCount: feedbackRows.length,
    usefulFeedbackCount: usefulRows.length,
    clarityPositiveRatePct: positiveRatePct,
    medianTimeToClaritySec: Number.isFinite(medianClarity) ? Math.round(medianClarity) : null,
    repeatUsefulnessPct,
    minimumEvidenceMet,
    conclusion: minimumEvidenceMet ? 'MEASURABLE' : 'INSUFFICIENT_LOCAL_SAMPLE',
    privacy: {
      localOnly: true,
      networkTransmission: false,
      storesSymbols: false,
      storesPortfolioValues: false,
      storesDecisions: false,
    },
  };
}
