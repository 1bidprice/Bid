export const HISTORICAL_RESEARCH_VALIDATION_UNIVERSE_CONTRACT = 'HISTORICAL_RESEARCH_STABLE_VALIDATION_UNIVERSE_V1';
export const HISTORICAL_RESEARCH_VALIDATION_UNIVERSE_VERSION = '2026-08-16.2';
export const HISTORICAL_RESEARCH_VALIDATION_UNIVERSE_MINIMUM_LOADED_INSTRUMENTS = 12;

function equity({ companyId, legalName, displayName, exchange, symbol, mic, country, currency, sector, industry }) {
  return Object.freeze({
    companyId,
    legalName,
    displayName,
    primaryListing: Object.freeze({ exchange, symbol, mic }),
    listings: Object.freeze([
      Object.freeze({ exchange, symbol, mic, currency, active: true }),
    ]),
    cik: null,
    country,
    currency,
    sector,
    industry,
    active: true,
  });
}

// Research-only US validation cohort. Membership is intentionally versioned
// and independent of current news/event discovery and observed forecast skill.
// Athens is intentionally excluded from this proof because it uses a different
// benchmark/data domain and requires its own fail-closed validation proof.
const VALIDATION_UNIVERSE = Object.freeze([
  equity({ companyId: 'company:realty-income', legalName: 'Realty Income Corporation', displayName: 'Realty Income', exchange: 'New York Stock Exchange', symbol: 'O', mic: 'XNYS', country: 'US', currency: 'USD', sector: 'Real Estate', industry: 'Retail REITs' }),
  equity({ companyId: 'company:virgin-galactic-holdings', legalName: 'Virgin Galactic Holdings, Inc.', displayName: 'Virgin Galactic', exchange: 'New York Stock Exchange', symbol: 'SPCE', mic: 'XNYS', country: 'US', currency: 'USD', sector: 'Industrials', industry: 'Commercial spaceflight' }),
  equity({ companyId: 'company:apple', legalName: 'Apple Inc.', displayName: 'Apple', exchange: 'Nasdaq', symbol: 'AAPL', mic: 'XNAS', country: 'US', currency: 'USD', sector: 'Information Technology', industry: 'Technology hardware' }),
  equity({ companyId: 'company:microsoft', legalName: 'Microsoft Corporation', displayName: 'Microsoft', exchange: 'Nasdaq', symbol: 'MSFT', mic: 'XNAS', country: 'US', currency: 'USD', sector: 'Information Technology', industry: 'Software' }),
  equity({ companyId: 'company:jpmorgan-chase', legalName: 'JPMorgan Chase & Co.', displayName: 'JPMorgan Chase', exchange: 'New York Stock Exchange', symbol: 'JPM', mic: 'XNYS', country: 'US', currency: 'USD', sector: 'Financials', industry: 'Banks' }),
  equity({ companyId: 'company:exxon-mobil', legalName: 'Exxon Mobil Corporation', displayName: 'Exxon Mobil', exchange: 'New York Stock Exchange', symbol: 'XOM', mic: 'XNYS', country: 'US', currency: 'USD', sector: 'Energy', industry: 'Integrated oil and gas' }),
  equity({ companyId: 'company:johnson-johnson', legalName: 'Johnson & Johnson', displayName: 'Johnson & Johnson', exchange: 'New York Stock Exchange', symbol: 'JNJ', mic: 'XNYS', country: 'US', currency: 'USD', sector: 'Health Care', industry: 'Pharmaceuticals and medical products' }),
  equity({ companyId: 'company:procter-gamble', legalName: 'The Procter & Gamble Company', displayName: 'Procter & Gamble', exchange: 'New York Stock Exchange', symbol: 'PG', mic: 'XNYS', country: 'US', currency: 'USD', sector: 'Consumer Staples', industry: 'Household products' }),
  equity({ companyId: 'company:walmart', legalName: 'Walmart Inc.', displayName: 'Walmart', exchange: 'New York Stock Exchange', symbol: 'WMT', mic: 'XNYS', country: 'US', currency: 'USD', sector: 'Consumer Staples', industry: 'Consumer retail' }),
  equity({ companyId: 'company:caterpillar', legalName: 'Caterpillar Inc.', displayName: 'Caterpillar', exchange: 'New York Stock Exchange', symbol: 'CAT', mic: 'XNYS', country: 'US', currency: 'USD', sector: 'Industrials', industry: 'Machinery' }),
  equity({ companyId: 'company:nextera-energy', legalName: 'NextEra Energy, Inc.', displayName: 'NextEra Energy', exchange: 'New York Stock Exchange', symbol: 'NEE', mic: 'XNYS', country: 'US', currency: 'USD', sector: 'Utilities', industry: 'Electric utilities' }),
  equity({ companyId: 'company:coca-cola', legalName: 'The Coca-Cola Company', displayName: 'Coca-Cola', exchange: 'New York Stock Exchange', symbol: 'KO', mic: 'XNYS', country: 'US', currency: 'USD', sector: 'Consumer Staples', industry: 'Beverages' }),
  equity({ companyId: 'company:home-depot', legalName: 'The Home Depot, Inc.', displayName: 'Home Depot', exchange: 'New York Stock Exchange', symbol: 'HD', mic: 'XNYS', country: 'US', currency: 'USD', sector: 'Consumer Discretionary', industry: 'Specialty retail' }),
  equity({ companyId: 'company:walt-disney', legalName: 'The Walt Disney Company', displayName: 'Walt Disney', exchange: 'New York Stock Exchange', symbol: 'DIS', mic: 'XNYS', country: 'US', currency: 'USD', sector: 'Communication Services', industry: 'Entertainment' }),
  equity({ companyId: 'company:nvidia', legalName: 'NVIDIA Corporation', displayName: 'NVIDIA', exchange: 'Nasdaq', symbol: 'NVDA', mic: 'XNAS', country: 'US', currency: 'USD', sector: 'Information Technology', industry: 'Semiconductors' }),
  equity({ companyId: 'company:visa', legalName: 'Visa Inc.', displayName: 'Visa', exchange: 'New York Stock Exchange', symbol: 'V', mic: 'XNYS', country: 'US', currency: 'USD', sector: 'Financials', industry: 'Payment networks' }),
]);

export function buildHistoricalResearchValidationUniverse() {
  return VALIDATION_UNIVERSE.map((company) => ({
    ...company,
    primaryListing: { ...company.primaryListing },
    listings: company.listings.map((listing) => ({ ...listing })),
  }));
}

export function summarizeHistoricalResearchValidationUniverse(universe = VALIDATION_UNIVERSE) {
  const companies = Array.isArray(universe) ? universe : [];
  const uniqueCompanyIds = new Set(companies.map((company) => company?.companyId).filter(Boolean));
  const uniqueListings = new Set(companies.map((company) => {
    const symbol = String(company?.primaryListing?.symbol || '').toUpperCase();
    const mic = String(company?.primaryListing?.mic || '').toUpperCase();
    return symbol && mic ? `${mic}:${symbol}` : null;
  }).filter(Boolean));
  const sectors = new Set(companies.map((company) => company?.sector).filter(Boolean));
  const canonicalIdentityReadyCount = companies.filter((company) => (
    typeof company?.companyId === 'string'
    && company.companyId.length > 0
    && typeof company?.primaryListing?.symbol === 'string'
    && company.primaryListing.symbol.length > 0
    && typeof company?.primaryListing?.mic === 'string'
    && company.primaryListing.mic.length > 0
  )).length;
  const usEquityCount = companies.filter((company) => company?.country === 'US' && ['XNYS', 'XNAS'].includes(company?.primaryListing?.mic)).length;

  return {
    contract: HISTORICAL_RESEARCH_VALIDATION_UNIVERSE_CONTRACT,
    version: HISTORICAL_RESEARCH_VALIDATION_UNIVERSE_VERSION,
    configuredInstrumentCount: companies.length,
    uniqueCompanyCount: uniqueCompanyIds.size,
    uniqueListingCount: uniqueListings.size,
    canonicalIdentityReadyCount,
    usEquityCount,
    sectorCount: sectors.size,
    minimumLoadedInstrumentCount: HISTORICAL_RESEARCH_VALIDATION_UNIVERSE_MINIMUM_LOADED_INSTRUMENTS,
    marketDomain: 'US_EQUITY',
    benchmarkFamily: 'SPY',
    selectionBasis: 'PREDECLARED_SECTOR_DIVERSE_LONG_HISTORY_US_EQUITY_VALIDATION_COHORT',
    currentNewsDependentSelection: false,
    outcomeAwareSelectionAllowed: false,
    eventDiscoveryAdditionsAllowed: false,
    crossMarketValidationIncluded: false,
    athensDomainValidated: false,
    athensDomainStatus: 'SEPARATE_DOMAIN_PROOF_REQUIRED',
    normalProductionDefaultChanged: false,
    selectionThresholdsChanged: false,
    statisticalReadinessThresholdsChanged: false,
    rawCompanyRecordsIncluded: false,
    historicalResearchOnly: true,
    automaticModelPromotionAllowed: false,
    decisionImpact: 'NONE',
  };
}
