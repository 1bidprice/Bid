export const FUNDAMENTAL_MODEL_VERSION = '2026-08-08.1';

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

  const strongBankName = /\b(BANK|BANCORP|BANKING|CREDIT UNION)\b/.test(name);
  const strongBankSector = /\b(BANK|BANKING|CREDIT UNION|DEPOSITORY INSTITUTION)\b/.test(sector);
  const strongBankConcept = containsConcept(concepts, [
    /LoansAndLeases/i,
    /^Deposits$/i,
    /DepositsInDomesticOffices/i,
    /AllowanceForCreditLoss/i,
    /TierOneCapital/i,
    /RiskWeightedAssets/i,
    /FederalFunds/i,
    /InterestIncome.*Loans/i,
  ]);

  const strongInsuranceName = /\b(INSURANCE|INSURER|ASSURANCE|REINSURANCE|REINSURER)\b/.test(name);
  const strongInsuranceSector = /\b(INSURANCE|REINSURANCE)\b/.test(sector);
  const strongInsuranceConcept = containsConcept(concepts, [
    /InsurancePremium/i,
    /Policyholder/i,
    /LossesAndLossAdjustment/i,
    /ClaimsAndClaimAdjustment/i,
    /UnearnedPremium/i,
    /Reinsurance/i,
  ]);

  const strongSpacName = /\b(SPECIAL PURPOSE ACQUISITION|BLANK CHECK|ACQUISITION (?:CORP|CORPORATION|CO|COMPANY))\b/.test(name);
  const strongSpacSector = /\b(BLANK CHECK|SPAC|SPECIAL PURPOSE ACQUISITION)\b/.test(sector);
  const strongSpacConcept = containsConcept(concepts, [
    /RedeemableCommonStock/i,
    /ClassACommonStockSubjectToPossibleRedemption/i,
    /TrustAccount/i,
    /Sponsor/i,
  ]);

  const genericFinancialSector = /\b(FINANCIAL SERVICES|CAPITAL MARKETS|BROKERAGE|ASSET MANAGEMENT|INVESTMENT MANAGEMENT|SECURITIES)\b/.test(sector);
  const genericFinancialName = /\b(BROKER|BROKERAGE|ASSET MANAGEMENT|CAPITAL MARKETS|SECURITIES)\b/.test(name);

  if (strongRealEstateName) reasonCodes.push('REAL_ESTATE_NAME_SIGNAL');
  if (strongRealEstateSector) reasonCodes.push('REAL_ESTATE_SECTOR_SIGNAL');
  if (strongRealEstateConcept) reasonCodes.push('REAL_ESTATE_XBRL_SIGNAL');
  if (strongBankName) reasonCodes.push('BANK_NAME_SIGNAL');
  if (strongBankSector) reasonCodes.push('BANK_SECTOR_SIGNAL');
  if (strongBankConcept) reasonCodes.push('BANK_XBRL_SIGNAL');
  if (strongInsuranceName) reasonCodes.push('INSURANCE_NAME_SIGNAL');
  if (strongInsuranceSector) reasonCodes.push('INSURANCE_SECTOR_SIGNAL');
  if (strongInsuranceConcept) reasonCodes.push('INSURANCE_XBRL_SIGNAL');
  if (strongSpacName) reasonCodes.push('SPAC_NAME_SIGNAL');
  if (strongSpacSector) reasonCodes.push('SPAC_SECTOR_SIGNAL');
  if (strongSpacConcept) reasonCodes.push('SPAC_XBRL_SIGNAL');
  if (genericFinancialSector) reasonCodes.push('FINANCIAL_SERVICES_SECTOR_SIGNAL');
  if (genericFinancialName) reasonCodes.push('FINANCIAL_SERVICES_NAME_SIGNAL');

  let type = 'GENERIC_OPERATING';
  // Explicit entity identity/sector always outranks incidental accounting facts.
  // A bank can hold real estate, an insurer can report investment property, and
  // a SPAC can report generic cash/revenue concepts; those facts must not route
  // the issuer into an economically wrong valuation model.
  if (strongRealEstateName || strongRealEstateSector) type = 'REAL_ESTATE';
  else if (strongBankName || strongBankSector || strongBankConcept) type = 'FINANCIAL_INSTITUTION';
  else if (strongInsuranceName || strongInsuranceSector || strongInsuranceConcept) type = 'INSURANCE';
  else if (strongSpacName || strongSpacSector || strongSpacConcept) type = 'SPAC';
  else if (genericFinancialSector || genericFinancialName) type = 'FINANCIAL_SERVICES_OTHER';
  else if (strongRealEstateConcept) type = 'REAL_ESTATE';

  const specializedModelRequired = type !== 'GENERIC_OPERATING';
  const requiredSpecializedMetrics = {
    REAL_ESTATE: ['NOI_OR_FFO', 'NAV_OR_ASSET_VALUE', 'NET_DEBT', 'OCCUPANCY_OR_RENTAL_METRICS'],
    FINANCIAL_INSTITUTION: ['CAPITAL_ADEQUACY', 'ASSET_QUALITY', 'LOANS_AND_DEPOSITS', 'ROTE_OR_ROE'],
    INSURANCE: ['SOLVENCY_OR_RBC', 'COMBINED_OR_LOSS_RATIO', 'RESERVE_ADEQUACY', 'BOOK_VALUE_OR_ROE'],
    SPAC: ['TRUST_VALUE_PER_SHARE', 'REDEMPTION_TERMS', 'DEAL_DEADLINE', 'SPONSOR_DILUTION', 'DEAL_STATUS'],
    FINANCIAL_SERVICES_OTHER: ['REGULATORY_CAPITAL_OR_NET_CAPITAL', 'AUM_OR_CLIENT_ASSETS', 'FEE_ECONOMICS', 'ROE_OR_MARGIN'],
  }[type] || [];

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
