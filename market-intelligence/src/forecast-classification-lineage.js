export const FORECAST_CLASSIFICATION_LINEAGE_VERSION = '2026-08-11.1';
export const FORECAST_CLASSIFICATION_CONTRACT = 'FORECAST_TIME_CLASSIFICATION_SNAPSHOT_V1';

function normalizedIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizedSic(value) {
  const text = String(value ?? '').trim();
  if (!/^\d{1,4}$/.test(text)) return null;
  return text.padStart(4, '0');
}

function normalizedDescription(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || null;
}

function paddedCik(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits ? digits.padStart(10, '0') : null;
}

function athensIssuerId(value) {
  const digits = String(value ?? '').trim();
  return /^\d+$/.test(digits) ? digits : null;
}

export function buildSecForecastClassificationSnapshot(company = {}, payload = {}, options = {}) {
  const companyId = String(company.companyId || '').trim() || null;
  const instrumentId = String(company.instrumentId || company.companyId || '').trim() || null;
  const cik = paddedCik(company.cik || payload.cik);
  const code = normalizedSic(payload.sic);
  const description = normalizedDescription(payload.sicDescription);
  const capturedAt = normalizedIso(options.capturedAt || options.retrievedAt || Date.now());
  const sourceUrl = cik ? `https://data.sec.gov/submissions/CIK${cik}.json` : null;

  const diagnostics = [];
  if (!companyId || !instrumentId || !cik) diagnostics.push('SEC_CLASSIFICATION_IDENTITY_INCOMPLETE');
  if (!code) diagnostics.push('SEC_SIC_CLASSIFICATION_CODE_UNAVAILABLE');
  if (!description) diagnostics.push('SEC_SIC_CLASSIFICATION_DESCRIPTION_UNAVAILABLE');
  if (!capturedAt) diagnostics.push('SEC_CLASSIFICATION_CAPTURE_TIMESTAMP_INVALID');
  if (diagnostics.length) {
    return {
      snapshot: null,
      diagnostics: diagnostics.map((codeName) => ({ code: codeName, companyId })),
    };
  }

  return {
    snapshot: {
      contract: FORECAST_CLASSIFICATION_CONTRACT,
      policyVersion: FORECAST_CLASSIFICATION_LINEAGE_VERSION,
      companyId,
      instrumentId,
      sourceAuthority: 'SEC_EDGAR_SUBMISSIONS',
      sourceUrl,
      sourceDocumentId: `CIK${cik}`,
      capturedAt,
      taxonomy: 'SEC_SIC',
      code,
      description,
      inferenceUsed: false,
      decisionImpact: 'NONE',
    },
    diagnostics: [],
  };
}

export function buildAthensForecastClassificationSnapshot(company = {}, classification = {}, options = {}) {
  const companyId = String(company.companyId || '').trim() || null;
  const instrumentId = String(company.instrumentId || company.companyId || '').trim() || null;
  const issuerId = athensIssuerId(company.issuerId || classification.issuerId);
  const sector = normalizedDescription(classification.sector);
  const subSector = normalizedDescription(classification.subSector);
  const capturedAt = normalizedIso(options.capturedAt || options.retrievedAt || Date.now());
  const sourceUrl = issuerId ? `https://athens.euronext.com/en/market-data/issuers/${issuerId}` : null;

  const diagnostics = [];
  if (!companyId || !instrumentId || !issuerId) diagnostics.push('ATHENS_ICB_CLASSIFICATION_IDENTITY_INCOMPLETE');
  if (!sector) diagnostics.push('ATHENS_ICB_SECTOR_UNAVAILABLE');
  if (!subSector) diagnostics.push('ATHENS_ICB_SUBSECTOR_UNAVAILABLE');
  if (!capturedAt) diagnostics.push('ATHENS_ICB_CLASSIFICATION_CAPTURE_TIMESTAMP_INVALID');
  if (diagnostics.length) {
    return {
      snapshot: null,
      diagnostics: diagnostics.map((codeName) => ({ code: codeName, companyId })),
    };
  }

  return {
    snapshot: {
      contract: FORECAST_CLASSIFICATION_CONTRACT,
      policyVersion: FORECAST_CLASSIFICATION_LINEAGE_VERSION,
      companyId,
      instrumentId,
      sourceAuthority: 'EURONEXT_ATHENS_ISSUER_PROFILE',
      sourceUrl,
      sourceDocumentId: `EURONEXT_ATHENS_ISSUER_${issuerId}`,
      capturedAt,
      taxonomy: 'FTSE_RUSSELL_ICB',
      sector,
      subSector,
      description: `${sector} / ${subSector}`,
      inferenceUsed: false,
      decisionImpact: 'NONE',
    },
    diagnostics: [],
  };
}

function validateSecSnapshot(snapshot, errors) {
  if (snapshot.taxonomy !== 'SEC_SIC') errors.push('CLASSIFICATION_TAXONOMY_INVALID');
  if (!/^\d{4}$/.test(String(snapshot.code || ''))) errors.push('CLASSIFICATION_CODE_INVALID');
  if (!normalizedDescription(snapshot.description)) errors.push('CLASSIFICATION_DESCRIPTION_REQUIRED');
  if (!/^https:\/\/data\.sec\.gov\/submissions\/CIK\d{10}\.json$/.test(String(snapshot.sourceUrl || ''))) {
    errors.push('CLASSIFICATION_SOURCE_URL_INVALID');
  }
  const sourceCik = String(snapshot.sourceUrl || '').match(/CIK(\d{10})\.json$/)?.[1] || null;
  if (!sourceCik || snapshot.sourceDocumentId !== `CIK${sourceCik}`) errors.push('CLASSIFICATION_SOURCE_DOCUMENT_ID_INVALID');
}

function validateAthensSnapshot(snapshot, errors) {
  if (snapshot.taxonomy !== 'FTSE_RUSSELL_ICB') errors.push('CLASSIFICATION_TAXONOMY_INVALID');
  const sector = normalizedDescription(snapshot.sector);
  const subSector = normalizedDescription(snapshot.subSector);
  if (!sector) errors.push('CLASSIFICATION_SECTOR_REQUIRED');
  if (!subSector) errors.push('CLASSIFICATION_SUBSECTOR_REQUIRED');
  if (Object.prototype.hasOwnProperty.call(snapshot, 'code') && snapshot.code !== null && snapshot.code !== '') {
    errors.push('CLASSIFICATION_UNVERIFIED_CODE_FORBIDDEN');
  }
  if (sector && subSector && snapshot.description !== `${sector} / ${subSector}`) {
    errors.push('CLASSIFICATION_DESCRIPTION_MISMATCH');
  }
  const match = String(snapshot.sourceUrl || '').match(/^https:\/\/athens\.euronext\.com\/en\/market-data\/issuers\/(\d+)\/?$/);
  if (!match) errors.push('CLASSIFICATION_SOURCE_URL_INVALID');
  const issuerId = match?.[1] || null;
  if (!issuerId || snapshot.sourceDocumentId !== `EURONEXT_ATHENS_ISSUER_${issuerId}`) {
    errors.push('CLASSIFICATION_SOURCE_DOCUMENT_ID_INVALID');
  }
}

export function validateForecastClassificationSnapshot(snapshot, record = null) {
  const errors = [];
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return { ok: false, errors: ['CLASSIFICATION_SNAPSHOT_OBJECT_REQUIRED'] };
  }
  if (snapshot.contract !== FORECAST_CLASSIFICATION_CONTRACT) errors.push('CLASSIFICATION_CONTRACT_INVALID');
  if (snapshot.policyVersion !== FORECAST_CLASSIFICATION_LINEAGE_VERSION) errors.push('CLASSIFICATION_POLICY_VERSION_INVALID');
  if (snapshot.sourceAuthority === 'SEC_EDGAR_SUBMISSIONS') validateSecSnapshot(snapshot, errors);
  else if (snapshot.sourceAuthority === 'EURONEXT_ATHENS_ISSUER_PROFILE') validateAthensSnapshot(snapshot, errors);
  else errors.push('CLASSIFICATION_SOURCE_AUTHORITY_INVALID');
  if (snapshot.inferenceUsed !== false) errors.push('CLASSIFICATION_INFERENCE_FORBIDDEN');
  if (snapshot.decisionImpact !== 'NONE') errors.push('CLASSIFICATION_DECISION_IMPACT_FORBIDDEN');
  if (!snapshot.companyId) errors.push('CLASSIFICATION_COMPANY_ID_REQUIRED');
  if (!snapshot.instrumentId) errors.push('CLASSIFICATION_INSTRUMENT_ID_REQUIRED');
  const capturedAt = normalizedIso(snapshot.capturedAt);
  if (!capturedAt || capturedAt !== snapshot.capturedAt) errors.push('CLASSIFICATION_CAPTURE_TIMESTAMP_INVALID');

  if (record) {
    if (record.companyId && snapshot.companyId !== record.companyId) errors.push('CLASSIFICATION_COMPANY_ID_MISMATCH');
    if (record.instrumentId && snapshot.instrumentId !== record.instrumentId) errors.push('CLASSIFICATION_INSTRUMENT_ID_MISMATCH');
    const forecastAt = normalizedIso(record.forecastAt);
    if (capturedAt && forecastAt && new Date(capturedAt).getTime() > new Date(forecastAt).getTime()) {
      errors.push('CLASSIFICATION_CAPTURED_AFTER_FORECAST');
    }
  }

  return { ok: errors.length === 0, errors };
}

export function classificationSnapshotByCompany(snapshots = []) {
  const map = new Map();
  for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
    const validation = validateForecastClassificationSnapshot(snapshot);
    if (!validation.ok || !snapshot.companyId) continue;
    if (!map.has(snapshot.companyId)) map.set(snapshot.companyId, snapshot);
  }
  return map;
}
