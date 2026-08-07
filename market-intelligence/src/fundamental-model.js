export const FUNDAMENTAL_MODEL_VERSION = '2026-08-07.1';

function normalizedText(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9Α-Ω]+/g, ' ').replace(/\s+/g, ' ');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function conceptNames(context = {}) {
  if (Array.isArray(context.concepts)) return context.concepts.map(String);
  const namespace = context?.payload?.facts?.['us-gaap'] || context?.facts?.['us-gaap'] || {};
  return Object.keys(namespace);
}

function containsConcept(concepts, patterns) {
  return concepts.some((concept) => patterns.some((pattern) => pattern.test(concept)));
}

export function classifyFundamentalModel(company = {}, context = {}) {
  const name = normalizedText([company.displayName, company.legalName, ...(company.aliases || [])].filter(Boolean).join(' '));
  const sector = normalizedText([company.sector, company.industry].filter(Boolean).join(' '));
  const concepts = conceptNames(context);
  const reasonCodes = [];

  const realEstateName = /\b(REIT|REAL ESTATE|REALTY|PROPERTIES|PROPERTY TRUST|REIC|R E I C)\b/.test(name);
  const realEstateSector = /\b(REAL ESTATE|PROPERTY|REIT)\b/.test(sector);
  const realEstateConcept = containsConcept(concepts, [
    /RealEstate/i,
    /InvestmentPropert/i,
    /RentalIncome/i,
    /LeaseIncome/i,
    /PropertyOperating/i,
  ]);

  if (realEstateName) reasonCodes.push('REAL_ESTATE_NAME_SIGNAL');
  if (realEstateSector) reasonCodes.push('REAL_ESTATE_SECTOR_SIGNAL');
  if (realEstateConcept) reasonCodes.push('REAL_ESTATE_XBRL_SIGNAL');

  const bankName = /\b(BANK|BANCORP|BANKING|CREDIT UNION|INSURANCE|INSURER)\b/.test(name);
  const bankSector = /\b(BANK|BANKING|INSURANCE|FINANCIAL INSTITUTION|FINANCIAL SERVICES)\b/.test(sector);
  const bankConcept = containsConcept(concepts, [
    /LoansAndLeases/i,
    /Deposits/i,
    /AllowanceForCreditLoss/i,
    /TierOneCapital/i,
    /RiskWeightedAssets/i,
    /FederalFunds/i,
  ]);

  if (bankName) reasonCodes.push('FINANCIAL_NAME_SIGNAL');
  if (bankSector) reasonCodes.push('FINANCIAL_SECTOR_SIGNAL');
  if (bankConcept) reasonCodes.push('FINANCIAL_XBRL_SIGNAL');

  let type = 'GENERIC_OPERATING';
  if (realEstateName || realEstateSector || realEstateConcept) type = 'REAL_ESTATE';
  else if (bankName || bankSector || bankConcept) type = 'FINANCIAL_INSTITUTION';

  const specializedModelRequired = type !== 'GENERIC_OPERATING';
  const requiredSpecializedMetrics = type === 'REAL_ESTATE'
    ? ['NOI_OR_FFO', 'NAV_OR_ASSET_VALUE', 'NET_DEBT', 'OCCUPANCY_OR_RENTAL_METRICS']
    : type === 'FINANCIAL_INSTITUTION'
      ? ['CAPITAL_ADEQUACY', 'ASSET_QUALITY', 'LOANS_AND_DEPOSITS', 'ROTE_OR_ROE']
      : [];

  return {
    format: 'investor-control-fundamental-model-passport',
    version: 1,
    policyVersion: FUNDAMENTAL_MODEL_VERSION,
    type,
    genericValuationEligible: !specializedModelRequired,
    specializedModelRequired,
    specializedModelImplemented: false,
    modelReady: !specializedModelRequired,
    reasonCodes: unique(reasonCodes.length ? reasonCodes : ['GENERIC_OPERATING_MODEL']),
    requiredSpecializedMetrics,
  };
}
