export const PORTFOLIO_HISTORY_STORAGE_KEY = 'minbeis.portfolio-history.v1';
export const PORTFOLIO_HISTORY_VERSION = 1;

export const PORTFOLIO_HISTORY_RANGES = Object.freeze({
  '1D': 24 * 60 * 60 * 1000,
  '1W': 7 * 24 * 60 * 60 * 1000,
  '1M': 31 * 24 * 60 * 60 * 1000,
  '6M': 183 * 24 * 60 * 60 * 1000,
  '1Y': 366 * 24 * 60 * 60 * 1000,
});

const RETENTION_MS = 370 * 24 * 60 * 60 * 1000;
const MIN_CAPTURE_INTERVAL_MS = 5 * 60 * 1000;

function finite(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function normalizedPoint(point) {
  const at = new Date(point?.capturedAt || 0).getTime();
  if (!Number.isFinite(at) || at <= 0) return null;
  if (!finite(point?.value) || !finite(point?.cost) || !finite(point?.pnl)) return null;
  return {
    capturedAt: new Date(at).toISOString(),
    value: Number(point.value),
    cost: Number(point.cost),
    pnl: Number(point.pnl),
  };
}

export function createPortfolioHistoryState(installationId) {
  return {
    version: PORTFOLIO_HISTORY_VERSION,
    ownerInstallationId: String(installationId || ''),
    points: [],
  };
}

export function normalizePortfolioHistoryState(raw, installationId) {
  const cleanId = String(installationId || '');
  if (!raw || typeof raw !== 'object') {
    return { status: 'EMPTY', state: createPortfolioHistoryState(cleanId) };
  }
  const owner = String(raw.ownerInstallationId || '').trim();
  if (!owner) {
    return { status: 'LEGACY_UNOWNED', state: createPortfolioHistoryState(cleanId) };
  }
  if (!cleanId || owner !== cleanId) {
    return { status: 'FOREIGN_OWNER', state: createPortfolioHistoryState(cleanId) };
  }
  const points = (Array.isArray(raw.points) ? raw.points : [])
    .map(normalizedPoint)
    .filter(Boolean)
    .sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime());
  return {
    status: 'OWNED',
    state: {
      version: PORTFOLIO_HISTORY_VERSION,
      ownerInstallationId: cleanId,
      points,
    },
  };
}

function bucketSizeForAge(ageMs) {
  if (ageMs <= 2 * 24 * 60 * 60 * 1000) return 5 * 60 * 1000;
  if (ageMs <= 31 * 24 * 60 * 60 * 1000) return 60 * 60 * 1000;
  if (ageMs <= 183 * 24 * 60 * 60 * 1000) return 6 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}

export function compactPortfolioHistory(pointsInput, now = Date.now()) {
  const nowMs = Number(now);
  const cutoff = nowMs - RETENTION_MS;
  const buckets = new Map();
  const points = (Array.isArray(pointsInput) ? pointsInput : [])
    .map(normalizedPoint)
    .filter(Boolean)
    .filter((point) => new Date(point.capturedAt).getTime() >= cutoff)
    .sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime());

  for (const point of points) {
    const at = new Date(point.capturedAt).getTime();
    const age = Math.max(0, nowMs - at);
    const bucketSize = bucketSizeForAge(age);
    const tier = bucketSize;
    const key = `${tier}:${Math.floor(at / bucketSize)}`;
    buckets.set(key, point);
  }
  return [...buckets.values()].sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime());
}

export function recordPortfolioHistoryPoint(rawState, installationId, summary, now = Date.now()) {
  const normalized = normalizePortfolioHistoryState(rawState, installationId);
  const state = normalized.state;
  if (
    summary?.valuesReady !== true
    || summary?.costsReady !== true
    || !finite(summary?.totalValue)
    || !finite(summary?.totalCost)
    || !finite(summary?.totalPnl)
  ) {
    return { changed: false, state };
  }

  const nowMs = Number(now);
  const last = state.points[state.points.length - 1] || null;
  const lastMs = last ? new Date(last.capturedAt).getTime() : 0;
  if (lastMs > 0 && nowMs - lastMs < MIN_CAPTURE_INTERVAL_MS) {
    return { changed: false, state };
  }

  const point = {
    capturedAt: new Date(nowMs).toISOString(),
    value: Number(summary.totalValue),
    cost: Number(summary.totalCost),
    pnl: Number(summary.totalPnl),
  };
  return {
    changed: true,
    state: {
      ...state,
      points: compactPortfolioHistory([...state.points, point], nowMs),
    },
  };
}

export function portfolioHistoryPointsForRange(rawState, range, now = Date.now(), maxPoints = 360) {
  const duration = PORTFOLIO_HISTORY_RANGES[range] || PORTFOLIO_HISTORY_RANGES['1W'];
  const points = Array.isArray(rawState?.points) ? rawState.points : [];
  const cutoff = Number(now) - duration;
  const filtered = points
    .map(normalizedPoint)
    .filter(Boolean)
    .filter((point) => new Date(point.capturedAt).getTime() >= cutoff)
    .sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime());

  if (filtered.length <= maxPoints) return filtered;
  const stride = (filtered.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, index) => filtered[Math.round(index * stride)]);
}
