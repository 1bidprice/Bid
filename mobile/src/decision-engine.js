export const DECISION_STORAGE_KEY = '@investor_control_decision_plans_v1';
export const DECISION_SETTINGS_KEY = '@investor_control_decision_settings_v1';
export const DECISION_FORMAT = 'investor-control-decision-os';
export const DECISION_VERSION = 2;

export const DEFAULT_DECISION_SETTINGS = Object.freeze({
  maxAllocationPct: 25,
  maxRiskPct: 2,
  reviewDays: 90,
});

const finite = (value) => Number.isFinite(Number(value));
const positive = (value) => finite(value) && Number(value) > 0;
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

export function normalizeDecisionSettings(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    maxAllocationPct: positive(source.maxAllocationPct)
      ? clamp(Number(source.maxAllocationPct), 1, 100)
      : DEFAULT_DECISION_SETTINGS.maxAllocationPct,
    maxRiskPct: positive(source.maxRiskPct)
      ? clamp(Number(source.maxRiskPct), 0.1, 100)
      : DEFAULT_DECISION_SETTINGS.maxRiskPct,
    reviewDays: positive(source.reviewDays)
      ? Math.round(clamp(Number(source.reviewDays), 7, 3650))
      : DEFAULT_DECISION_SETTINGS.reviewDays,
  };
}

export function nextReviewDate(reviewDays = DEFAULT_DECISION_SETTINGS.reviewDays, from = new Date()) {
  const date = new Date(from);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + normalizeDecisionSettings({ reviewDays }).reviewDays);
  return date.toISOString().slice(0, 10);
}

export function normalizePlans(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw)
      .filter(([symbol, plan]) => symbol && plan && typeof plan === 'object')
      .map(([symbol, plan]) => [String(symbol).toUpperCase(), {
        symbol: String(symbol).toUpperCase(),
        thesis: String(plan.thesis || ''),
        stop: positive(plan.stop) ? Number(plan.stop) : null,
        target: positive(plan.target) ? Number(plan.target) : null,
        reviewDate: String(plan.reviewDate || ''),
        proposedAmountEUR: positive(plan.proposedAmountEUR) ? Number(plan.proposedAmountEUR) : 0,
        updatedAt: plan.updatedAt || null,
      }]),
  );
}

export function positionsFromPortfolioState(state) {
  const ledger = {};
  const transactions = Array.isArray(state?.transactions) ? [...state.transactions] : [];

  transactions
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .forEach((transaction) => {
      if (!['buy', 'sell'].includes(transaction.type)) return;
      const symbol = String(transaction.symbol || '').trim().toUpperCase();
      const quantity = Number(transaction.quantity || 0);
      if (!symbol || quantity <= 0) return;

      const current = ledger[symbol] || {
        symbol,
        company: transaction.company || symbol,
        currency: transaction.currency || (symbol.endsWith('.US') ? 'USD' : 'EUR'),
        quantity: 0,
        cost: 0,
      };
      const total = finite(transaction.total)
        ? Number(transaction.total)
        : quantity * Number(transaction.price || 0) + Number(transaction.fees || 0);

      if (transaction.type === 'buy') {
        current.quantity += quantity;
        current.cost += total;
      } else if (current.quantity > 0) {
        const sold = Math.min(quantity, current.quantity);
        current.cost -= (current.cost / current.quantity) * sold;
        current.quantity -= sold;
      }
      ledger[symbol] = current;
    });

  return Object.values(ledger)
    .filter((position) => position.quantity > 0)
    .map((position) => {
      const quote = state?.prices?.[position.symbol];
      const usable = quote?.usable === true;
      const nativePrice = usable && positive(quote.nativePrice) ? Number(quote.nativePrice) : null;
      const eurPrice = usable && positive(quote.price) ? Number(quote.price) : null;
      const fxToEUR = nativePrice && eurPrice ? eurPrice / nativePrice : position.currency === 'EUR' ? 1 : null;
      const average = position.quantity > 0 ? position.cost / position.quantity : null;
      const valueEUR = eurPrice === null ? null : eurPrice * position.quantity;
      return {
        ...position,
        quote,
        nativePrice,
        eurPrice,
        fxToEUR,
        average,
        valueEUR,
      };
    });
}

export function portfolioSnapshot(state) {
  const positions = positionsFromPortfolioState(state);
  const valuesReady = positions.every((position) => finite(position.valueEUR));
  const totalValueEUR = positions.length === 0
    ? 0
    : valuesReady
      ? positions.reduce((sum, position) => sum + Number(position.valueEUR), 0)
      : null;
  return { positions, totalValueEUR };
}

const issue = (code, message, severity = 'warning') => ({ code, message, severity });

export function evaluateDecision(position, plan, totalValueEUR, settingsInput = DEFAULT_DECISION_SETTINGS) {
  const normalized = normalizePlans({ [position.symbol]: plan })[position.symbol] || {};
  const settings = normalizeDecisionSettings(settingsInput);
  const issues = [];
  const current = Number(position.nativePrice || 0);
  const currentEUR = Number(position.eurPrice || 0);
  const fxToEUR = Number(position.fxToEUR || (position.currency === 'EUR' ? 1 : 0));
  const stop = Number(normalized.stop || 0);
  const target = Number(normalized.target || 0);
  const proposedAmountEUR = Number(normalized.proposedAmountEUR || 0);
  const currentValueEUR = Number(position.valueEUR || 0);
  const portfolioValue = Number(totalValueEUR || 0);
  const currentWeightPct = portfolioValue > 0 ? (currentValueEUR / portfolioValue) * 100 : null;
  const projectedPortfolioValue = portfolioValue + proposedAmountEUR;
  const projectedWeightPct = projectedPortfolioValue > 0
    ? ((currentValueEUR + proposedAmountEUR) / projectedPortfolioValue) * 100
    : null;

  if (!normalized.thesis || normalized.thesis.trim().length < 20) {
    issues.push(issue('thesis', 'Η επενδυτική θέση δεν έχει καθαρή, συγκεκριμένη αιτιολόγηση.', 'block'));
  }
  if (!current || !currentEUR || !fxToEUR) {
    issues.push(issue('price', 'Δεν υπάρχει έγκυρη τρέχουσα τιμή για αξιόπιστο έλεγχο.', 'block'));
  }
  if (!stop) issues.push(issue('stop', 'Δεν έχει οριστεί τιμή ακύρωσης της επενδυτικής ιδέας.', 'block'));
  if (!target) issues.push(issue('target', 'Δεν έχει οριστεί ρεαλιστικός στόχος τιμής.', 'block'));
  if (!normalized.reviewDate) {
    issues.push(issue('review', 'Δεν έχει οριστεί αυτόματη ημερομηνία επανεξέτασης.'));
  }
  if (stop && current && stop >= current) {
    issues.push(issue('stop-invalid', 'Η τιμή ακύρωσης πρέπει να είναι χαμηλότερη από την τρέχουσα τιμή.', 'block'));
  }
  if (target && current && target <= current) {
    issues.push(issue('target-invalid', 'Ο στόχος πρέπει να είναι υψηλότερος από την τρέχουσα τιμή.', 'block'));
  }

  const riskPerShareEUR = current && stop && fxToEUR ? Math.max(0, current - stop) * fxToEUR : null;
  const rewardPerShareEUR = current && target && fxToEUR ? Math.max(0, target - current) * fxToEUR : null;
  const rewardRisk = riskPerShareEUR > 0 && rewardPerShareEUR !== null
    ? rewardPerShareEUR / riskPerShareEUR
    : null;
  const currentRiskEUR = riskPerShareEUR === null ? null : riskPerShareEUR * position.quantity;
  const proposedShares = proposedAmountEUR > 0 && currentEUR > 0 ? proposedAmountEUR / currentEUR : 0;
  const projectedRiskEUR = currentRiskEUR === null
    ? null
    : currentRiskEUR + proposedShares * Number(riskPerShareEUR || 0);
  const projectedRiskPct = projectedRiskEUR !== null && projectedPortfolioValue > 0
    ? (projectedRiskEUR / projectedPortfolioValue) * 100
    : null;

  if (rewardRisk !== null && rewardRisk < 1) {
    issues.push(issue('rr-block', `Η σχέση απόδοσης/κινδύνου είναι μόλις ${rewardRisk.toFixed(2)}.`, 'block'));
  } else if (rewardRisk !== null && rewardRisk < 2) {
    issues.push(issue('rr-warning', `Η σχέση απόδοσης/κινδύνου ${rewardRisk.toFixed(2)} είναι κάτω από το πειθαρχημένο όριο 2,00.`));
  }
  if (projectedWeightPct !== null && projectedWeightPct > settings.maxAllocationPct) {
    issues.push(issue('allocation-over', `Η θέση θα φτάσει ${projectedWeightPct.toFixed(1)}% ενώ το γενικό όριο είναι ${settings.maxAllocationPct.toFixed(1)}%.`, 'block'));
  }
  if (projectedRiskPct !== null && projectedRiskPct > settings.maxRiskPct) {
    issues.push(issue('risk-over', `Το κεφάλαιο σε κίνδυνο θα φτάσει ${projectedRiskPct.toFixed(2)}% του χαρτοφυλακίου, πάνω από το γενικό όριο ${settings.maxRiskPct.toFixed(2)}%.`, 'block'));
  }

  const today = new Date().toISOString().slice(0, 10);
  if (normalized.reviewDate && normalized.reviewDate < today) {
    issues.push(issue('review-overdue', 'Η ημερομηνία επανεξέτασης έχει περάσει.'));
  }

  const blocking = issues.filter((item) => item.severity === 'block');
  const warning = issues.filter((item) => item.severity !== 'block');
  const score = Math.max(0, 100 - blocking.length * 22 - warning.length * 8);
  const status = blocking.length ? 'blocked' : warning.length ? 'caution' : 'ready';

  return {
    status,
    score,
    issues,
    blocking,
    warning,
    currentWeightPct: currentWeightPct === null ? Number.NaN : currentWeightPct,
    projectedWeightPct: projectedWeightPct === null ? Number.NaN : projectedWeightPct,
    currentRiskEUR: currentRiskEUR === null ? Number.NaN : currentRiskEUR,
    projectedRiskEUR: projectedRiskEUR === null ? Number.NaN : projectedRiskEUR,
    projectedRiskPct: projectedRiskPct === null ? Number.NaN : projectedRiskPct,
    rewardRisk,
    proposedAmountEUR,
    reviewDate: normalized.reviewDate || null,
    settings,
    label: status === 'ready' ? 'ΠΕΡΝΑΕΙ' : status === 'caution' ? 'ΠΡΟΣΟΧΗ' : 'ΜΠΛΟΚΑΡΕΤΑΙ',
  };
}

export function decisionSummary(positions, plans, totalValueEUR, settings = DEFAULT_DECISION_SETTINGS) {
  return positions.map((position) => ({
    position,
    plan: plans[position.symbol] || null,
    result: evaluateDecision(position, plans[position.symbol] || {}, totalValueEUR, settings),
  }));
}
