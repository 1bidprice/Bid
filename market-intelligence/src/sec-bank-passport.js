export const SEC_BANK_PASSPORT_VERSION = '2026-08-07.1';

const CONCEPTS = Object.freeze({
  loans: [
    'LoansAndLeasesReceivableNetReportedAmount',
    'FinancingReceivableExcludingAccruedInterestAfterAllowanceForCreditLoss',
    'LoansAndLeasesReceivableNetOfDeferredIncome',
  ],
  deposits: [
    'Deposits',
    'DepositsInDomesticOffices',
  ],
  allowance: [
    'AllowanceForCreditLossesFinancingReceivables',
    'AllowanceForLoanAndLeaseLosses',
    'FinancingReceivableAllowanceForCreditLoss',
  ],
  nonaccrualLoans: [
    'FinancingReceivableRecordedInvestmentNonaccrualStatus',
    'LoansAndLeasesReceivableNonaccrual',
  ],
});

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function normalizeEntry(entry, concept, unit) {
  const value = numeric(entry?.val);
  if (value === null || !entry?.end || !entry?.filed || !entry?.accn) return null;
  return {
    concept,
    unit,
    value,
    start: entry.start || null,
    end: entry.end,
    filed: entry.filed,
    accession: entry.accn,
    form: entry.form || null,
    fiscalYear: Number.isFinite(Number(entry.fy)) ? Number(entry.fy) : null,
    fiscalPeriod: entry.fp || null,
    frame: entry.frame || null,
    sourceRole: 'SEC_XBRL_COMPANYFACTS',
  };
}

function allowedForm(form) {
  return ['10-K', '10-K/A', '10-Q', '10-Q/A', '20-F', '20-F/A', '6-K'].includes(form);
}

function latestFromAliases(payload, aliases, units = ['USD']) {
  const namespace = payload?.facts?.['us-gaap'] || {};
  const candidates = [];
  for (const alias of aliases) {
    const fact = namespace[alias];
    if (!fact?.units) continue;
    for (const unit of units) {
      const entries = fact.units?.[unit];
      if (!Array.isArray(entries)) continue;
      for (const raw of entries) {
        if (!allowedForm(raw?.form)) continue;
        const entry = normalizeEntry(raw, alias, unit);
        if (entry) candidates.push(entry);
      }
    }
  }
  candidates.sort((a, b) => String(b.end).localeCompare(String(a.end)) || String(b.filed).localeCompare(String(a.filed)));
  const latestEnd = candidates[0]?.end || null;
  if (!latestEnd) return null;
  // Prefer the latest-filed fact for the latest reporting date. This avoids
  // silently mixing a stale concept alias with a newer quarter.
  return candidates
    .filter((entry) => entry.end === latestEnd)
    .sort((a, b) => String(b.filed).localeCompare(String(a.filed)))[0] || null;
}

function ratioPct(numerator, denominator) {
  const a = numeric(numerator?.value);
  const b = numeric(denominator?.value);
  return a !== null && b !== null && b !== 0 ? round((a / b) * 100) : null;
}

function coverage(items) {
  const entries = Object.entries(items);
  const available = entries.filter(([, value]) => value !== null && value !== undefined).map(([key]) => key);
  const missing = entries.filter(([, value]) => value === null || value === undefined).map(([key]) => key);
  return {
    availableCount: available.length,
    expectedCount: entries.length,
    score: round((available.length / Math.max(entries.length, 1)) * 100),
    available,
    missing,
  };
}

export function buildSecBankPassport(payload, baseSnapshot = {}, company = {}, options = {}) {
  const loans = latestFromAliases(payload, CONCEPTS.loans);
  const deposits = latestFromAliases(payload, CONCEPTS.deposits);
  const allowance = latestFromAliases(payload, CONCEPTS.allowance);
  const nonaccrualLoans = latestFromAliases(payload, CONCEPTS.nonaccrualLoans);
  const assets = baseSnapshot?.instant?.assets || null;
  const equity = baseSnapshot?.instant?.equity || null;
  const netIncome = baseSnapshot?.annual?.netIncome?.[0] || null;
  const dilutedShares = baseSnapshot?.annual?.dilutedShares?.[0] || null;

  const coreCoverage = coverage({ loans, deposits, assets, equity, netIncome, dilutedShares });
  const creditCoverage = coverage({ allowance, nonaccrualLoans });
  const loanToDepositPct = ratioPct(loans, deposits);
  const allowanceToLoansPct = ratioPct(allowance, loans);
  const nonaccrualToLoansPct = ratioPct(nonaccrualLoans, loans);
  const equityToAssetsPct = ratioPct(equity, assets);
  const annualNetIncomeToEndingEquityPct = ratioPct(netIncome, equity);
  const annualNetIncomeToEndingAssetsPct = ratioPct(netIncome, assets);

  const coreDataReady = coreCoverage.availableCount === coreCoverage.expectedCount && loanToDepositPct !== null && equityToAssetsPct !== null;
  const assetQualityReady = allowanceToLoansPct !== null && nonaccrualToLoansPct !== null;

  // Regulatory CET1/Tier-1 ratios are intentionally not inferred from balance
  // sheet proxies. They must arrive from a reviewed filing/table in a separate
  // evidence stage before the bank model can unlock a final investment action.
  const regulatoryCapital = options.regulatoryCapital || null;
  const regulatoryCapitalReady = Boolean(
    regulatoryCapital &&
    Number.isFinite(Number(regulatoryCapital.commonEquityTier1Pct)) &&
    Number.isFinite(Number(regulatoryCapital.tier1CapitalPct)) &&
    Number.isFinite(Number(regulatoryCapital.totalCapitalPct)),
  );

  const decisionReady = coreDataReady && assetQualityReady && regulatoryCapitalReady;

  return {
    format: 'investor-control-sec-bank-passport',
    version: 1,
    policyVersion: SEC_BANK_PASSPORT_VERSION,
    companyId: company?.companyId || baseSnapshot?.companyId || null,
    companyName: company?.displayName || company?.legalName || baseSnapshot?.companyName || null,
    generatedAt: new Date(options.generatedAt || baseSnapshot?.generatedAt || Date.now()).toISOString(),
    sourceUrl: baseSnapshot?.sourceUrl || null,
    status: decisionReady ? 'DECISION_MODEL_READY' : coreDataReady ? 'BANK_MODEL_PARTIAL' : 'INSUFFICIENT_BANK_DATA',
    facts: {
      loans,
      deposits,
      allowanceForCreditLosses: allowance,
      nonaccrualLoans,
      assets,
      equity,
      annualNetIncome: netIncome,
      dilutedShares,
    },
    metrics: {
      loanToDepositPct,
      allowanceToLoansPct,
      nonaccrualToLoansPct,
      equityToAssetsPct,
      annualNetIncomeToEndingEquityPct,
      annualNetIncomeToEndingAssetsPct,
    },
    coverage: {
      core: coreCoverage,
      assetQuality: creditCoverage,
      coreDataReady,
      assetQualityReady,
      regulatoryCapitalReady,
    },
    regulatoryCapital,
    modelReady: decisionReady,
    decisionReady,
    blockers: [
      ...(!coreDataReady ? ['BANK_CORE_FACTS_REQUIRED'] : []),
      ...(!assetQualityReady ? ['BANK_ASSET_QUALITY_REQUIRED'] : []),
      ...(!regulatoryCapitalReady ? ['BANK_REGULATORY_CAPITAL_REQUIRED'] : []),
    ],
    accountingPolicy: {
      genericPriceToSalesAllowed: false,
      genericFreeCashFlowRunwayAllowed: false,
      genericLiabilitiesToAssetsRiskAllowed: false,
      endingBalanceProfitabilityRatiosAreApproximate: true,
      regulatoryCapitalMayBeInferredFromEquityRatio: false,
    },
  };
}
