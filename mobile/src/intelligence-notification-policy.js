export const NOTIFICATION_POLICY_VERSION = '2026-09-13.1';
export const MAX_ACTION_STATE_ENTRIES = 300;

export const NOTIFICATION_ACTIONS = Object.freeze({
  BUY_NOW: 'BUY_NOW',
  SELL_NOW: 'SELL_NOW',
  HOLD: 'HOLD',
  WATCH: 'WATCH',
});

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

export function canonicalNotificationSymbol(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\.(US|GR)$/i, '');
}

function decisionKey(item) {
  const companyId = String(item?.companyId || '').trim();
  if (companyId) return companyId;
  const symbol = canonicalNotificationSymbol(item?.symbol);
  return symbol ? `symbol:${symbol}` : null;
}

export function ownedSymbolSet(openPositions) {
  return new Set(
    safeArray(openPositions)
      .filter((position) => Number(position?.quantity || 0) > 0)
      .map((position) => canonicalNotificationSymbol(position?.symbol))
      .filter(Boolean),
  );
}

function effectiveDecision(item, heldSymbols, options = {}) {
  const finalAction = item?.finalAction;
  if (finalAction?.status !== 'FINAL') return null;
  if (typeof options.isCurrentDecision !== 'function') return null;
  if (options.isCurrentDecision(finalAction, item) !== true) return null;

  const symbol = canonicalNotificationSymbol(item?.symbol);
  if (!symbol) return null;
  const owned = heldSymbols.has(symbol);
  const action = owned ? finalAction.holderAction : finalAction.nonHolderAction;
  const label = owned ? finalAction.holderActionLabel : finalAction.nonHolderActionLabel;
  if (!action) return null;

  return {
    key: decisionKey(item),
    companyId: item?.companyId || null,
    symbol,
    displaySymbol: String(item?.symbol || symbol).trim().toUpperCase(),
    companyName: item?.companyName || item?.name || item?.symbol || symbol,
    owned,
    action,
    label: label || action,
    urgency: finalAction.urgency || 'NONE',
    validUntil: finalAction.validUntil || null,
  };
}

export function buildDecisionSnapshot(feed, openPositions, options = {}) {
  const heldSymbols = ownedSymbolSet(openPositions);
  const decisions = safeArray(feed?.decisions)
    .map((item) => effectiveDecision(item, heldSymbols, options))
    .filter((item) => item?.key);

  return Object.fromEntries(decisions.map((item) => [item.key, {
    action: item.action,
    owned: item.owned,
    symbol: item.symbol,
  }]));
}

function notificationPriority(event) {
  if (event.kind === 'OWNED_SELL') return 100;
  if (event.kind === 'OWNED_HOLD_RECOVERY') return 80;
  if (event.kind === 'NEW_BUY') return 70;
  return 0;
}

export function buildDecisionChangeEvents(feed, openPositions, previousSnapshot = {}, options = {}) {
  const heldSymbols = ownedSymbolSet(openPositions);
  const currentSnapshot = {};
  const events = [];

  for (const item of safeArray(feed?.decisions)) {
    const decision = effectiveDecision(item, heldSymbols, options);
    if (!decision?.key) continue;
    currentSnapshot[decision.key] = {
      action: decision.action,
      owned: decision.owned,
      symbol: decision.symbol,
    };

    const previous = previousSnapshot?.[decision.key] || null;
    const unchanged = previous
      && previous.action === decision.action
      && Boolean(previous.owned) === decision.owned;
    if (unchanged) continue;

    if (decision.owned && decision.action === NOTIFICATION_ACTIONS.SELL_NOW) {
      events.push({
        ...decision,
        kind: 'OWNED_SELL',
        title: 'Σημαντική αλλαγή σε θέση σου',
        body: `${decision.companyName}: ${decision.label}`,
      });
      continue;
    }

    if (!decision.owned && decision.action === NOTIFICATION_ACTIONS.BUY_NOW) {
      events.push({
        ...decision,
        kind: 'NEW_BUY',
        title: 'Νέα επιβεβαιωμένη ευκαιρία',
        body: `${decision.companyName}: ${decision.label}`,
      });
      continue;
    }

    if (
      decision.owned
      && decision.action === NOTIFICATION_ACTIONS.HOLD
      && previous?.owned === true
      && previous?.action === NOTIFICATION_ACTIONS.SELL_NOW
    ) {
      events.push({
        ...decision,
        kind: 'OWNED_HOLD_RECOVERY',
        title: 'Νέα αξιολόγηση θέσης',
        body: `${decision.companyName}: ${decision.label} — το προηγούμενο σήμα πώλησης δεν ισχύει πλέον.`,
      });
    }
  }

  events.sort((a, b) => notificationPriority(b) - notificationPriority(a));
  return { events, currentSnapshot };
}

export function buildNotificationPayload(eventsInput) {
  const events = safeArray(eventsInput).filter(Boolean);
  if (!events.length) return null;
  if (events.length === 1) {
    const event = events[0];
    return {
      title: event.title,
      body: event.body,
      data: { type: event.kind, symbol: event.displaySymbol || event.symbol },
    };
  }

  const ownedSellCount = events.filter((event) => event.kind === 'OWNED_SELL').length;
  const first = events[0];
  const extra = events.length - 1;
  return {
    title: ownedSellCount > 0
      ? ownedSellCount === 1
        ? 'Ενέργεια σε θέση σου'
        : `Ενέργεια σε ${ownedSellCount} θέσεις σου`
      : `${events.length} νέες σημαντικές επενδυτικές αλλαγές`,
    body: `${first.body} · +${extra} ακόμη`,
    data: { type: 'INTELLIGENCE_DIGEST', count: events.length },
  };
}

export function mergeActionSnapshots(previousSnapshot, currentSnapshot) {
  const merged = { ...(previousSnapshot || {}) };
  for (const [key, value] of Object.entries(currentSnapshot || {})) {
    delete merged[key];
    merged[key] = value;
  }
  const entries = Object.entries(merged);
  if (entries.length <= MAX_ACTION_STATE_ENTRIES) return merged;
  return Object.fromEntries(entries.slice(entries.length - MAX_ACTION_STATE_ENTRIES));
}
