export const FUNDAMENTAL_MODEL_VERSION = '2026-08-07.2';

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

  const strongRealEstateName = /\b(REIT|REAL ESTATE|REALTY|PROPERTIES|PROPERTY TRUST|REIC|R E I C)\b/.test(name);
  const strongRealEstateSector = /\b(REAL ESTATE|PROPERTY|REIT)\b/.test(sector);
  const strongRealEstateConcept = containsConcept(concepts, [
    /RealEstateInvestmentPropert/i,
    /InvestmentPropert/i,
    /RentalIncome/i,
    /LeaseIncomeFromRealEstate/i,
    /PropertyOperatingIncome/i,
  ]);

  const strongBankName = /\b(BANK|BANCORP|BANKING|CREDIT UNION|INSURANCE|INSURER)\b/.test(name);
  const strongBankSector = /\b(BANK|BANKING|INSURANCE|FINANCIAL INSTITUTION|FINANCIAL SERVICES)\b/.test(sector);
  const strongBankConcept = containsConcept(concepts, [
    /LoansAndLeases/i,
    /Deposits/i,
    /AllowanceForCreditLoss/i,
    /TierOneCapital/i,
    /RiskWeightedAssets/i,
    /FederalFunds/i,
    /InterestIncome.*Loans/i,
  ]);
  const financialNameSupport = /\bFINANCIAL\b/.test(name) && strongBankConcept;

  if (strongRealEstateName) reasonCodes.push('REAL_ESTATE_NAME_SIGNAL');
  if (strongRealEstateSector) reasonCodes.push('REAL_ESTATE_SECTOR_SIGNAL');
  if (strongRealEstateConcept) reasonCodes.push('REAL_ESTATE_XBRL_SIGNAL');
  if (strongBankName) reasonCodes.push('FINANCIAL_NAME_SIGNAL');
  if (strongBankSector) reasonCodes.push('FINANCIAL_SECTOR_SIGNAL');
  if (strongBankConcept) reasonCodes.push('FINANCIAL_XBRL_SIGNAL');
  if (financialNameSupport) reasonCodes.push('FINANCIAL_NAME_XBRL_COMBINATION');

  let type = 'GENERIC_OPERATING';
  // Entity identity and sector outrank incidental balance-sheet concepts. Banks
  // routinely report real-estate collateral, OREO and mortgage-related facts;
  // those references must never turn a bank into a REIT. Conversely, an issuer
  // explicitly identified as a REIT/real-estate company remains real estate even
  // if it reports lending or deposit-like line items.
  if (strongRealEstateName || strongRealEstateSector) type = 'REAL_ESTATE';
  else if (strongBankName || strongBankSector || strongBankConcept || financialNameSupport) type = 'FINANCIAL_INSTITUTION';
  else if (strongRealEstateConcept) type = 'REAL_ESTATE';

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
