export const SOURCE_GOVERNOR_VERSION = '2026-08-04.1';

const PURPOSES = Object.freeze({
  DISCOVERY: 'DISCOVERY',
  OFFICIAL_DOCUMENT: 'OFFICIAL_DOCUMENT',
  FUNDAMENTALS: 'FUNDAMENTALS',
  CURRENT_QUOTE: 'CURRENT_QUOTE',
  PRICE_HISTORY: 'PRICE_HISTORY',
  BENCHMARK: 'BENCHMARK',
  INDEPENDENT_CORROBORATION: 'INDEPENDENT_CORROBORATION',
});

const SOURCE_ROLES = Object.freeze({
  PRIMARY_REGULATORY: 'PRIMARY_REGULATORY',
  PRIMARY_EXCHANGE: 'PRIMARY_EXCHANGE',
  PRIMARY_ISSUER: 'PRIMARY_ISSUER',
  LICENSED_MARKET_DATA: 'LICENSED_MARKET_DATA',
  SECONDARY_INDEPENDENT: 'SECONDARY_INDEPENDENT',
  FALLBACK_UNVERIFIED: 'FALLBACK_UNVERIFIED',
  UNKNOWN: 'UNKNOWN',
});

const RULES = Object.freeze([
  {
    id: 'sec-regulatory',
    domains: ['sec.gov', 'www.sec.gov', 'data.sec.gov'],
    sourceRole: SOURCE_ROLES.PRIMARY_REGULATORY,
    markets: ['US'],
    purposes: [PURPOSES.DISCOVERY, PURPOSES.OFFICIAL_DOCUMENT, PURPOSES.FUNDAMENTALS],
    tier: 1,
  },
  {
    id: 'euronext-exchange',
    domains: ['euronext.com', 'live.euronext.com', 'athens.euronext.com'],
    sourceRole: SOURCE_ROLES.PRIMARY_EXCHANGE,
    markets: ['EU', 'GR'],
    purposes: [PURPOSES.DISCOVERY, PURPOSES.OFFICIAL_DOCUMENT, PURPOSES.CURRENT_QUOTE],
    tier: 1,
  },
  {
    id: 'issuer-primary',
    domains: [],
    sourceRole: SOURCE_ROLES.PRIMARY_ISSUER,
    markets: ['US', 'EU', 'GR', 'GLOBAL'],
    purposes: [PURPOSES.OFFICIAL_DOCUMENT, PURPOSES.FUNDAMENTALS],
    tier: 1,
    requiresIssuerMatch: true,
  },
  {
    id: 'finnhub-market-data',
    domains: ['finnhub.io'],
    sourceRole: SOURCE_ROLES.LICENSED_MARKET_DATA,
    markets: ['US', 'GLOBAL'],
    purposes: [PURPOSES.CURRENT_QUOTE, PURPOSES.PRICE_HISTORY, PURPOSES.BENCHMARK],
    tier: 1,
  },
  {
    id: 'yahoo-fallback',
    domains: ['finance.yahoo.com', 'query1.finance.yahoo.com', 'query2.finance.yahoo.com'],
    sourceRole: SOURCE_ROLES.FALLBACK_UNVERIFIED,
    markets: ['US', 'EU', 'GR', 'GLOBAL'],
    purposes: [PURPOSES.CURRENT_QUOTE, PURPOSES.PRICE_HISTORY, PURPOSES.BENCHMARK],
    tier: 4,
  },
]);

const INDEPENDENT_PUBLISHERS = Object.freeze({
  reuters: { name: 'Reuters', domains: ['reuters.com'], tier: 2 },
  bloomberg: { name: 'Bloomberg', domains: ['bloomberg.com'], tier: 2 },
  'financial times': { name: 'Financial Times', domains: ['ft.com'], tier: 2 },
  'the wall street journal': { name: 'The Wall Street Journal', domains: ['wsj.com'], tier: 2 },
  'associated press': { name: 'Associated Press', domains: ['apnews.com'], tier: 2 },
  cnbc: { name: 'CNBC', domains: ['cnbc.com'], tier: 3 },
  marketwatch: { name: 'MarketWatch', domains: ['marketwatch.com'], tier: 3 },
  fortune: { name: 'Fortune', domains: ['fortune.com'], tier: 3 },
});

function normalizeHost(value) {
  try {
    return new URL(String(value || '')).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function normalizeMarket(value) {
  const market = String(value || '').trim().toUpperCase();
  if (['XATH', 'ATHENS', 'GR', 'GREECE'].includes(market)) return 'GR';
  if (['US', 'NYSE', 'NASDAQ', 'AMEX'].includes(market)) return 'US';
  if (['EU', 'EURONEXT', 'EUROPE'].includes(market)) return 'EU';
  return market || 'GLOBAL';
}

function domainMatches(host, domain) {
  const normalized = String(domain || '').toLowerCase().replace(/^www\./, '');
  return Boolean(host && normalized && (host === normalized || host.endsWith(`.${normalized}`)));
}

function publisherMatch(host, sourceName) {
  const name = String(sourceName || '').trim().toLowerCase();
  for (const [id, publisher] of Object.entries(INDEPENDENT_PUBLISHERS)) {
    if (name === id || name.includes(id) || publisher.domains.some((domain) => domainMatches(host, domain))) {
      return { id, ...publisher };
    }
  }
  return null;
}

function roleCapabilities(sourceRole) {
  return {
    decisionEligible: [
      SOURCE_ROLES.PRIMARY_REGULATORY,
      SOURCE_ROLES.PRIMARY_EXCHANGE,
      SOURCE_ROLES.PRIMARY_ISSUER,
      SOURCE_ROLES.LICENSED_MARKET_DATA,
    ].includes(sourceRole),
    corroborationEligible: sourceRole === SOURCE_ROLES.SECONDARY_INDEPENDENT,
    discoveryEligible: sourceRole !== SOURCE_ROLES.UNKNOWN,
  };
}

export function evaluateSourceCandidate(candidate = {}) {
  const purpose = String(candidate.purpose || PURPOSES.DISCOVERY).toUpperCase();
  const market = normalizeMarket(candidate.market || candidate.mic || candidate.exchange);
  const host = normalizeHost(candidate.url || candidate.sourceUrl);
  const sourceName = String(candidate.sourceName || candidate.name || '').trim();
  const issuerDomain = normalizeHost(candidate.issuerUrl || candidate.investorRelationsUrl || candidate.companyWebsite);
  const reasons = [];

  const publisher = publisherMatch(host, sourceName);
  if (publisher) {
    const allowed = purpose === PURPOSES.INDEPENDENT_CORROBORATION || purpose === PURPOSES.DISCOVERY;
    if (!allowed) reasons.push('INDEPENDENT_SOURCE_NOT_ALLOWED_FOR_PRIMARY_DATA');
    return {
      allowed,
      policyVersion: SOURCE_GOVERNOR_VERSION,
      ruleId: `publisher:${publisher.id}`,
      sourceRole: SOURCE_ROLES.SECONDARY_INDEPENDENT,
      tier: publisher.tier,
      host,
      market,
      purpose,
      ...roleCapabilities(SOURCE_ROLES.SECONDARY_INDEPENDENT),
      reasons,
    };
  }

  for (const rule of RULES) {
    const marketAllowed = rule.markets.includes('GLOBAL') || rule.markets.includes(market);
    const purposeAllowed = rule.purposes.includes(purpose);
    const domainAllowed = rule.requiresIssuerMatch
      ? Boolean(host && issuerDomain && domainMatches(host, issuerDomain))
      : rule.domains.some((domain) => domainMatches(host, domain));
    if (!marketAllowed || !purposeAllowed || !domainAllowed) continue;
    return {
      allowed: true,
      policyVersion: SOURCE_GOVERNOR_VERSION,
      ruleId: rule.id,
      sourceRole: rule.sourceRole,
      tier: rule.tier,
      host,
      market,
      purpose,
      ...roleCapabilities(rule.sourceRole),
      reasons,
    };
  }

  reasons.push(host ? 'SOURCE_DOMAIN_NOT_APPROVED' : 'SOURCE_URL_MISSING_OR_INVALID');
  return {
    allowed: false,
    policyVersion: SOURCE_GOVERNOR_VERSION,
    ruleId: null,
    sourceRole: SOURCE_ROLES.UNKNOWN,
    tier: null,
    host,
    market,
    purpose,
    ...roleCapabilities(SOURCE_ROLES.UNKNOWN),
    reasons,
  };
}

export function buildSourcePlan(input = {}) {
  const company = input.company || {};
  const market = normalizeMarket(company.primaryListing?.mic || company.primaryListing?.exchange || company.country);
  const purpose = String(input.purpose || PURPOSES.DISCOVERY).toUpperCase();
  const requiredRoles = {
    [PURPOSES.DISCOVERY]: [SOURCE_ROLES.PRIMARY_REGULATORY, SOURCE_ROLES.PRIMARY_EXCHANGE, SOURCE_ROLES.PRIMARY_ISSUER],
    [PURPOSES.OFFICIAL_DOCUMENT]: [SOURCE_ROLES.PRIMARY_REGULATORY, SOURCE_ROLES.PRIMARY_EXCHANGE, SOURCE_ROLES.PRIMARY_ISSUER],
    [PURPOSES.FUNDAMENTALS]: [SOURCE_ROLES.PRIMARY_REGULATORY, SOURCE_ROLES.PRIMARY_ISSUER],
    [PURPOSES.CURRENT_QUOTE]: [SOURCE_ROLES.PRIMARY_EXCHANGE, SOURCE_ROLES.LICENSED_MARKET_DATA],
    [PURPOSES.PRICE_HISTORY]: [SOURCE_ROLES.LICENSED_MARKET_DATA],
    [PURPOSES.BENCHMARK]: [SOURCE_ROLES.LICENSED_MARKET_DATA],
    [PURPOSES.INDEPENDENT_CORROBORATION]: [SOURCE_ROLES.SECONDARY_INDEPENDENT],
  }[purpose] || [];

  const approvedRules = RULES
    .filter((rule) => rule.purposes.includes(purpose) && (rule.markets.includes('GLOBAL') || rule.markets.includes(market)))
    .map((rule) => ({ id: rule.id, sourceRole: rule.sourceRole, tier: rule.tier, domains: rule.domains }));

  return {
    policyVersion: SOURCE_GOVERNOR_VERSION,
    selector: 'DETERMINISTIC_SOURCE_GOVERNOR',
    market,
    purpose,
    companyId: company.companyId || null,
    requiredRoles,
    approvedRules,
    independentPublisherCount: Object.keys(INDEPENDENT_PUBLISHERS).length,
    runtimeAiMayPropose: true,
    runtimeAiMayApprove: false,
    unknownDomainPolicy: 'REJECT',
  };
}

export function sourceGovernorSummary() {
  return {
    version: SOURCE_GOVERNOR_VERSION,
    selector: 'DETERMINISTIC_SOURCE_GOVERNOR',
    runtimeAiSourceSelection: false,
    runtimeAiMayProposeSources: true,
    officialRuleCount: RULES.filter((rule) => rule.tier === 1).length,
    independentPublisherCount: Object.keys(INDEPENDENT_PUBLISHERS).length,
    rules: {
      unknownDomainsRejected: true,
      primarySourceRequiredForFinalAction: true,
      independentClaimConfirmationRequired: true,
      unresolvedContradictionBlocksAction: true,
      staleReferencePriceBlocksAction: true,
      rawProviderErrorsHiddenFromUsers: true,
    },
  };
}

export function independentPublisherPolicies() {
  return INDEPENDENT_PUBLISHERS;
}

export { PURPOSES, SOURCE_ROLES };
