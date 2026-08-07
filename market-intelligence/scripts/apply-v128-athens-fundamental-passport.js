import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const write = (relativePath, content) => fs.writeFileSync(path.join(root, relativePath), content);

function replaceRequired(content, from, to, label) {
  if (content.includes(to)) return content;
  if (!content.includes(from)) throw new Error(`v1.2.8 Athens fundamental passport patch failed: missing ${label}`);
  return content.replace(from, to);
}

function patchDailyPipeline() {
  let source = read('src/run-daily-intelligence.js');
  source = replaceRequired(
    source,
    "import { fetchSecCompanyFacts } from './adapters/sec-companyfacts.js';",
    "import { fetchSecCompanyFacts } from './adapters/sec-companyfacts.js';\nimport { fetchEuronextAthensFundamentals } from './adapters/euronext-athens-fundamentals.js';",
    'Athens fundamentals import',
  );

  source = replaceRequired(
    source,
    `async function collectCompanyFundamentals(company, options) {
  if (company.cik) {
    return fetchSecCompanyFacts(company, {
      fetchImpl: options.fetchImpl,
      userAgent: options.secUserAgent,
      generatedAt: options.now,
    });
  }
  return {
    snapshot: null,
    diagnostics: [{ code: 'FUNDAMENTALS_ADAPTER_PENDING', companyId: company.companyId }],
  };
}`,
    `async function collectCompanyFundamentals(company, options) {
  if (company.cik) {
    return fetchSecCompanyFacts(company, {
      fetchImpl: options.fetchImpl,
      userAgent: options.secUserAgent,
      generatedAt: options.now,
    });
  }
  const athensListing = company?.primaryListing?.mic === 'XATH' || /Athens/i.test(String(company?.primaryListing?.exchange || ''));
  if (athensListing) {
    return fetchEuronextAthensFundamentals(company, {
      fetchImpl: options.fetchImpl,
      generatedAt: options.now,
      userAgent: options.documentUserAgent || 'Investor-Control-Market-Intelligence/1.0',
      pdfExtractor: options.pdfExtractor,
      maxBytes: options.maxDocumentBytes,
      minReviewedText: options.minReviewedText,
      timeoutMs: options.pdfTimeoutMs,
    });
  }
  return {
    snapshot: null,
    diagnostics: [{ code: 'FUNDAMENTALS_ADAPTER_PENDING', companyId: company.companyId }],
  };
}`,
    'Athens fundamentals route',
  );

  source = replaceRequired(
    source,
    `      const fundamentalResult = await collectCompanyFundamentals(company, {
        fetchImpl,
        secUserAgent,
        now,
      });`,
    `      const fundamentalResult = await collectCompanyFundamentals(company, {
        fetchImpl,
        secUserAgent,
        documentUserAgent: options.documentUserAgent,
        pdfExtractor,
        maxDocumentBytes: options.maxDocumentBytes,
        minReviewedText: options.minReviewedText,
        pdfTimeoutMs: options.pdfTimeoutMs,
        now,
      });`,
    'fundamental PDF extraction inputs',
  );

  write('src/run-daily-intelligence.js', source);
}

function patchFundamentalRiskPeriodSafety() {
  let source = read('src/fundamental-risk.js');
  source = replaceRequired(
    source,
    '  const freeCashFlow = finite(fundamentals?.metrics?.latestAnnualFreeCashFlowUSD);',
    '  const freeCashFlow = finite(fundamentals?.metrics?.latestFreeCashFlow ?? fundamentals?.metrics?.latestAnnualFreeCashFlowUSD);\n  const flowPeriodMonths = finite(fundamentals?.reporting?.periodMonths) ?? 12;\n  const annualComparable = fundamentals?.reporting ? fundamentals.reporting.annualComparable === true : true;',
    'currency-neutral free cash flow and reporting basis',
  );
  source = replaceRequired(
    source,
    '  const priceToSales = ratio(marketCap, revenue);',
    '  const priceToSales = annualComparable ? ratio(marketCap, revenue) : null;',
    'non-annual price-to-sales guard',
  );
  source = replaceRequired(
    source,
    `  const cashRunwayYears = cash !== null && freeCashFlow !== null && freeCashFlow < 0
    ? cash / Math.abs(freeCashFlow)
    : null;`,
    `  const cashRunwayYears = annualComparable && cash !== null && freeCashFlow !== null && freeCashFlow < 0
    ? cash / Math.abs(freeCashFlow)
    : null;`,
    'non-annual cash-runway guard',
  );
  source = replaceRequired(
    source,
    `    profitability: {
      revenue,
      netIncome,
      freeCashFlow,
      netMarginPct: netMargin === null ? null : round(netMargin * 100, 2),
      netMarginComparable,
      netMarginDisplay: netMargin === null ? null : netMarginComparable ? \`${'${round(netMargin * 100, 2)}'}%\` : 'Μη συγκρίσιμο λόγω πολύ χαμηλής βάσης εσόδων',
    },`,
    `    profitability: {
      revenue,
      netIncome,
      freeCashFlow,
      flowPeriodMonths,
      annualComparable,
      netMarginPct: netMargin === null ? null : round(netMargin * 100, 2),
      netMarginComparable,
      netMarginDisplay: netMargin === null ? null : netMarginComparable ? \`${'${round(netMargin * 100, 2)}'}%\` : 'Μη συγκρίσιμο λόγω πολύ χαμηλής βάσης εσόδων',
    },`,
    'reporting-basis transparency',
  );
  write('src/fundamental-risk.js', source);
}

function patchKnownAthensIssuerIdentity() {
  const file = path.join(root, 'config/universe.seed.json');
  const universe = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const company of universe) {
    if (company.companyId === 'company:allwyn-ag') {
      company.issuerId = '863';
      company.marketData = {
        ...(company.marketData || {}),
        euronextFinancialDataUrl: 'https://athens.euronext.com/en/market-data/issuers/863/financial-data',
      };
    }
    if (company.companyId === 'company:crediabank') {
      company.issuerId = '50';
      company.marketData = {
        ...(company.marketData || {}),
        euronextFinancialDataUrl: 'https://athens.euronext.com/en/market-data/issuers/50/financial-data',
      };
    }
  }
  fs.writeFileSync(file, `${JSON.stringify(universe, null, 2)}\n`);
}

patchDailyPipeline();
patchFundamentalRiskPeriodSafety();
patchKnownAthensIssuerIdentity();

for (const [file, invariants] of Object.entries({
  'src/run-daily-intelligence.js': ['fetchEuronextAthensFundamentals', 'athensListing', 'maxDocumentBytes: options.maxDocumentBytes'],
  'src/fundamental-risk.js': ['latestFreeCashFlow ??', 'flowPeriodMonths', 'annualComparable ? ratio(marketCap, revenue) : null'],
  'config/universe.seed.json': ['euronextFinancialDataUrl', 'issuers/863/financial-data', 'issuers/50/financial-data'],
})) {
  const source = read(file);
  for (const invariant of invariants) {
    if (!source.includes(invariant)) throw new Error(`v1.2.8 verification failed: ${file} missing ${invariant}`);
  }
}

console.log('Investor Control market intelligence v1.2.8 Athens fundamental evidence passport applied.');
