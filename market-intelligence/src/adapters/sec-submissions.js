import { contentHash } from '../content-hash.js';

function isoDate(dateText) {
  if (!dateText) return null;
  const date = new Date(`${dateText}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function paddedCik(cik) {
  const digits = String(cik || '').replace(/\D/g, '');
  if (!digits) throw new Error('SEC adapter requires a CIK');
  return digits.padStart(10, '0');
}

export async function fetchSecRecentFilings(company, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('SEC adapter requires fetch');

  const userAgent = String(options.userAgent || '').trim();
  if (!userAgent) {
    return {
      records: [],
      diagnostics: [{ code: 'SEC_USER_AGENT_MISSING', companyId: company.companyId }],
    };
  }

  const cik = paddedCik(company.cik);
  const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': userAgent,
    },
  });

  if (!response.ok) {
    throw new Error(`SEC submissions request failed: ${response.status}`);
  }

  const payload = await response.json();
  const recent = payload?.filings?.recent || {};
  const count = Math.min(
    Number(options.limit || 25),
    Array.isArray(recent.accessionNumber) ? recent.accessionNumber.length : 0,
  );
  const retrievedAt = new Date(options.retrievedAt || Date.now()).toISOString();
  const records = [];

  for (let index = 0; index < count; index += 1) {
    const accession = recent.accessionNumber?.[index];
    const form = recent.form?.[index];
    const filingDate = recent.filingDate?.[index];
    const reportDate = recent.reportDate?.[index] || filingDate;
    const primaryDocument = recent.primaryDocument?.[index];
    const items = recent.items?.[index] || '';
    if (!accession || !form || !filingDate || !primaryDocument) continue;

    const accessionCompact = String(accession).replace(/-/g, '');
    const sourceUrl = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionCompact}/${primaryDocument}`;
    const publishedAt = isoDate(filingDate);
    const eventAt = isoDate(reportDate) || publishedAt;
    if (!publishedAt || !eventAt) continue;

    const identity = {
      companyId: company.companyId,
      accession,
      form,
      filingDate,
      reportDate,
      primaryDocument,
      items,
    };

    records.push({
      id: `evidence:sec:${accession}`,
      sourceType: 'REGULATORY_FILING',
      sourceName: 'SEC EDGAR',
      sourceUrl,
      sourceDocumentId: accession,
      publishedAt,
      retrievedAt,
      eventAt,
      title: `${form} filing — ${company.displayName || company.legalName}`,
      rawText: null,
      contentHash: contentHash(identity),
      language: 'en',
      companyIds: [company.companyId],
      claimType: 'FACT',
      reliabilityTier: 1,
      isPrimarySource: true,
      independenceGroup: 'sec-edgar',
      supportsClaimIds: [],
      contradictsClaimIds: [],
      expiresAt: null,
      notes: items
        ? `Official SEC filing. Form ${form}. Reported items: ${items}.`
        : `Official SEC filing. Form ${form}.`,
    });
  }

  return { records, diagnostics: [] };
}
