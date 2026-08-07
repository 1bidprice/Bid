import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const write = (relativePath, content) => fs.writeFileSync(path.join(root, relativePath), content);

function replaceRequired(content, from, to, label) {
  if (content.includes(to)) return content;
  if (!content.includes(from)) throw new Error(`v1.3.0 fundamental model patch failed: missing ${label}`);
  return content.replace(from, to);
}

function patchSecCompanyFacts() {
  let source = read('src/adapters/sec-companyfacts.js');
  source = replaceRequired(
    source,
    'const CONCEPTS = Object.freeze({',
    "import { classifyFundamentalModel } from '../fundamental-model.js';\n\nconst CONCEPTS = Object.freeze({",
    'SEC model-classifier import',
  );

  if (!source.includes('function selectAnnualRevenueSeries(')) {
    source = replaceRequired(
      source,
      `function annualSeries(payload, aliases, preferredUnits) {
  const concept = conceptFromPayload(payload, aliases);
  const entries = unitEntries(concept, preferredUnits)
    .filter((entry) => ['10-K', '10-K/A', '20-F', '20-F/A'].includes(entry.form))
    .filter((entry) => entry.start && entry.end);
  return latestFiledByPeriod(entries).slice(0, 5);
}
`,
      `function annualSeries(payload, aliases, preferredUnits) {
  const concept = conceptFromPayload(payload, aliases);
  const entries = unitEntries(concept, preferredUnits)
    .filter((entry) => ['10-K', '10-K/A', '20-F', '20-F/A'].includes(entry.form))
    .filter((entry) => entry.start && entry.end);
  return latestFiledByPeriod(entries).slice(0, 5);
}

function annualSeriesForConcept(payload, alias, preferredUnits) {
  const fact = payload?.facts?.['us-gaap']?.[alias];
  if (!fact?.units) return [];
  const entries = unitEntries({ name: alias, fact }, preferredUnits)
    .filter((entry) => ['10-K', '10-K/A', '20-F', '20-F/A'].includes(entry.form))
    .filter((entry) => entry.start && entry.end);
  return latestFiledByPeriod(entries).slice(0, 5);
}

function selectAnnualRevenueSeries(payload) {
  const candidates = CONCEPTS.revenue
    .map((concept) => ({ concept, series: annualSeriesForConcept(payload, concept, ['USD']) }))
    .filter((candidate) => candidate.series.length > 0)
    .sort((a, b) => {
      const endOrder = String(b.series[0]?.end || '').localeCompare(String(a.series[0]?.end || ''));
      if (endOrder) return endOrder;
      const historyOrder = b.series.length - a.series.length;
      if (historyOrder) return historyOrder;
      return Math.abs(Number(b.series[0]?.value || 0)) - Math.abs(Number(a.series[0]?.value || 0));
    });
  const selected = candidates[0] || null;
  return {
    series: selected?.series || [],
    selection: {
      policy: 'MOST_COMPLETE_CONSOLIDATED_ANNUAL_SERIES_V1',
      selectedConcept: selected?.concept || null,
      candidateConcepts: candidates.map((candidate) => candidate.concept),
      candidateCount: candidates.length,
    },
  };
}
`,
      'SEC consolidated revenue selector',
    );
  }

  source = replaceRequired(
    source,
    "  const revenue = annualSeries(payload, CONCEPTS.revenue, ['USD']);",
    `  const revenueChoice = selectAnnualRevenueSeries(payload);
  const revenue = revenueChoice.series;
  const model = classifyFundamentalModel(company, { payload });`,
    'SEC revenue selection and model classification',
  );

  source = replaceRequired(
    source,
    "    sourceUrl: `https://data.sec.gov/api/xbrl/companyfacts/CIK${paddedCik(company.cik)}.json`,",
    "    sourceUrl: `https://data.sec.gov/api/xbrl/companyfacts/CIK${paddedCik(company.cik)}.json`,\n    model,\n    reporting: { currency: 'USD', periodMonths: 12, annualComparable: true, genericModelEligible: model.genericValuationEligible },",
    'SEC model passport output',
  );

  source = replaceRequired(
    source,
    `    metrics: {
      annualRevenueGrowthPct: growthPct(revenue[0], revenue[1]),
      annualNetMarginPct: ratioPct(netIncome[0], revenue[0]),
      dilutedSharesChangePct: growthPct(dilutedShares[0], dilutedShares[1]),
      latestAnnualFreeCashFlowUSD:
        operatingCashFlow[0] && capitalExpenditure[0]
          ? operatingCashFlow[0].value - capitalExpenditure[0].value
          : null,
    },`,
    `    metrics: {
      annualRevenueGrowthPct: model.genericValuationEligible ? growthPct(revenue[0], revenue[1]) : null,
      annualNetMarginPct: model.genericValuationEligible ? ratioPct(netIncome[0], revenue[0]) : null,
      dilutedSharesChangePct: growthPct(dilutedShares[0], dilutedShares[1]),
      latestAnnualFreeCashFlowUSD:
        model.genericValuationEligible && operatingCashFlow[0] && capitalExpenditure[0]
          ? operatingCashFlow[0].value - capitalExpenditure[0].value
          : null,
    },
    quality: {
      revenueSelection: revenueChoice.selection,
      specializedModelRequired: model.specializedModelRequired,
      genericMetricsSuppressed: !model.genericValuationEligible,
    },`,
    'SEC model-aware derived metrics',
  );

  source = replaceRequired(
    source,
    `  snapshot.coverage = metricCoverage(snapshot);
  snapshot.metricsReady = snapshot.coverage.score >= 65 && Boolean(revenue[0] || operatingCashFlow[0]);`,
    `  snapshot.coverage = metricCoverage(snapshot);
  snapshot.dataReady = snapshot.coverage.score >= 65 && Boolean(revenue[0] || operatingCashFlow[0]);
  snapshot.metricsReady = Boolean(snapshot.dataReady && model.modelReady && model.genericValuationEligible);`,
    'SEC data/model readiness split',
  );

  source = replaceRequired(
    source,
    `  return {
    snapshot,
    diagnostics: snapshot.coverage.available
      ? []
      : [{ code: 'SEC_COMPANY_FACTS_EMPTY', companyId: company.companyId }],
  };`,
    `  const diagnostics = [];
  if (!snapshot.coverage.available) diagnostics.push({ code: 'SEC_COMPANY_FACTS_EMPTY', companyId: company.companyId });
  if (snapshot.model?.specializedModelRequired === true) diagnostics.push({
    code: 'SEC_FUNDAMENTAL_SPECIALIZED_MODEL_REQUIRED',
    companyId: company.companyId,
    modelType: snapshot.model.type,
    requiredMetrics: snapshot.model.requiredSpecializedMetrics,
  });
  return { snapshot, diagnostics };`,
    'SEC specialized-model diagnostics',
  );

  write('src/adapters/sec-companyfacts.js', source);
}

function patchAthensFundamentals() {
  let source = read('src/adapters/euronext-athens-fundamentals.js');
  source = replaceRequired(
    source,
    "import { extractPdfText } from '../pdf-extractor.js';",
    "import { extractPdfText } from '../pdf-extractor.js';\nimport { classifyFundamentalModel } from '../fundamental-model.js';",
    'Athens model-classifier import',
  );

  source = replaceRequired(
    source,
    `  const sector = String(company?.sector || '').toLowerCase();
  const bankLike = /financial|bank|insurance/.test(sector) || /bank/i.test(String(company?.displayName || company?.legalName || ''));
  const realEstateLike = /real estate|reic|reit/.test(sector) || /real estate|reic|reit/i.test(String(company?.displayName || company?.legalName || ''));
  const genericModelEligible = !bankLike && !realEstateLike;
  const extractionReady = available >= 6 && Boolean(revenue[0] && netIncome[0] && dilutedShares[0]);`,
    `  const model = classifyFundamentalModel(company);
  const bankLike = model.type === 'FINANCIAL_INSTITUTION';
  const realEstateLike = model.type === 'REAL_ESTATE';
  const genericModelEligible = model.genericValuationEligible === true;
  const extractionReady = available >= 6 && Boolean(revenue[0] && netIncome[0] && dilutedShares[0]);`,
    'Athens unified model classification',
  );

  source = replaceRequired(
    source,
    "    sourceUrl: document?.pdfUrl || null,",
    "    sourceUrl: document?.pdfUrl || null,\n    model,",
    'Athens model passport output',
  );

  source = replaceRequired(
    source,
    `    metrics: {
      annualRevenueGrowthPct: growthPct(revenue),
      annualNetMarginPct: ratioPct(netIncome[0], revenue[0]),
      dilutedSharesChangePct: dilutedShares.length > 1 ? growthPct(dilutedShares) : null,
      latestFreeCashFlow: freeCashFlow,
      latestAnnualFreeCashFlowUSD: null,
    },`,
    `    metrics: {
      annualRevenueGrowthPct: genericModelEligible ? growthPct(revenue) : null,
      annualNetMarginPct: genericModelEligible ? ratioPct(netIncome[0], revenue[0]) : null,
      dilutedSharesChangePct: dilutedShares.length > 1 ? growthPct(dilutedShares) : null,
      latestFreeCashFlow: genericModelEligible ? freeCashFlow : null,
      latestAnnualFreeCashFlowUSD: null,
    },`,
    'Athens model-aware derived metrics',
  );

  source = replaceRequired(
    source,
    `      genericModelEligible,
      flowDataAnnualComparable:`,
    `      genericModelEligible,
      specializedModelRequired: model.specializedModelRequired,
      genericMetricsSuppressed: !genericModelEligible,
      flowDataAnnualComparable:`,
    'Athens model quality flags',
  );

  write('src/adapters/euronext-athens-fundamentals.js', source);
}

function patchFundamentalRisk() {
  let source = read('src/fundamental-risk.js');

  source = replaceRequired(
    source,
    `  const currencyConsistent = !reportedCurrency || reportedCurrency === expectedCurrency;`,
    `  const currencyConsistent = !reportedCurrency || reportedCurrency === expectedCurrency;
  const model = fundamentals?.model || {
    type: 'GENERIC_OPERATING',
    genericValuationEligible: true,
    specializedModelRequired: false,
    modelReady: true,
    reasonCodes: ['LEGACY_GENERIC_DEFAULT'],
  };
  const genericModelEligible = model.genericValuationEligible !== false && model.specializedModelRequired !== true && model.modelReady !== false;`,
    'risk model eligibility state',
  );

  source = replaceRequired(
    source,
    '  const priceToSales = annualComparable ? ratio(marketCap, revenue) : null;',
    '  const priceToSales = genericModelEligible && annualComparable ? ratio(marketCap, revenue) : null;',
    'model-aware P/S',
  );
  source = replaceRequired(
    source,
    '  const priceToBook = ratio(marketCap, equity);',
    '  const priceToBook = genericModelEligible ? ratio(marketCap, equity) : null;',
    'model-aware P/B',
  );
  source = replaceRequired(
    source,
    '  const netMargin = ratio(netIncome, revenue);',
    '  const netMargin = genericModelEligible ? ratio(netIncome, revenue) : null;',
    'model-aware margin',
  );
  source = replaceRequired(
    source,
    `  const cashRunwayYears = annualComparable && cash !== null && freeCashFlow !== null && freeCashFlow < 0`,
    `  const cashRunwayYears = genericModelEligible && annualComparable && cash !== null && freeCashFlow !== null && freeCashFlow < 0`,
    'model-aware cash runway',
  );

  source = replaceRequired(
    source,
    "  if (freeCashFlow !== null && freeCashFlow < 0) flags.push('NEGATIVE_FREE_CASH_FLOW');",
    "  if (genericModelEligible && freeCashFlow !== null && freeCashFlow < 0) flags.push('NEGATIVE_FREE_CASH_FLOW');",
    'model-aware cash-flow flag',
  );
  source = replaceRequired(
    source,
    "  if (liabilitiesToAssets !== null && liabilitiesToAssets >= 0.9) flags.push('VERY_HIGH_LIABILITIES_TO_ASSETS');\n  else if (liabilitiesToAssets !== null && liabilitiesToAssets >= 0.75) flags.push('HIGH_LIABILITIES_TO_ASSETS');",
    "  if (genericModelEligible && liabilitiesToAssets !== null && liabilitiesToAssets >= 0.9) flags.push('VERY_HIGH_LIABILITIES_TO_ASSETS');\n  else if (genericModelEligible && liabilitiesToAssets !== null && liabilitiesToAssets >= 0.75) flags.push('HIGH_LIABILITIES_TO_ASSETS');",
    'model-aware leverage flags',
  );

  source = replaceRequired(
    source,
    '  riskScore = Math.min(100, riskScore);',
    '  riskScore = genericModelEligible ? Math.min(100, riskScore) : null;',
    'model-aware risk score',
  );

  source = replaceRequired(
    source,
    `    coverage >= Number(options.minimumCoverage || 6) &&
    currencyConsistent,`,
    `    coverage >= Number(options.minimumCoverage || 6) &&
    currencyConsistent &&
    genericModelEligible,`,
    'model readiness gate',
  );

  source = replaceRequired(
    source,
    `    reportedCurrency,
    currencyConsistent,
    referencePrice: price,`,
    `    reportedCurrency,
    currencyConsistent,
    model,
    valuationModelStatus: genericModelEligible ? 'GENERIC_MODEL_READY' : 'SPECIALIZED_MODEL_REQUIRED',
    referencePrice: price,`,
    'risk model passport output',
  );

  write('src/fundamental-risk.js', source);
}

patchSecCompanyFacts();
patchAthensFundamentals();
patchFundamentalRisk();

for (const [file, invariants] of Object.entries({
  'src/adapters/sec-companyfacts.js': [
    'selectAnnualRevenueSeries',
    'MOST_COMPLETE_CONSOLIDATED_ANNUAL_SERIES_V1',
    'SEC_FUNDAMENTAL_SPECIALIZED_MODEL_REQUIRED',
    'snapshot.dataReady',
    'genericMetricsSuppressed',
  ],
  'src/adapters/euronext-athens-fundamentals.js': [
    "classifyFundamentalModel(company)",
    'specializedModelRequired: model.specializedModelRequired',
    'genericMetricsSuppressed',
  ],
  'src/fundamental-risk.js': [
    'genericModelEligible',
    "valuationModelStatus: genericModelEligible ? 'GENERIC_MODEL_READY' : 'SPECIALIZED_MODEL_REQUIRED'",
    'genericModelEligible && annualComparable ? ratio(marketCap, revenue) : null',
  ],
})) {
  const source = read(file);
  for (const invariant of invariants) {
    if (!source.includes(invariant)) throw new Error(`v1.3.0 verification failed: ${file} missing ${invariant}`);
  }
}

console.log('Investor Control v1.3.0 Fundamental Model Passport applied.');
