import { finalActionIsCurrent } from './decision-validity';

function canonicalSymbol(value) {
  return String(value || '').trim().toUpperCase().replace(/\.(US|GR)$/i, '');
}

function operational(feed) {
  const health = feed?.operationalHealth || {};
  return health.status === 'OPERATIONAL'
    && health.marketDataStatus === 'OPERATIONAL'
    && health.fundamentalsStatus === 'OPERATIONAL'
    && health.decisionEngineStatus === 'READY';
}

function freshness(feed, now = Date.now()) {
  const generatedAt = new Date(feed?.generatedAt || 0).getTime();
  if (!Number.isFinite(generatedAt) || generatedAt <= 0) return false;
  return Math.max(0, Number(now) - generatedAt) <= 4 * 60 * 60 * 1000;
}

function allDossiers(feed) {
  return [
    ...(Array.isArray(feed?.published) ? feed.published : []),
    ...(Array.isArray(feed?.reviewReady) ? feed.reviewReady : []),
    ...(Array.isArray(feed?.research) ? feed.research : []),
  ];
}

function priorityFor(item) {
  const classification = item?.minbeisAssessment?.classification;
  const holderAction = item?.finalAction?.holderAction;
  if (holderAction === 'SELL_NOW' || holderAction === 'REDUCE') return 100;
  if (classification === 'TRAP') return 95;
  if (classification === 'CONFIRMATION_REQUIRED') return 85;
  if (item?.finalAction?.status === 'BLOCKED') return 80;
  if (holderAction === 'HOLD') return 50;
  return 20;
}

export function buildMinbeisHomeSummary(feed, positions = [], options = {}) {
  const now = Number(options.now || Date.now());
  const instrumentCapabilities = options.instrumentCapabilities && typeof options.instrumentCapabilities === 'object'
    ? options.instrumentCapabilities
    : {};
  const feedFresh = freshness(feed, now);
  const systemReady = operational(feed);
  const positionSymbols = new Set(
    (Array.isArray(positions) ? positions : [])
      .filter((position) => Number(position?.quantity || 0) > 0)
      .map((position) => canonicalSymbol(position?.symbol))
      .filter(Boolean),
  );

  const bySymbol = new Map();
  for (const item of allDossiers(feed)) {
    const symbol = canonicalSymbol(item?.symbol);
    if (!symbol || !positionSymbols.has(symbol)) continue;
    const current = bySymbol.get(symbol);
    const currentPriority = priorityFor(current);
    const nextPriority = priorityFor(item);
    if (!current || nextPriority > currentPriority) bySymbol.set(symbol, item);
  }

  const rows = [...bySymbol.entries()].map(([symbol, item]) => {
    const actionCurrent = finalActionIsCurrent(item?.finalAction, { now, feedFresh, systemReady });
    const classification = item?.minbeisAssessment?.classification || null;
    const holderAction = actionCurrent ? item?.finalAction?.holderAction || null : null;
    const blocked = item?.finalAction?.status === 'BLOCKED';
    const attention = holderAction === 'SELL_NOW'
      || holderAction === 'REDUCE'
      || classification === 'TRAP'
      || classification === 'CONFIRMATION_REQUIRED'
      || blocked;
    return {
      symbol,
      attention,
      holderAction,
      classification,
      blocked,
      current: actionCurrent,
    };
  });

  const coveredSymbols = new Set(rows.map((row) => row.symbol));
  const pendingSymbols = [...positionSymbols].filter((symbol) => !coveredSymbols.has(symbol));
  const capabilityFor = (symbol) => instrumentCapabilities[
    Object.keys(instrumentCapabilities).find((key) => canonicalSymbol(key) === symbol)
  ] || null;
  const queuedSymbols = pendingSymbols.filter((symbol) => capabilityFor(symbol)?.queueStatus === 'QUEUED');
  const identityBlockedSymbols = pendingSymbols.filter((symbol) => capabilityFor(symbol)?.onboardingStatus === 'IDENTITY_NOT_VERIFIED');
  const onboardingReadySymbols = pendingSymbols.filter((symbol) => {
    const item = capabilityFor(symbol);
    return item?.onboardingStatus === 'IDENTITY_VERIFIED_ANALYSIS_ONBOARDING_REQUIRED'
      && item?.queueStatus !== 'QUEUED'
      && item?.queueStatus !== 'COMPLETED';
  });
  const attentionRows = rows.filter((row) => row.attention).sort((a, b) => {
    const score = (row) => {
      if (row.holderAction === 'SELL_NOW' || row.holderAction === 'REDUCE') return 100;
      if (row.classification === 'TRAP') return 95;
      if (row.classification === 'CONFIRMATION_REQUIRED') return 85;
      if (row.blocked) return 80;
      return 0;
    };
    return score(b) - score(a) || a.symbol.localeCompare(b.symbol);
  });

  return {
    format: 'minbeis-home-summary',
    version: 1,
    feedFresh,
    systemReady,
    portfolioPositionCount: positionSymbols.size,
    coveredPositionCount: coveredSymbols.size,
    pendingPositionCount: pendingSymbols.length,
    queuedResearchCount: queuedSymbols.length,
    identityBlockedCount: identityBlockedSymbols.length,
    onboardingReadyCount: onboardingReadySymbols.length,
    attentionCount: attentionRows.length,
    attentionSymbols: attentionRows.slice(0, 5).map((row) => row.symbol),
    pendingSymbols: pendingSymbols.slice(0, 5),
    queuedResearchSymbols: queuedSymbols.slice(0, 5),
    identityBlockedSymbols: identityBlockedSymbols.slice(0, 5),
    state: !feed
      ? 'NO_FEED'
      : !feedFresh
        ? 'STALE'
        : !systemReady
          ? 'SYSTEM_LIMITED'
          : attentionRows.length
            ? 'ATTENTION'
            : pendingSymbols.length
              ? 'PENDING'
              : 'CLEAR',
  };
}
