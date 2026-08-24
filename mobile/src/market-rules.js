export const MARKET_RULES_VERSION = '2026-08-24.1';

export const MARKET_RULES = Object.freeze({
  US: Object.freeze({
    market: 'US',
    suffix: '.US',
    currency: 'USD',
    timeZone: 'America/New_York',
    sourceRoles: Object.freeze(['LICENSED_MARKET_DATA']),
    sessions: Object.freeze({
      preMarketStart: 4 * 60,
      regularStart: 9 * 60 + 30,
      regularEnd: 16 * 60,
      postMarketEnd: 20 * 60,
    }),
  }),
  GR: Object.freeze({
    market: 'GR',
    suffix: '.GR',
    currency: 'EUR',
    timeZone: 'Europe/Athens',
    sourceRoles: Object.freeze(['PRIMARY_EXCHANGE']),
    advertisedDelayMinutes: 15,
    sessions: Object.freeze({
      regularStart: 10 * 60 + 15,
      regularEnd: 17 * 60 + 20,
    }),
  }),
});

// Official Euronext Athens trading-calendar closures. Years not present here
// are treated as calendar-unverified so the app fails closed instead of
// inventing that the Greek market is open on a holiday.
export const ATHENS_MARKET_HOLIDAYS = Object.freeze({
  2026: Object.freeze([
    '2026-01-01',
    '2026-01-06',
    '2026-02-23',
    '2026-03-25',
    '2026-04-03',
    '2026-04-06',
    '2026-04-10',
    '2026-04-13',
    '2026-05-01',
    '2026-06-01',
    '2026-10-28',
    '2026-12-24',
    '2026-12-25',
  ]),
  2027: Object.freeze([
    '2027-01-01',
    '2027-01-06',
    '2027-03-15',
    '2027-03-25',
    '2027-03-26',
    '2027-03-29',
    '2027-04-30',
    '2027-05-03',
    '2027-06-21',
    '2027-10-28',
    '2027-12-24',
    '2027-12-31',
  ]),
});

function upper(value) {
  return String(value || '').trim().toUpperCase();
}

function zoneParts(timeZone, at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(at);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function marketRuleForSymbol(symbol) {
  const normalized = upper(symbol);
  for (const rule of Object.values(MARKET_RULES)) {
    if (normalized.endsWith(rule.suffix)) return rule;
  }
  return null;
}

export function marketRuleForMarket(market) {
  return MARKET_RULES[upper(market)] || null;
}

function closedState(rule, localDate, reason, calendarVerified = true) {
  return {
    market: rule.market,
    open: false,
    timeZone: rule.timeZone,
    localDate,
    session: 'closed',
    calendarVerified,
    holiday: reason === 'holiday',
    closeReason: reason,
  };
}

export function marketStateForSymbol(symbol, at = new Date()) {
  const rule = marketRuleForSymbol(symbol);
  if (!rule) {
    return {
      market: null,
      open: false,
      timeZone: null,
      localDate: null,
      session: 'unsupported',
      calendarVerified: false,
      holiday: false,
      closeReason: 'unsupported-market',
    };
  }

  const parts = zoneParts(rule.timeZone, at);
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  const weekday = parts.weekday;
  const weekdayOpen = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']).has(weekday);
  if (!weekdayOpen) return closedState(rule, localDate, 'weekend');

  if (rule.market === 'GR') {
    const holidays = ATHENS_MARKET_HOLIDAYS[Number(parts.year)];
    if (!holidays) return closedState(rule, localDate, 'calendar-unverified', false);
    if (holidays.includes(localDate)) return closedState(rule, localDate, 'holiday', true);
  }

  const minutes = Number(parts.hour) * 60 + Number(parts.minute) + Number(parts.second) / 60;
  if (rule.market === 'US') {
    if (minutes >= rule.sessions.preMarketStart && minutes < rule.sessions.regularStart) {
      return { market: rule.market, open: false, timeZone: rule.timeZone, localDate, session: 'pre-market', calendarVerified: null, holiday: false, closeReason: null };
    }
    if (minutes >= rule.sessions.regularStart && minutes < rule.sessions.regularEnd) {
      return { market: rule.market, open: true, timeZone: rule.timeZone, localDate, session: 'regular-market', calendarVerified: null, holiday: false, closeReason: null };
    }
    if (minutes >= rule.sessions.regularEnd && minutes < rule.sessions.postMarketEnd) {
      return { market: rule.market, open: false, timeZone: rule.timeZone, localDate, session: 'post-market', calendarVerified: null, holiday: false, closeReason: null };
    }
    return closedState(rule, localDate, 'outside-session', true);
  }

  if (rule.market === 'GR') {
    const open = minutes >= rule.sessions.regularStart && minutes < rule.sessions.regularEnd;
    if (open) {
      return { market: rule.market, open: true, timeZone: rule.timeZone, localDate, session: 'regular-market', calendarVerified: true, holiday: false, closeReason: null };
    }
    return closedState(rule, localDate, 'outside-session', true);
  }

  return closedState(rule, localDate, 'unsupported-market', false);
}

export function marketSessionForSymbol(symbol, at = new Date()) {
  return marketStateForSymbol(symbol, at).session;
}
