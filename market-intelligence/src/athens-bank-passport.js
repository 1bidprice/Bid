export const ATHENS_BANK_PASSPORT_VERSION = '2026-08-07.1';

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[’']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function parseLocalizedNumber(token) {
  let raw = String(token || '').trim();
  if (!raw || raw === '-' || raw === '—') return null;
  const negative = /^\(.*\)$/.test(raw) || /^-/.test(raw);
  raw = raw.replace(/[()€$£%\s]/g, '').replace(/^[-+]/, '');
  if (!raw || !/[0-9]/.test(raw)) return null;

  const commaCount = (raw.match(/,/g) || []).length;
  const dotCount = (raw.match(/\./g) || []).length;
  if (commaCount && dotCount) {
    const decimalComma = raw.lastIndexOf(',') > raw.lastIndexOf('.');
    raw = decimalComma ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
  } else if (commaCount) {
    const parts = raw.split(',');
    if (parts.length === 2 && parts[1].length <= 4) raw = `${parts[0].replace(/\./g, '')}.${parts[1]}`;
    else raw = raw.replace(/,/g, '');
  } else if (dotCount) {
    if (/^\d{1,3}(?:\.\d{3})+$/.test(raw) || dotCount > 1) raw = raw.replace(/\./g, '');
  }

  const value = Number(raw.replace(/[^0-9.]/g, ''));
  return Number.isFinite(value) ? (negative ? -value : value) : null;
}

function amountTokens(line) {
  return (String(line || '').match(/\(?[-+]?\d[\d.,]*\)?/g) || [])
    .map((raw) => ({ raw, value: parseLocalizedNumber(raw) }))
    .filter((item) => item.value !== null);
}

function percentTokens(line) {
  return (String(line || '').match(/[-+]?\d{1,3}(?:[.,]\d+)?\s*%/g) || [])
    .map((raw) => ({ raw, value: parseLocalizedNumber(raw) }))
    .filter((item) => item.value !== null);
}

function pageScale(page) {
  const value = normalize(page);
  if (/ποσα σε χιλ|amounts? in thousand|figures? in thousand|eur ['’]?000/.test(value)) return 1_000;
  if (/ποσα σε εκατ|amounts? in million|figures? in million|eur mn/.test(value)) return 1_000_000;
  return 1;
}

function statementPage(page) {
  const value = normalize(page);
  return /ενδιαμεση συνοπτικη χρηματοοικονομικη πληροφορηση|interim condensed financial|interim financial information|financial statements/.test(value);
}

function groupBankPage(page) {
  const value = normalize(page);
  return /ομιλος/.test(value) && /τραπεζα/.test(value) || /\bgroup\b/.test(value) && /\bbank\b|\bcompany\b/.test(value);
}

function moneyFact(concept, value, pageNumber, line, scale, extra = {}) {
  const numeric = finite(value);
  if (numeric === null) return null;
  return {
    concept,
    unit: 'EUR',
    value: numeric * scale,
    ...extra,
    provenance: {
      pageNumber,
      extractedLine: String(line || '').trim(),
      sourceRole: 'PRIMARY_EXCHANGE_FINANCIAL_DOCUMENT',
      extractionPolicy: 'ATHENS_BANK_STATEMENT_ROW_V1',
      statementScope: 'GROUP',
      ...(extra.provenance || {}),
    },
  };
}

function shareFact(value, pageNumber, excerpt) {
  const numeric = finite(value);
  if (numeric === null || numeric < 1_000) return null;
  return {
    concept: 'SharesOutstandingAtPeriodEnd',
    unit: 'shares',
    value: Math.round(numeric),
    provenance: {
      pageNumber,
      extractedLine: String(excerpt || '').trim(),
      sourceRole: 'PRIMARY_EXCHANGE_FINANCIAL_DOCUMENT',
      extractionPolicy: 'ATHENS_BANK_SHARE_CAPITAL_NOTE_V1',
      statementScope: 'BANK',
    },
  };
}

function ratioFact(concept, value, pageNumber, line, extra = {}) {
  const numeric = finite(value);
  if (numeric === null) return null;
  return {
    concept,
    unit: 'percent',
    value: numeric,
    ...extra,
    provenance: {
      pageNumber,
      extractedLine: String(line || '').trim(),
      sourceRole: 'PRIMARY_EXCHANGE_FINANCIAL_DOCUMENT',
      extractionPolicy: 'ATHENS_BANK_REGULATORY_RATIO_V1',
      statementScope: 'GROUP',
      ...(extra.provenance || {}),
    },
  };
}

function matchesAny(value, patterns) {
  return patterns.some((pattern) => pattern.test(value));
}

function findGroupFourColumnRow(pages, patterns, options = {}) {
  const exclude = options.exclude || [];
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = String(pages[pageIndex] || '');
    if (!statementPage(page) || !groupBankPage(page)) continue;
    if (options.pagePattern && !options.pagePattern.test(normalize(page))) continue;
    const lines = page.split(/\n/);
    for (const line of lines) {
      const value = normalize(line);
      if (!matchesAny(value, patterns) || exclude.some((pattern) => pattern.test(value))) continue;
      const numbers = amountTokens(line);
      if (numbers.length < 4) continue;
      const selected = numbers.slice(-4);
      return {
        pageNumber: pageIndex + 1,
        line,
        scale: pageScale(page),
        groupCurrent: selected[0].value,
        groupPrevious: selected[1].value,
        bankCurrent: selected[2].value,
        bankPrevious: selected[3].value,
      };
    }
  }
  return null;
}

function dateNeedles(periodEnd) {
  const match = String(periodEnd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return [];
  const [, year, month, day] = match;
  const d = String(Number(day));
  const m = String(Number(month));
  return [`${d}/${m}/${year}`, `${day}/${month}/${year}`, `${d}-${m}-${year}`, `${day}-${month}-${year}`];
}

function findStage3GroupTable(pages, periodEnd) {
  const needles = dateNeedles(periodEnd);
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = String(pages[pageIndex] || '');
    const value = normalize(page);
    if (!statementPage(page) || !/\bstage 1\b/.test(value) || !/\bstage 2\b/.test(value) || !/\bstage 3\b/.test(value)) continue;
    if (!/ομιλος|\bgroup\b/.test(value) || !/συνολο δανειων|total loans/.test(value)) continue;
    if (needles.length && !needles.some((needle) => page.includes(needle))) continue;
    const lines = page.split(/\n/);
    const grossLine = lines.find((line) => /^(συνολικη αξια προ απομειωσης|total gross carrying amount|total gross loans)/.test(normalize(line)) && amountTokens(line).length >= 4);
    const allowanceLine = lines.find((line) => /^(συνολικη προβλεψη απομειωσης|total impairment allowance|total credit loss allowance)/.test(normalize(line)) && amountTokens(line).length >= 4);
    if (!grossLine || !allowanceLine) continue;
    const gross = amountTokens(grossLine).slice(-4).map((item) => item.value);
    const allowance = amountTokens(allowanceLine).slice(-4).map((item) => item.value);
    const scale = pageScale(page);
    return {
      pageNumber: pageIndex + 1,
      scale,
      grossLine,
      allowanceLine,
      gross: { stage1: gross[0], stage2: gross[1], stage3: gross[2], total: gross[3] },
      allowance: { stage1: allowance[0], stage2: allowance[1], stage3: allowance[2], total: allowance[3] },
    };
  }
  return null;
}

function capitalRow(pages, patterns) {
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = String(pages[pageIndex] || '');
    const value = normalize(page);
    if (!statementPage(page) || !groupBankPage(page)) continue;
    if (!/κεφαλαι|capital/.test(value)) continue;
    for (const line of page.split(/\n/)) {
      const normalizedLine = normalize(line);
      if (!matchesAny(normalizedLine, patterns)) continue;
      const values = percentTokens(line);
      if (values.length < 4) continue;
      return { pageNumber: pageIndex + 1, line, values: values.slice(-4).map((item) => item.value) };
    }
  }
  return null;
}

function findCapitalRequirements(pages) {
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = String(pages[pageIndex] || '');
    const normalizedPage = normalize(page);
    const markerMatch = normalizedPage.match(/συνολικες ελαχιστες κεφαλαιακες απαιτησεις|overall capital requirement|total srep capital requirements/);
    if (!markerMatch) continue;
    const marker = markerMatch.index ?? 0;
    const normalizedSlice = normalizedPage.slice(marker, marker + 3500);
    const originalLines = page.split(/\n/);
    const lineCandidates = originalLines.filter((line) => {
      const n = normalize(line);
      return normalizedSlice.includes(n) && percentTokens(line).length >= 1;
    });
    const find = (patterns) => {
      const line = lineCandidates.find((candidate) => matchesAny(normalize(candidate), patterns));
      const value = line ? percentTokens(line)[0]?.value ?? null : null;
      return line && value !== null ? { pageNumber: pageIndex + 1, line, value } : null;
    };
    const cet1 = find([/cet\s*1|cet1|κεφαλαιου κοινων μετοχων.*κατηγοριας 1/]);
    const tier1 = find([/tier\s*1|κεφαλαιου της κατηγοριας 1/]);
    const total = find([/total capital ratio|συνολικ.*δεικτ.*κεφαλ/]);
    if (cet1 && tier1 && total) return { cet1, tier1, total };
  }
  return null;
}

function findSharesOutstanding(pages, periodEnd) {
  const needles = dateNeedles(periodEnd);
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = String(pages[pageIndex] || '');
    const value = normalize(page);
    if (!statementPage(page) || !/μετοχικο κεφαλαιο|share capital/.test(value)) continue;
    if (needles.length && !needles.some((needle) => page.includes(needle)) && !value.includes('30/06/2026')) {
      // Period-end share notes may spell the date differently; do not reject the
      // page solely for that reason when the note explicitly states the share count.
    }
    const greek = page.match(/\(([\d.]+)\)\s*κοιν[εέ]ς[\s\S]{0,120}?μετοχ/iu);
    const english = page.match(/\(([\d,]+)\)\s*(?:ordinary|common)[\s\S]{0,120}?shares?/i);
    const match = greek || english;
    if (!match) continue;
    const valueNumber = parseLocalizedNumber(match[1]);
    if (!Number.isFinite(valueNumber) || valueNumber < 1_000) continue;
    const start = Math.max(0, match.index - 100);
    const excerpt = page.slice(start, Math.min(page.length, match.index + match[0].length + 100)).replace(/\s+/g, ' ').trim();
    return shareFact(valueNumber, pageIndex + 1, excerpt);
  }
  return null;
}

function ratioPct(numerator, denominator) {
  const a = finite(numerator?.value ?? numerator);
  const b = finite(denominator?.value ?? denominator);
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

function validCapitalRatio(value) {
  const ratio = finite(value);
  return ratio !== null && ratio >= 3 && ratio <= 50;
}

function bankRiskAssessment(metrics, regulatoryCapital, facts) {
  if (!regulatoryCapital?.dataReady) return { score: null, flags: ['BANK_CAPITAL_DATA_INCOMPLETE'], policyVersion: ATHENS_BANK_PASSPORT_VERSION };
  const flags = [];
  let score = 25;
  const minimumBuffer = Math.min(
    regulatoryCapital.buffersPct?.cet1 ?? Number.POSITIVE_INFINITY,
    regulatoryCapital.buffersPct?.tier1 ?? Number.POSITIVE_INFINITY,
    regulatoryCapital.buffersPct?.total ?? Number.POSITIVE_INFINITY,
  );
  if (regulatoryCapital.compliant === false) {
    flags.push('BANK_CAPITAL_BELOW_REQUIREMENT');
    score += 50;
  } else if (minimumBuffer < 2) {
    flags.push('BANK_THIN_CAPITAL_BUFFER');
    score += 25;
  } else if (minimumBuffer < 4) {
    flags.push('BANK_MODERATE_CAPITAL_BUFFER');
    score += 12;
  }

  if (finite(metrics.stage3GrossLoansPct) !== null && metrics.stage3GrossLoansPct > 8) {
    flags.push('BANK_HIGH_STAGE3_LOANS');
    score += 25;
  } else if (finite(metrics.stage3GrossLoansPct) !== null && metrics.stage3GrossLoansPct > 5) {
    flags.push('BANK_ELEVATED_STAGE3_LOANS');
    score += 15;
  }

  if (finite(metrics.loanToDepositPct) !== null && metrics.loanToDepositPct > 120) {
    flags.push('BANK_VERY_HIGH_LOAN_TO_DEPOSIT');
    score += 20;
  } else if (finite(metrics.loanToDepositPct) !== null && metrics.loanToDepositPct > 100) {
    flags.push('BANK_HIGH_LOAN_TO_DEPOSIT');
    score += 10;
  }

  if (finite(facts?.periodNetIncome?.value) !== null && facts.periodNetIncome.value < 0) {
    flags.push('BANK_NEGATIVE_PERIOD_PROFIT');
    score += 20;
  }
  if (finite(metrics.periodNetIncomeToEndingEquityPct) !== null && metrics.periodNetIncomeToEndingEquityPct < 0) {
    flags.push('BANK_NEGATIVE_PERIOD_ROE');
    score += 15;
  }

  return {
    score: Math.min(100, score),
    flags,
    policyVersion: ATHENS_BANK_PASSPORT_VERSION,
    methodology: 'CONSERVATIVE_BANK_SCREEN_V1',
  };
}

export function buildAthensBankPassport(pagesInput, baseSnapshot = {}, company = {}, options = {}) {
  const pages = Array.isArray(pagesInput) ? pagesInput.map((page) => typeof page === 'string' ? page : page?.text || '') : [];
  const periodEnd = baseSnapshot?.reporting?.periodEnd || baseSnapshot?.sourceDocument?.period?.periodEnd || null;

  const assetsRow = findGroupFourColumnRow(pages, [/^συνολο ενεργητικου(?:\s|$)/, /^total assets(?:\s|$)/]);
  const equityRow = findGroupFourColumnRow(pages, [/^συνολο ιδιων κεφαλαιων(?:\s|$)/, /^total equity(?:\s|$)/], { exclude: [/ιδιοκτητων μητρικης/, /owners of parent/] });
  const depositsRow = findGroupFourColumnRow(pages, [/^υποχρεωσεις προς πελατες(?:\s|$)/, /^customer deposits(?:\s|$)/, /^deposits from customers(?:\s|$)/]);
  const profitRow = findGroupFourColumnRow(pages, [/^κερδη περιοδου μετα απο φορ/, /^κερδη περιοδου μετα φορ/, /^profit for the period after tax/, /^net profit for the period/]);
  const stage = findStage3GroupTable(pages, periodEnd);
  const sharesOutstanding = findSharesOutstanding(pages, periodEnd);

  const assets = assetsRow ? moneyFact('BankAssets', assetsRow.groupCurrent, assetsRow.pageNumber, assetsRow.line, assetsRow.scale) : null;
  const equity = equityRow ? moneyFact('BankEquity', equityRow.groupCurrent, equityRow.pageNumber, equityRow.line, equityRow.scale) : null;
  const deposits = depositsRow ? moneyFact('CustomerDeposits', depositsRow.groupCurrent, depositsRow.pageNumber, depositsRow.line, depositsRow.scale) : null;
  const periodNetIncome = profitRow ? moneyFact('PeriodNetIncome', profitRow.groupCurrent, profitRow.pageNumber, profitRow.line, profitRow.scale) : null;
  const grossLoans = stage ? moneyFact('GrossCustomerLoans', stage.gross.total, stage.pageNumber, stage.grossLine, stage.scale, { provenance: { tablePolicy: 'GROUP_STAGE_TOTAL_V1' } }) : null;
  const stage3GrossLoans = stage ? moneyFact('Stage3GrossCustomerLoans', stage.gross.stage3, stage.pageNumber, stage.grossLine, stage.scale, { provenance: { tablePolicy: 'GROUP_STAGE_TOTAL_V1' } }) : null;
  const allowanceForCreditLosses = stage ? moneyFact('AllowanceForCreditLosses', Math.abs(stage.allowance.total), stage.pageNumber, stage.allowanceLine, stage.scale, { provenance: { tablePolicy: 'GROUP_STAGE_TOTAL_V1' } }) : null;
  const stage3Allowance = stage ? moneyFact('Stage3AllowanceForCreditLosses', Math.abs(stage.allowance.stage3), stage.pageNumber, stage.allowanceLine, stage.scale, { provenance: { tablePolicy: 'GROUP_STAGE_TOTAL_V1' } }) : null;

  const cet1Row = capitalRow(pages, [/cet\s*1|cet1|κεφαλαιου κοινων μετοχων.*κατηγοριας 1/]);
  const tier1Row = capitalRow(pages, [/tier\s*1|κεφαλαιου κατηγοριας 1/]);
  const totalCapitalRow = capitalRow(pages, [/total capital ratio|συνολικ.*δεικτ.*κεφαλ/]);
  const capitalRequirements = findCapitalRequirements(pages);

  const commonEquityTier1 = cet1Row ? ratioFact('CommonEquityTier1Pct', cet1Row.values[0], cet1Row.pageNumber, cet1Row.line) : null;
  const tier1Capital = tier1Row ? ratioFact('Tier1CapitalPct', tier1Row.values[0], tier1Row.pageNumber, tier1Row.line) : null;
  const totalCapital = totalCapitalRow ? ratioFact('TotalCapitalPct', totalCapitalRow.values[0], totalCapitalRow.pageNumber, totalCapitalRow.line) : null;
  const requiredCet1 = capitalRequirements?.cet1 ? ratioFact('RequiredCommonEquityTier1Pct', capitalRequirements.cet1.value, capitalRequirements.cet1.pageNumber, capitalRequirements.cet1.line, { provenance: { regulatoryRequirement: true } }) : null;
  const requiredTier1 = capitalRequirements?.tier1 ? ratioFact('RequiredTier1CapitalPct', capitalRequirements.tier1.value, capitalRequirements.tier1.pageNumber, capitalRequirements.tier1.line, { provenance: { regulatoryRequirement: true } }) : null;
  const requiredTotal = capitalRequirements?.total ? ratioFact('RequiredTotalCapitalPct', capitalRequirements.total.value, capitalRequirements.total.pageNumber, capitalRequirements.total.line, { provenance: { regulatoryRequirement: true } }) : null;

  const actualCapitalValues = [commonEquityTier1?.value, tier1Capital?.value, totalCapital?.value];
  const requiredCapitalValues = [requiredCet1?.value, requiredTier1?.value, requiredTotal?.value];
  const capitalRatiosValid = actualCapitalValues.every(validCapitalRatio) && totalCapital.value >= tier1Capital.value && tier1Capital.value >= commonEquityTier1.value;
  const requirementsValid = requiredCapitalValues.every(validCapitalRatio) && requiredTotal.value >= requiredTier1.value && requiredTier1.value >= requiredCet1.value;
  const capitalDataReady = capitalRatiosValid && requirementsValid;
  const buffersPct = capitalDataReady ? {
    cet1: round(commonEquityTier1.value - requiredCet1.value),
    tier1: round(tier1Capital.value - requiredTier1.value),
    total: round(totalCapital.value - requiredTotal.value),
  } : { cet1: null, tier1: null, total: null };
  const capitalCompliant = capitalDataReady
    ? commonEquityTier1.value >= requiredCet1.value && tier1Capital.value >= requiredTier1.value && totalCapital.value >= requiredTotal.value
    : null;

  const metrics = {
    loanToDepositPct: ratioPct(grossLoans, deposits),
    stage3GrossLoansPct: ratioPct(stage3GrossLoans, grossLoans),
    allowanceToGrossLoansPct: ratioPct(allowanceForCreditLosses, grossLoans),
    stage3AllowanceCoveragePct: ratioPct(stage3Allowance, stage3GrossLoans),
    equityToAssetsPct: ratioPct(equity, assets),
    periodNetIncomeToEndingEquityPct: ratioPct(periodNetIncome, equity),
  };

  const coreCoverage = coverage({ grossLoans, deposits, assets, equity, periodNetIncome, sharesOutstanding });
  const assetQualityCoverage = coverage({ stage3GrossLoans, allowanceForCreditLosses, stage3Allowance });
  const capitalCoverage = coverage({ commonEquityTier1, tier1Capital, totalCapital, requiredCet1, requiredTier1, requiredTotal });
  const profitabilityCoverage = coverage({ periodNetIncome, periodNetIncomeToEndingEquityPct: metrics.periodNetIncomeToEndingEquityPct });
  const coreDataReady = coreCoverage.availableCount === coreCoverage.expectedCount && metrics.loanToDepositPct !== null && metrics.equityToAssetsPct !== null;
  const assetQualityReady = assetQualityCoverage.availableCount === assetQualityCoverage.expectedCount && metrics.stage3GrossLoansPct !== null && metrics.allowanceToGrossLoansPct !== null;
  const profitabilityReady = profitabilityCoverage.availableCount === profitabilityCoverage.expectedCount;
  const decisionReady = coreDataReady && assetQualityReady && capitalDataReady && profitabilityReady;

  const regulatoryCapital = {
    dataReady: capitalDataReady,
    compliant: capitalCompliant,
    actual: { commonEquityTier1, tier1Capital, totalCapital },
    requirements: { commonEquityTier1: requiredCet1, tier1Capital: requiredTier1, totalCapital: requiredTotal },
    buffersPct,
    interimProfitIncludedInActualRatios: false,
  };
  const facts = {
    grossLoans,
    deposits,
    stage3GrossLoans,
    allowanceForCreditLosses,
    stage3Allowance,
    assets,
    equity,
    periodNetIncome,
    sharesOutstanding,
  };
  const riskAssessment = bankRiskAssessment(metrics, regulatoryCapital, facts);

  return {
    format: 'investor-control-athens-bank-passport',
    version: 1,
    policyVersion: ATHENS_BANK_PASSPORT_VERSION,
    companyId: company?.companyId || baseSnapshot?.companyId || null,
    companyName: company?.displayName || company?.legalName || baseSnapshot?.companyName || null,
    generatedAt: new Date(options.generatedAt || baseSnapshot?.generatedAt || Date.now()).toISOString(),
    sourceUrl: baseSnapshot?.sourceUrl || null,
    reporting: {
      periodEnd,
      periodMonths: baseSnapshot?.reporting?.periodMonths || null,
      currency: 'EUR',
      sourceDocumentTitle: baseSnapshot?.sourceDocument?.title || null,
      sourceIdentityVerified: baseSnapshot?.sourceDocument?.identityVerified === true,
    },
    status: decisionReady ? 'DECISION_MODEL_READY' : coreDataReady ? 'BANK_MODEL_PARTIAL' : 'INSUFFICIENT_BANK_DATA',
    facts,
    metrics,
    regulatoryCapital,
    riskAssessment,
    coverage: {
      core: coreCoverage,
      assetQuality: assetQualityCoverage,
      regulatoryCapital: capitalCoverage,
      profitability: profitabilityCoverage,
      coreDataReady,
      assetQualityReady,
      regulatoryCapitalReady: capitalDataReady,
      profitabilityReady,
    },
    modelReady: decisionReady,
    decisionReady,
    blockers: [
      ...(!coreDataReady ? ['BANK_CORE_FACTS_REQUIRED'] : []),
      ...(!assetQualityReady ? ['BANK_ASSET_QUALITY_REQUIRED'] : []),
      ...(!capitalDataReady ? ['BANK_REGULATORY_CAPITAL_REQUIRED'] : []),
      ...(!profitabilityReady ? ['BANK_PROFITABILITY_REQUIRED'] : []),
    ],
    accountingPolicy: {
      genericPriceToSalesAllowed: false,
      genericFreeCashFlowRunwayAllowed: false,
      genericLiabilitiesToAssetsRiskAllowed: false,
      priceToBookUsesPeriodEndSharesOutstanding: true,
      endingBalanceProfitabilityRatiosAreApproximate: true,
      periodProfitabilityIsNotAnnualized: true,
      stage3GrossLoansAreNotRelabeledAsNPE: true,
      regulatoryCapitalMayBeInferredFromEquityRatio: false,
      regulatoryCapitalActualExcludesUnrecognizedInterimProfit: true,
      proFormaAcquisitionCapitalRatiosUsedForDecision: false,
    },
  };
}
