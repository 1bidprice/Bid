import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const write = (relativePath, content) => fs.writeFileSync(path.join(root, relativePath), content);

function replaceRequired(content, from, to, label) {
  if (content.includes(to)) return content;
  if (!content.includes(from)) throw new Error(`v1.4.0 SEC Bank Passport patch failed: missing ${label}`);
  return content.replace(from, to);
}

function patchSecCompanyFacts() {
  let source = read('src/adapters/sec-companyfacts.js');
  source = replaceRequired(
    source,
    "import { classifyFundamentalModel } from '../fundamental-model.js';",
    "import { classifyFundamentalModel } from '../fundamental-model.js';\nimport { buildSecBankPassport } from '../sec-bank-passport.js';",
    'bank passport import',
  );

  source = replaceRequired(
    source,
    `  snapshot.coverage = metricCoverage(snapshot);
  snapshot.dataReady = snapshot.coverage.score >= 65 && Boolean(revenue[0] || operatingCashFlow[0]);
  snapshot.metricsReady = Boolean(snapshot.dataReady && model.modelReady && model.genericValuationEligible);
  return snapshot;`,
    `  snapshot.coverage = metricCoverage(snapshot);
  snapshot.dataReady = snapshot.coverage.score >= 65 && Boolean(revenue[0] || operatingCashFlow[0]);
  snapshot.metricsReady = Boolean(snapshot.dataReady && model.modelReady && model.genericValuationEligible);

  if (model.type === 'FINANCIAL_INSTITUTION') {
    const bankPassport = buildSecBankPassport(payload, snapshot, company, { generatedAt: snapshot.generatedAt });
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
    // Bank facts can be analytically useful while the investment decision remains
    // fail-closed. Generic metricsReady must never be borrowed from the operating model.
    snapshot.metricsReady = bankPassport.decisionReady === true;
  }
  return snapshot;`,
    'bank passport snapshot integration',
  );

  source = replaceRequired(
    source,
    `  if (snapshot.model?.specializedModelRequired === true) diagnostics.push({
    code: 'SEC_FUNDAMENTAL_SPECIALIZED_MODEL_REQUIRED',
    companyId: company.companyId,
    modelType: snapshot.model.type,
    requiredMetrics: snapshot.model.requiredSpecializedMetrics,
  });`,
    `  if (snapshot.model?.specializedModelRequired === true && snapshot.model?.specializedModelImplemented !== true) diagnostics.push({
    code: 'SEC_FUNDAMENTAL_SPECIALIZED_MODEL_REQUIRED',
    companyId: company.companyId,
    modelType: snapshot.model.type,
    requiredMetrics: snapshot.model.requiredSpecializedMetrics,
  });
  if (snapshot.model?.type === 'FINANCIAL_INSTITUTION' && snapshot.model?.specializedModelImplemented === true && snapshot.model?.modelReady !== true) diagnostics.push({
    code: 'SEC_BANK_PASSPORT_INCOMPLETE',
    companyId: company.companyId,
    status: snapshot.specializedModels?.bank?.status || 'INSUFFICIENT_BANK_DATA',
    blockers: snapshot.specializedModels?.bank?.blockers || [],
    coreCoverage: snapshot.specializedModels?.bank?.coverage?.core || null,
    assetQualityCoverage: snapshot.specializedModels?.bank?.coverage?.assetQuality || null,
  });`,
    'bank-specific diagnostics',
  );

  write('src/adapters/sec-companyfacts.js', source);
}

function patchFundamentalRisk() {
  let source = read('src/fundamental-risk.js');
  source = replaceRequired(
    source,
    `  const genericModelEligible = model.genericValuationEligible !== false && model.specializedModelRequired !== true && model.modelReady !== false;`,
    `  const genericModelEligible = model.genericValuationEligible !== false && model.specializedModelRequired !== true && model.modelReady !== false;
  const bankPassport = fundamentals?.specializedModels?.bank || null;`,
    'bank passport risk context',
  );

  source = replaceRequired(
    source,
    `    model,
    valuationModelStatus: genericModelEligible ? 'GENERIC_MODEL_READY' : 'SPECIALIZED_MODEL_REQUIRED',
    referencePrice: price,`,
    `    model,
    valuationModelStatus: genericModelEligible ? 'GENERIC_MODEL_READY' : bankPassport ? bankPassport.status : 'SPECIALIZED_MODEL_REQUIRED',
    specializedAnalysis: bankPassport ? {
      type: 'BANK',
      status: bankPassport.status,
      decisionReady: bankPassport.decisionReady,
      blockers: bankPassport.blockers,
      metrics: bankPassport.metrics,
      coverage: bankPassport.coverage,
      valuation: {
        marketCapitalization: marketCap,
        priceToBook: ratio(marketCap, equity),
      },
      accountingPolicy: bankPassport.accountingPolicy,
    } : null,
    referencePrice: price,`,
    'bank specialized risk output',
  );

  write('src/fundamental-risk.js', source);
}

patchSecCompanyFacts();
patchFundamentalRisk();

for (const [file, invariants] of Object.entries({
  'src/adapters/sec-companyfacts.js': [
    'buildSecBankPassport',
    "model.type === 'FINANCIAL_INSTITUTION'",
    'SEC_BANK_PASSPORT_INCOMPLETE',
    'bankPassportBlockers',
  ],
  'src/fundamental-risk.js': [
    'fundamentals?.specializedModels?.bank',
    "type: 'BANK'",
    'accountingPolicy: bankPassport.accountingPolicy',
  ],
})) {
  const source = read(file);
  for (const invariant of invariants) {
    if (!source.includes(invariant)) throw new Error(`v1.4.0 verification failed: ${file} missing ${invariant}`);
  }
}

console.log('Investor Control v1.4.0 SEC Bank Passport integrated.');
