import { buildInstrumentProfile, ASSET_CLASS } from './instrument-profile.js';

export const INSTRUMENT_ROUTER_VERSION = '2026-08-08.1';

function isAthens(profile) {
  return profile?.listing?.mic === 'XATH' || /ATHENS/i.test(String(profile?.listing?.exchange || ''));
}

function isUSListed(profile, instrument) {
  return instrument?.country === 'US' || ['XNYS', 'XNAS', 'ARCX', 'BATS'].includes(String(profile?.listing?.mic || '').toUpperCase());
}

function route(name, adapter, status = 'SUPPORTED', notes = []) {
  return { capability: name, adapter, status, notes };
}

export function buildInstrumentRoute(instrument = {}, context = {}) {
  const profile = context.profile || buildInstrumentProfile(instrument, context);
  const routes = {};

  if (profile.assetClass === ASSET_CLASS.EQUITY) {
    routes.market = isAthens(profile)
      ? route('MARKET_PRICE', 'EURONEXT_ATHENS_QUOTE')
      : isUSListed(profile, instrument)
        ? route('MARKET_PRICE', 'PROFESSIONAL_US_MARKET')
        : route('MARKET_PRICE', 'PROFESSIONAL_MARKET_FALLBACK', 'PARTIAL');

    routes.history = route('PRICE_HISTORY', 'PROFESSIONAL_MARKET_HISTORY');
    routes.officialEvidence = profile.identifiers.cik
      ? route('OFFICIAL_FILINGS', 'SEC_SUBMISSIONS')
      : isAthens(profile)
        ? route('OFFICIAL_FILINGS', 'EURONEXT_ATHENS_ANNOUNCEMENTS')
        : route('OFFICIAL_FILINGS', null, 'UNAVAILABLE');
    routes.fundamentals = profile.identifiers.cik
      ? route('FUNDAMENTALS', 'SEC_COMPANY_FACTS')
      : isAthens(profile)
        ? route('FUNDAMENTALS', 'EURONEXT_ATHENS_FINANCIALS')
        : route('FUNDAMENTALS', null, 'UNAVAILABLE');
  } else if (profile.assetClass === ASSET_CLASS.ETF) {
    routes.market = route('MARKET_PRICE', 'PROFESSIONAL_MARKET_FALLBACK', 'PARTIAL');
    routes.history = route('PRICE_HISTORY', 'PROFESSIONAL_MARKET_HISTORY', 'PARTIAL');
    routes.analytics = route('ETF_ANALYTICS', null, 'REQUIRES_PROVIDER', ['HOLDINGS', 'EXPENSE_RATIO', 'TRACKING_ERROR']);
  } else {
    routes.market = route('MARKET_PRICE', null, 'REQUIRES_PROVIDER');
    routes.analytics = route(profile.analysisModel, null, 'REQUIRES_PROVIDER', profile.requiredCapabilities);
  }

  const unavailable = Object.values(routes).filter((item) => item.status === 'UNAVAILABLE' || item.status === 'REQUIRES_PROVIDER');
  return {
    format: 'investor-control-instrument-route',
    version: 1,
    policyVersion: INSTRUMENT_ROUTER_VERSION,
    instrumentId: profile.instrumentId,
    assetClass: profile.assetClass,
    analysisModel: profile.analysisModel,
    profile,
    routes,
    endToEndReady: unavailable.length === 0,
    blockers: unavailable.map((item) => `${item.capability}:${item.status}`),
    routingInvariant: 'CAPABILITY_AND_VENUE_ROUTING_ONLY',
  };
}
