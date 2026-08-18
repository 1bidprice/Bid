import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInstrumentProfile } from '../src/instrument-profile.js';
import { gateBroadEquityOpportunityCandidate, gateDeepEquityOpportunityModel } from '../src/opportunity-model-gate.js';

function equityProfile(name = 'Ordinary Industrial Corp') {
  return buildInstrumentProfile({
    instrumentId: `eq:${name}`,
    displayName: name,
    legalName: name,
    assetClass: 'EQUITY',
    primaryListing: { symbol: 'TEST', mic: 'XNYS', exchange: 'NYSE', currency: 'USD' },
  });
}

test('broad identity gate quarantines specialized equities before generic opportunity scoring', () => {
  const bank = gateBroadEquityOpportunityCandidate({ displayName: 'Example Bancorp Inc.', legalName: 'Example Bancorp Inc.' });
  const reit = gateBroadEquityOpportunityCandidate({ displayName: 'Example Realty Trust', legalName: 'Example Realty Trust' });
  const insurer = gateBroadEquityOpportunityCandidate({ displayName: 'Example Insurance Holdings', legalName: 'Example Insurance Holdings' });
  const spac = gateBroadEquityOpportunityCandidate({ displayName: 'Example Acquisition Corp', legalName: 'Example Acquisition Corp' });
  const industrial = gateBroadEquityOpportunityCandidate({ displayName: 'Example Manufacturing Inc.', legalName: 'Example Manufacturing Inc.' });

  for (const gated of [bank, reit, insurer, spac]) {
    assert.equal(gated.eligible, false);
    assert.equal(gated.reason, 'SPECIALIZED_MODEL_REQUIRES_DEDICATED_OPPORTUNITY_LANE');
    assert.equal(gated.model.specializedModelRequired, true);
  }
  assert.equal(industrial.eligible, true);
  assert.equal(industrial.model.type, 'GENERIC_OPERATING');
});

test('deep gate requires verified generic fundamental model even when instrument profile looks ordinary', () => {
  const profile = equityProfile();
  const noModel = gateDeepEquityOpportunityModel(profile, { metricsReady: true });
  assert.equal(noModel.eligible, false);
  assert.equal(noModel.reason, 'FUNDAMENTAL_MODEL_NOT_VERIFIED');

  const bankByXbrl = gateDeepEquityOpportunityModel(profile, {
    model: {
      type: 'FINANCIAL_INSTITUTION',
      genericValuationEligible: false,
      specializedModelRequired: true,
      modelReady: false,
    },
  });
  assert.equal(bankByXbrl.eligible, false);
  assert.equal(bankByXbrl.reason, 'SPECIALIZED_MODEL_REQUIRES_DEDICATED_OPPORTUNITY_LANE');

  const ordinary = gateDeepEquityOpportunityModel(profile, {
    model: {
      type: 'GENERIC_OPERATING',
      genericValuationEligible: true,
      specializedModelRequired: false,
      modelReady: true,
    },
  });
  assert.equal(ordinary.eligible, true);
  assert.equal(ordinary.reason, 'GENERIC_OPERATING_MODEL_VERIFIED');
});
