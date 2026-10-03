export const INTELLIGENCE_FRESH_MAX_AGE_MS = 4 * 60 * 60 * 1000;

export function intelligenceSystemReady(health = {}) {
  return health?.status === 'OPERATIONAL'
    && health?.marketDataStatus === 'OPERATIONAL'
    && health?.fundamentalsStatus === 'OPERATIONAL'
    && health?.decisionEngineStatus === 'READY';
}

export function intelligenceFeedFresh(feed, now = Date.now(), maxAgeMs = INTELLIGENCE_FRESH_MAX_AGE_MS) {
  const generatedAtMs = new Date(feed?.generatedAt || '').getTime();
  if (!Number.isFinite(generatedAtMs)) return false;
  const ageMs = Math.max(0, Number(now) - generatedAtMs);
  return ageMs <= maxAgeMs;
}

export function intelligenceDecisionContext(feed, now = Date.now()) {
  return {
    feedFresh: intelligenceFeedFresh(feed, now),
    systemReady: intelligenceSystemReady(feed?.operationalHealth || {}),
  };
}
