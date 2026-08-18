const SESSION_CONFIG = Object.freeze({
  XNYS: { timeZone: 'America/New_York', openMinute: 9 * 60 + 30, closeMinute: 16 * 60, closeReferenceMinute: 15 * 60 + 45 },
  XNAS: { timeZone: 'America/New_York', openMinute: 9 * 60 + 30, closeMinute: 16 * 60, closeReferenceMinute: 15 * 60 + 45 },
  ARCX: { timeZone: 'America/New_York', openMinute: 9 * 60 + 30, closeMinute: 16 * 60, closeReferenceMinute: 15 * 60 + 45 },
  XATH: { timeZone: 'Europe/Athens', openMinute: 10 * 60 + 15, closeMinute: 17 * 60 + 20, closeReferenceMinute: 17 * 60 + 5 },
});

function micOf(company = {}) {
  const mic = String(company?.primaryListing?.mic || '').trim().toUpperCase();
  if (SESSION_CONFIG[mic]) return mic;
  const exchange = String(company?.primaryListing?.exchange || '').toUpperCase();
  if (exchange.includes('ATHENS')) return 'XATH';
  if (exchange.includes('NASDAQ')) return 'XNAS';
  if (exchange.includes('NEW YORK') || exchange === 'NYSE') return 'XNYS';
  return null;
}

function parts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const mapped = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(mapped.year),
    month: Number(mapped.month),
    day: Number(mapped.day),
    weekday: weekdayMap[mapped.weekday],
    minuteOfDay: Number(mapped.hour) * 60 + Number(mapped.minute),
    dateKey: `${mapped.year}-${mapped.month}-${mapped.day}`,
  };
}

function isWeekday(day) {
  return day >= 1 && day <= 5;
}

function addCalendarDay(dateKey, amount) {
  const [year, month, day] = String(dateKey).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount, 12, 0, 0));
  return date.toISOString().slice(0, 10);
}

function weekdayForDateKey(dateKey) {
  const [year, month, day] = String(dateKey).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay();
}

function interveningExpectedWeekdays(quoteDateKey, checkDateKey) {
  let cursor = addCalendarDay(quoteDateKey, 1);
  let count = 0;
  let guard = 0;
  while (cursor < checkDateKey && guard < 14) {
    if (isWeekday(weekdayForDateKey(cursor))) count += 1;
    cursor = addCalendarDay(cursor, 1);
    guard += 1;
  }
  return count;
}

export function evaluateMarketSession(company = {}, at = new Date()) {
  const mic = micOf(company);
  const config = mic ? SESSION_CONFIG[mic] : null;
  const date = new Date(at);
  if (!config || Number.isNaN(date.getTime())) {
    return {
      mic,
      knownSession: false,
      state: 'UNKNOWN',
      coreOpen: false,
      expectedClosed: false,
      timeZone: null,
    };
  }

  const local = parts(date, config.timeZone);
  if (!isWeekday(local.weekday)) {
    return {
      mic,
      knownSession: true,
      state: 'WEEKEND',
      coreOpen: false,
      expectedClosed: true,
      timeZone: config.timeZone,
      local,
    };
  }
  if (local.minuteOfDay < config.openMinute) {
    return {
      mic,
      knownSession: true,
      state: 'PRE_OPEN',
      coreOpen: false,
      expectedClosed: true,
      timeZone: config.timeZone,
      local,
    };
  }
  if (local.minuteOfDay >= config.closeMinute) {
    return {
      mic,
      knownSession: true,
      state: 'AFTER_CLOSE',
      coreOpen: false,
      expectedClosed: true,
      timeZone: config.timeZone,
      local,
    };
  }
  return {
    mic,
    knownSession: true,
    state: 'CORE_OPEN_EXPECTED',
    coreOpen: true,
    expectedClosed: false,
    timeZone: config.timeZone,
    local,
  };
}

export function evaluateClosedMarketCarry(company = {}, quoteAt, checkedAt, options = {}) {
  const quoteDate = new Date(quoteAt);
  const checkDate = new Date(checkedAt);
  const maxAgeHours = Number(options.maxAgeHours ?? 120);
  const ageHours = Number.isNaN(quoteDate.getTime()) || Number.isNaN(checkDate.getTime())
    ? null
    : Math.max(0, (checkDate.getTime() - quoteDate.getTime()) / 3_600_000);
  const session = evaluateMarketSession(company, checkDate);
  const mic = session.mic;
  const config = mic ? SESSION_CONFIG[mic] : null;

  if (!config || ageHours === null || ageHours > maxAgeHours || !session.expectedClosed) {
    return { eligible: false, ageHours, session, reason: !config ? 'SESSION_UNKNOWN' : ageHours === null ? 'TIMESTAMP_INVALID' : ageHours > maxAgeHours ? 'CARRY_WINDOW_EXCEEDED' : 'MARKET_NOT_EXPECTED_CLOSED' };
  }

  const quoteLocal = parts(quoteDate, config.timeZone);
  const checkLocal = parts(checkDate, config.timeZone);
  if (!isWeekday(quoteLocal.weekday)) {
    return { eligible: false, ageHours, session, reason: 'QUOTE_NOT_FROM_WEEKDAY_SESSION' };
  }
  if (quoteLocal.minuteOfDay < config.closeReferenceMinute) {
    return { eligible: false, ageHours, session, reason: 'QUOTE_NOT_CLOSE_REFERENCE' };
  }

  const interveningWeekdays = interveningExpectedWeekdays(quoteLocal.dateKey, checkLocal.dateKey);
  if (interveningWeekdays > 0) {
    return { eligible: false, ageHours, session, reason: 'EXPECTED_SESSION_INTERVENED', interveningWeekdays };
  }

  if (quoteLocal.dateKey === checkLocal.dateKey && session.state === 'PRE_OPEN') {
    return { eligible: false, ageHours, session, reason: 'SAME_DAY_PRE_OPEN_QUOTE_INVALID' };
  }

  return {
    eligible: true,
    ageHours,
    session,
    reason: 'LAST_VERIFIED_CLOSE_DURING_EXPECTED_CLOSURE',
    quoteLocalDate: quoteLocal.dateKey,
    checkLocalDate: checkLocal.dateKey,
  };
}

export const MARKET_SESSION_POLICY_VERSION = '2026-08-08.1';
