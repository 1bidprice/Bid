import { normalizeSecEtfIdentity, parseSecNportEtf } from '../sec-nport-etf.js';

export const SEC_NPORT_ETF_PROVIDER_VERSION = '2026-08-12.1';

function officialNportUrl(value, cik) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.hostname !== 'www.sec.gov') return null;
    const match = url.pathname.match(/^\/Archives\/edgar\/data\/(\d+)\/\d+\/[^/]+\.xml$/i);
    if (!match) return null;
    if (cik && match[1] !== String(Number(cik))) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export const secNportEtfCapabilityProvider = Object.freeze({
  id: 'SEC_NPORT_ETF_PRIMARY_REGULATORY',
  policyVersion: SEC_NPORT_ETF_PROVIDER_VERSION,
  supports: ({ profile }) => profile?.assetClass === 'ETF',
  collect: async ({ instrument = {}, profile = {}, fetchImpl }) => {
    if (profile?.assetClass !== 'ETF') return { capabilities: {}, diagnostics: [] };

    const identity = normalizeSecEtfIdentity(instrument);
    const rawIdentity = instrument.secFundIdentity || instrument.fundIdentity?.sec || {};
    const sourceUrl = officialNportUrl(
      rawIdentity.nportPrimaryDocumentUrl || rawIdentity.latestNportPrimaryDocumentUrl,
      identity.cik,
    );
    const diagnostics = [];
    if (!identity.cik || !identity.seriesId) diagnostics.push({ code: 'ETF_SEC_FUND_IDENTITY_REQUIRED' });
    if (!sourceUrl) diagnostics.push({ code: 'ETF_SEC_NPORT_PRIMARY_DOCUMENT_URL_REQUIRED' });
    if (diagnostics.length) return { capabilities: {}, diagnostics };
    if (typeof fetchImpl !== 'function') return { capabilities: {}, diagnostics: [{ code: 'ETF_SEC_NPORT_FETCH_IMPLEMENTATION_REQUIRED' }] };

    const response = await fetchImpl(sourceUrl, { headers: { Accept: 'application/xml,text/xml' } });
    if (!response?.ok) {
      return { capabilities: {}, diagnostics: [{ code: 'ETF_SEC_NPORT_FETCH_FAILED', status: response?.status ?? null }] };
    }

    const parsed = parseSecNportEtf(await response.text(), identity);
    const provenance = {
      providerId: 'SEC_NPORT_ETF_PRIMARY_REGULATORY',
      providerPolicyVersion: SEC_NPORT_ETF_PROVIDER_VERSION,
      sourceRole: 'PRIMARY_REGULATORY',
      sourceAuthority: 'SEC_EDGAR_FORM_NPORT',
      sourceUrl,
      cik: identity.cik,
      seriesId: identity.seriesId,
    };
    return {
      capabilities: Object.fromEntries(Object.entries(parsed.capabilities || {}).map(([key, value]) => [key, { ...value, ...provenance }])),
      diagnostics: parsed.diagnostics || [],
    };
  },
});
