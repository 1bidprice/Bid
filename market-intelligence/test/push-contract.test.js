import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeExpoPushToken,
  normalizePushRegistration,
  normalizeServerAlertRule,
  buildPrivacySafePushMessage,
} from '../gateway/src/push-contract.js';

const TENANT='tenant_'+'a'.repeat(40);
const TOKEN='ExpoPushToken['+'A'.repeat(24)+']';

test('push registration is tenant/device scoped and portfolio-minimal',()=>{
  assert.equal(normalizeExpoPushToken(TOKEN),TOKEN);
  const registration=normalizePushRegistration({
    tenantId:TENANT,
    installationId:'install_0123456789abcdef',
    pushToken:TOKEN,
    platform:'android',
    locale:'el-GR',
  });
  assert.equal(registration.privacy.portfolioQuantityStored,false);
  assert.equal(registration.privacy.portfolioCostStored,false);
  assert.equal(registration.privacy.pnlStored,false);
});

test('server alert rule never requires holdings or cost basis',()=>{
  const rule=normalizeServerAlertRule({
    tenantId:TENANT,
    ruleId:'rule_01234567',
    symbol:'SPCE.US',
    kind:'PRICE_BELOW',
    threshold:2.5,
  });
  assert.equal(rule.symbol,'SPCE.US');
  assert.equal(rule.privacy.quantityRequired,false);
  assert.equal(rule.privacy.costBasisRequired,false);
  assert.equal(rule.privacy.pnlRequired,false);
});

test('privacy-safe push body contains no portfolio amounts',()=>{
  const message=buildPrivacySafePushMessage({symbol:'ALWN.GR',kind:'MINBEIS_DECISION_CHANGE'});
  assert.match(message.body,/ALWN\.GR/);
  assert.equal(message.containsPortfolioQuantity,false);
  assert.equal(message.containsCostBasis,false);
  assert.equal(message.containsPnl,false);
});

test('invalid push tokens and alert thresholds fail closed',()=>{
  assert.equal(normalizeExpoPushToken('abc'),null);
  assert.throws(()=>normalizeServerAlertRule({
    tenantId:TENANT,ruleId:'rule_01234567',symbol:'SPCE.US',kind:'PRICE_ABOVE',threshold:null,
  }),/ALERT_THRESHOLD_INVALID/);
});
