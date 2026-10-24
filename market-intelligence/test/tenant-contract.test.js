import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeVerifiedPrincipal,
  deriveTenantId,
  tenantResourceKey,
  assertTenantOwnership,
  minimalAccountAudit,
} from '../gateway/src/tenant-contract.js';

const SECRET='0123456789abcdef0123456789abcdef0123456789abcdef';

test('tenant id is pseudonymous, deterministic and issuer-scoped', async () => {
  const p={verified:true,issuer:'https://auth.example',subject:'user-123'};
  const a=await deriveTenantId(p,SECRET);
  const b=await deriveTenantId(p,SECRET);
  const c=await deriveTenantId({...p,issuer:'https://other.example'},SECRET);
  assert.equal(a,b);
  assert.notEqual(a,c);
  assert.match(a,/^tenant_[a-f0-9]{40}$/);
  assert.equal(a.includes('user-123'),false);
});

test('self-asserted or incomplete identity is rejected', async () => {
  assert.equal(normalizeVerifiedPrincipal({verified:false,issuer:'x',subject:'y'}),null);
  await assert.rejects(deriveTenantId({verified:false,issuer:'x',subject:'y'},SECRET),/TENANT_VERIFIED_PRINCIPAL_REQUIRED/);
});

test('tenant resource keys cannot cross scopes', async () => {
  const a=await deriveTenantId({verified:true,issuer:'https://auth.example',subject:'a'},SECRET);
  const b=await deriveTenantId({verified:true,issuer:'https://auth.example',subject:'b'},SECRET);
  assert.match(tenantResourceKey(a,'devices','install_0123456789abcdef'),new RegExp('^'+a+':devices:'));
  assert.throws(()=>assertTenantOwnership(a,b),/TENANT_SCOPE_VIOLATION/);
  assert.equal(assertTenantOwnership(a,a),true);
});

test('account audit stores no subject/email/portfolio', async () => {
  const principal={verified:true,issuer:'https://auth.example',subject:'private-user-id'};
  const tenant=await deriveTenantId(principal,SECRET);
  const audit=minimalAccountAudit(principal,tenant,'install_0123456789abcdef',Date.parse('2026-10-03T12:00:00Z'));
  assert.equal(audit.subjectStored,false);
  assert.equal(audit.emailStored,false);
  assert.equal(audit.portfolioStored,false);
  assert.equal(JSON.stringify(audit).includes('private-user-id'),false);
});
