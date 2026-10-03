export const INSTRUMENT_SAVE_PREFLIGHT_VERSION = '2026-10-04.1';

const DEFINITIVE_REJECTION_CODES = new Set([
  'SYMBOL_INVALID',
  'ATHENS_SYMBOL_IDENTITY_NOT_FOUND',
  'ATHENS_SYMBOL_IDENTITY_AMBIGUOUS',
  'ATHENS_STABLE_IDENTITY_REQUIRED',
  'FINNHUB_IDENTITY_MISMATCH',
]);

function clean(value) {
  return String(value || '').trim().toUpperCase();
}

export function classifyInstrumentSavePreflight(capability = null, error = null) {
  if (error) {
    return {
      status: 'PENDING_CONFIRMATION',
      reason: clean(error?.gatewayCode || error?.code || error?.message || 'IDENTITY_CHECK_UNAVAILABLE'),
    };
  }

  if (capability?.identityVerified === true) {
    return {
      status: 'VERIFIED',
      reason: clean(capability.identityStatusReason || 'IDENTITY_VERIFIED'),
    };
  }

  const reason = clean(
    capability?.identityStatusReason
    || capability?.error
    || capability?.onboardingStatus
    || 'IDENTITY_NOT_VERIFIED',
  );

  if (DEFINITIVE_REJECTION_CODES.has(reason)) {
    return { status: 'REJECTED', reason };
  }

  return {
    status: 'PENDING_CONFIRMATION',
    reason,
  };
}
