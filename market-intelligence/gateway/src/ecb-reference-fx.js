export const ECB_EUR_REFERENCE_RATES_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

function diagnostic(code, message, extra = {}) {
  return { code, message, ...extra };
}

function parseEcbReferenceXml(xml) {
  const text = String(xml || '');
  const dateMatch = text.match(/<Cube\b[^>]*\btime=["'](\d{4}-\d{2}-\d{2})["'][^>]*>/i);
  const usdMatch = text.match(/<Cube\b[^>]*\bcurrency=["']USD["'][^>]*\brate=["']([0-9]+(?:\.[0-9]+)?)["'][^>]*\/?\s*>/i);
  const rate = usdMatch ? Number(usdMatch[1]) : null;
  if (!dateMatch || !Number.isFinite(rate) || rate <= 0) return null;
  return { referenceDate: dateMatch[1], rate };
}

export async function fetchEcbEurUsdReference(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const checkedAt = new Date(options.generatedAt || Date.now()).toISOString();
  if (typeof fetchImpl !== 'function') {
    return {
      reference: null,
      diagnostics: [diagnostic('ECB_FETCH_RUNTIME_UNAVAILABLE', 'Server fetch runtime is unavailable.')],
    };
  }

  let response;
  try {
    response = await fetchImpl(ECB_EUR_REFERENCE_RATES_URL, {
      headers: { Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.5' },
    });
  } catch (error) {
    return {
      reference: null,
      diagnostics: [diagnostic('ECB_REQUEST_FAILED', 'ECB reference-rate request failed.', { detail: error instanceof Error ? error.message : String(error) })],
    };
  }

  if (!response?.ok) {
    return {
      reference: null,
      diagnostics: [diagnostic('ECB_HTTP_ERROR', 'ECB reference-rate request returned a non-success status.', { status: response?.status ?? null })],
    };
  }

  const parsed = parseEcbReferenceXml(await response.text());
  if (!parsed) {
    return {
      reference: null,
      diagnostics: [diagnostic('ECB_EURUSD_NOT_VERIFIED', 'ECB EUR/USD reference rate or reference date could not be verified.')],
    };
  }

  return {
    reference: {
      pair: 'EURUSD',
      baseCurrency: 'EUR',
      quoteCurrency: 'USD',
      rate: parsed.rate,
      referenceDate: parsed.referenceDate,
      checkedAt,
      source: 'European Central Bank euro foreign exchange reference rates',
      sourceUrl: ECB_EUR_REFERENCE_RATES_URL,
      sourceQuality: 'OFFICIAL_DAILY_REFERENCE',
      rateMeaning: 'USD per EUR',
      exactMarketTimestampVerified: false,
      valuationReferenceEligible: true,
      transactionEligible: false,
      decisionEligible: false,
      publicationCadence: 'working-days-around-16:00-CET',
    },
    diagnostics: [diagnostic('ECB_OFFICIAL_DAILY_REFERENCE', 'Official ECB daily EUR/USD reference rate loaded for reference valuation only.')],
  };
}

export { parseEcbReferenceXml };
