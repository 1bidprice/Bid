import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const write = (relativePath, content) => fs.writeFileSync(path.join(root, relativePath), content);

function replaceRequired(content, from, to, label) {
  if (content.includes(to)) return content;
  if (!content.includes(from)) throw new Error(`v1.4.7 Athens Bank Passport patch failed: missing ${label}`);
  return content.replace(from, to);
}

function patchAthensFundamentals() {
  let source = read('src/adapters/euronext-athens-fundamentals.js');

  source = replaceRequired(
    source,
    "import { classifyFundamentalModel } from '../fundamental-model.js';",
    "import { classifyFundamentalModel } from '../fundamental-model.js';\nimport { buildAthensBankPassport } from '../athens-bank-passport.js';",
    'Athens Bank Passport import',
  );

  source = replaceRequired(
    source,
    `  const snapshot = buildAthensFundamentalSnapshotFromText(extracted.text, document, company, {
    generatedAt: options.generatedAt,
    pages: pageTexts,
    extractionStatus: extracted.status,
  });
  const diagnostics = [];`,
    `  const snapshot = buildAthensFundamentalSnapshotFromText(extracted.text, document, company, {
    generatedAt: options.generatedAt,
    pages: pageTexts,
    extractionStatus: extracted.status,
  });

  if (snapshot.model?.type === 'FINANCIAL_INSTITUTION') {
    const bankPassport = buildAthensBankPassport(pageTexts, snapshot, company, { generatedAt: snapshot.generatedAt });
    snapshot.specializedModels = { ...(snapshot.specializedModels || {}), bank: bankPassport };
    snapshot.model = {
      ...snapshot.model,
      specializedModelImplemented: true,
      modelReady: bankPassport.modelReady,
      specializedModelStatus: bankPassport.status,
    };
    snapshot.quality = {
      ...(snapshot.quality || {}),
      specializedModelImplemented: true,
      bankPassportStatus: bankPassport.status,
      bankPassportBlockers: bankPassport.blockers,
    };
    // A bank becomes fundamental-ready only through its specialized bank
    // passport. Generic operating-company metrics remain suppressed.
    snapshot.metricsReady = bankPassport.decisionReady === true;
  }

  const diagnostics = [];`,
    'Athens Bank Passport snapshot integration',
  );

  source = replaceRequired(
    source,
    `  if (!snapshot.quality.extractionReady) diagnostics.push({ code: 'ATHENS_FINANCIAL_METRICS_INCOMPLETE', companyId: company?.companyId, coverage: snapshot.coverage.score });`,
    `  if (!snapshot.quality.extractionReady && snapshot.model?.specializedModelImplemented !== true) diagnostics.push({ code: 'ATHENS_FINANCIAL_METRICS_INCOMPLETE', companyId: company?.companyId, coverage: snapshot.coverage.score });`,
    'specialized-model extraction diagnostic',
  );

  source = replaceRequired(
    source,
    `  if (!snapshot.quality.genericModelEligible) diagnostics.push({ code: 'ATHENS_FINANCIAL_SECTOR_MODEL_REQUIRED', companyId: company?.companyId });`,
    `  if (!snapshot.quality.genericModelEligible && snapshot.model?.specializedModelImplemented !== true) diagnostics.push({ code: 'ATHENS_FINANCIAL_SECTOR_MODEL_REQUIRED', companyId: company?.companyId });
  if (snapshot.model?.type === 'FINANCIAL_INSTITUTION' && snapshot.model?.specializedModelImplemented === true && snapshot.specializedModels?.bank?.decisionReady !== true) diagnostics.push({
    code: 'ATHENS_BANK_PASSPORT_INCOMPLETE',
    companyId: company?.companyId,
    status: snapshot.specializedModels?.bank?.status || 'INSUFFICIENT_BANK_DATA',
    blockers: snapshot.specializedModels?.bank?.blockers || [],
    coreCoverage: snapshot.specializedModels?.bank?.coverage?.core || null,
    assetQualityCoverage: snapshot.specializedModels?.bank?.coverage?.assetQuality || null,
    regulatoryCapitalCoverage: snapshot.specializedModels?.bank?.coverage?.regulatoryCapital || null,
  });`,
    'Athens bank-specific diagnostics',
  );

  write('src/adapters/euronext-athens-fundamentals.js', source);
}

function patchFundamentalRisk() {
  let source = read('src/fundamental-risk.js');

  source = replaceRequired(
    source,
    `function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}`,
    `function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}`,
    'null-safe finite number helper',
  );

  source = replaceRequired(
    source,
    `  const bankPassport = fundamentals?.specializedModels?.bank || null;`,
    `  const bankPassport = fundamentals?.specializedModels?.bank || null;
  const bankSharesOutstanding = latestValue(bankPassport?.facts?.sharesOutstanding);
  const bankEquity = latestValue(bankPassport?.facts?.equity) ?? equity;
  const bankMarketCap = price !== null && bankSharesOutstanding !== null ? price * bankSharesOutstanding : null;
  const bankPriceToBook = ratio(bankMarketCap, bankEquity);
  const bankRiskScore = finite(bankPassport?.riskAssessment?.score);`,
    'bank-specific valuation and risk inputs',
  );

  source = replaceRequired(
    source,
    `  const metricsReady = Boolean(
    fundamentals?.metricsReady === true &&
    price !== null &&
    revenue !== null &&
    dilutedShares !== null &&
    coverage >= Number(options.minimumCoverage || 6) &&
    currencyConsistent &&
    genericModelEligible,
  );`,
    `  const genericMetricsReady = Boolean(
    fundamentals?.metricsReady === true &&
    price !== null &&
    revenue !== null &&
    dilutedShares !== null &&
    coverage >= Number(options.minimumCoverage || 6) &&
    currencyConsistent &&
    genericModelEligible,
  );
  const bankMetricsReady = Boolean(
    bankPassport?.decisionReady === true &&
    fundamentals?.metricsReady === true &&
    price !== null &&
    bankSharesOutstanding !== null &&
    bankEquity !== null && bankEquity > 0 &&
    bankPriceToBook !== null &&
    bankRiskScore !== null &&
    currencyConsistent,
  );
  const metricsReady = bankPassport ? bankMetricsReady : genericMetricsReady;`,
    'bank-specific risk readiness',
  );

  source = replaceRequired(
    source,
    `      valuation: {
        marketCapitalization: marketCap,
        priceToBook: ratio(marketCap, equity),
      },
      accountingPolicy: bankPassport.accountingPolicy,`,
    `      valuation: {
        marketCapitalization: round(bankMarketCap, 2),
        priceToBook: round(bankPriceToBook, 2),
        sharesOutstanding: bankSharesOutstanding,
        equity: bankEquity,
      },
      riskAssessment: bankPassport.riskAssessment || null,
      regulatoryCapital: bankPassport.regulatoryCapital || null,
      accountingPolicy: bankPassport.accountingPolicy,`,
    'bank specialized valuation output',
  );

  write('src/fundamental-risk.js', source);
}

function patchFinalActionPolicy() {
  let source = read('src/final-action-policy.js');

  source = replaceRequired(
    source,
    `function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}`,
    `function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}`,
    'final-action null-safe finite helper',
  );

  source = replaceRequired(
    source,
    `  'SEVERE_NEGATIVE_NET_MARGIN',
]);`,
    `  'SEVERE_NEGATIVE_NET_MARGIN',
  'BANK_CAPITAL_BELOW_REQUIREMENT',
  'BANK_HIGH_STAGE3_LOANS',
]);`,
    'bank severe-risk flags',
  );

  source = replaceRequired(
    source,
    `function riskFlags(dossier) {
  const fundamental = dossier?.metrics?.fundamentalRisk?.flags || [];
  const market = dossier?.metrics?.market?.risk?.flags || [];
  return {`,
    `function riskFlags(dossier) {
  const genericFundamental = dossier?.metrics?.fundamentalRisk?.flags || [];
  const specializedBank = dossier?.metrics?.fundamentalRisk?.specializedAnalysis?.riskAssessment?.flags || [];
  const fundamental = unique([...genericFundamental, ...specializedBank]);
  const market = dossier?.metrics?.market?.risk?.flags || [];
  return {`,
    'bank specialized risk flags',
  );

  source = replaceRequired(
    source,
    `  const riskScore = finite(dossier?.metrics?.fundamentalRisk?.riskScore) ?? 100;`,
    `  const fundamentalRisk = dossier?.metrics?.fundamentalRisk || {};
  const specializedBankRiskScore = fundamentalRisk?.specializedAnalysis?.type === 'BANK'
    ? finite(fundamentalRisk?.specializedAnalysis?.riskAssessment?.score)
    : null;
  const riskScore = fundamentalRisk?.specializedAnalysis?.type === 'BANK'
    ? (specializedBankRiskScore ?? 100)
    : (finite(fundamentalRisk?.riskScore) ?? 100);`,
    'bank specialized risk score in final action',
  );

  write('src/final-action-policy.js', source);
}

patchAthensFundamentals();
patchFundamentalRisk();
patchFinalActionPolicy();

for (const [file, invariants] of Object.entries({
  'src/adapters/euronext-athens-fundamentals.js': [
    'buildAthensBankPassport',
    "snapshot.model?.type === 'FINANCIAL_INSTITUTION'",
    'ATHENS_BANK_PASSPORT_INCOMPLETE',
    'bankPassportBlockers',
  ],
  'src/fundamental-risk.js': [
    'bankSharesOutstanding',
    'bankPriceToBook',
    'bankMetricsReady',
    'riskAssessment: bankPassport.riskAssessment || null',
  ],
  'src/final-action-policy.js': [
    "value === null || value === undefined || value === ''",
    'BANK_CAPITAL_BELOW_REQUIREMENT',
    'specializedBankRiskScore',
    'specializedAnalysis?.riskAssessment?.flags',
  ],
})) {
  const source = read(file);
  for (const invariant of invariants) {
    if (!source.includes(invariant)) throw new Error(`v1.4.7 verification failed: ${file} missing ${invariant}`);
  }
}

console.log('Investor Control v1.4.7 Athens Bank Passport and specialized risk gate applied.');
