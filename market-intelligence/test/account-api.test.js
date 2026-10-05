import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticatePrivateRequest } from '../gateway/src/auth-boundary.js';
import { handleAccountApiRequest } from '../gateway/src/account-api.js';

const SECRET='0123456789abcdef0123456789abcdef0123456789abcdef';
const INSTALL='install_0123456789abcdef';

function authRequest(token='valid-token-012345678901234567890') {
  return new Request('https://gateway.test/v1/account/alerts', {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Investor-Control-Client': INSTALL,
    },
  });
}

test('auth boundary derives tenant only from verified identity, never client input', async () => {
  const ctx=await authenticatePrivateRequest(authRequest(), {
    MINBEIS_TENANT_HMAC_SECRET:SECRET,
  }, {
    verifyIdentityToken: async () => ({
      verified:true,
      issuer:'https://securetoken.google.com/minbeis-test',
      subject:'firebase-user-123',
    }),
  });
  assert.equal(ctx.ok,true);
  assert.match(ctx.tenantId,/^tenant_[a-f0-9]{40}$/);
  assert.equal(ctx.tenantId.includes('firebase-user-123'),false);
  assert.equal(ctx.installationId,INSTALL);
  assert.equal(ctx.subjectStored,false);
});

test('auth boundary fails closed without verifier or bearer token', async () => {
  const noVerifier=await authenticatePrivateRequest(authRequest(), {
    MINBEIS_TENANT_HMAC_SECRET:SECRET,
  });
  assert.equal(noVerifier.ok,false);
  assert.equal(noVerifier.code,'AUTH_PROVIDER_NOT_CONFIGURED');

  const noToken=await authenticatePrivateRequest(new Request('https://gateway.test/v1/account',{
    headers:{'X-Investor-Control-Client':INSTALL},
  }),{MINBEIS_TENANT_HMAC_SECRET:SECRET},{verifyIdentityToken:async()=>({verified:true,issuer:'x',subject:'y'})});
  assert.equal(noToken.code,'AUTH_TOKEN_REQUIRED');
});

class FakeStatement {
  constructor(db,sql){this.db=db;this.sql=String(sql).replace(/\s+/g,' ').trim();this.args=[];}
  bind(...args){this.args=args;return this;}
  async run(){this.db.calls.push({sql:this.sql,args:this.args});return {success:true};}
  async first(){
    this.db.calls.push({sql:this.sql,args:this.args});
    if(this.sql.startsWith('SELECT tenant_id')) return {
      tenant_id:this.args[0],status:'ACTIVE',created_at:'2026-10-03T00:00:00.000Z',updated_at:'2026-10-03T00:00:00.000Z'
    };
    return null;
  }
  async all(){
    this.db.calls.push({sql:this.sql,args:this.args});
    if(this.sql.includes('FROM alert_rules')) {
      return {results:this.db.alerts.filter((x)=>x.tenant_id===this.args[0]).map((x)=>({
        rule_id:x.rule_id,symbol:x.symbol,kind:x.kind,threshold:x.threshold,enabled:x.enabled,
        created_at:x.created_at,updated_at:x.updated_at,
      }))};
    }
    return {results:[]};
  }
}
class FakeDb {
  constructor(){this.calls=[];this.alerts=[];}
  prepare(sql){return new FakeStatement(this,sql);}
  async batch(statements){for(const s of statements) await s.run();return statements.map(()=>({success:true}));}
}

const TENANT='tenant_'+'a'.repeat(40);
const OTHER='tenant_'+'b'.repeat(40);
const CTX={tenantId:TENANT,installationId:INSTALL};

test('device API rejects portfolio fields and stores only device metadata', async () => {
  const db=new FakeDb();
  const response=await handleAccountApiRequest(new Request('https://gateway.test/v1/account/device',{
    method:'POST',
    body:JSON.stringify({
      pushToken:'ExpoPushToken['+'A'.repeat(24)+']',
      platform:'android',
      quantity:100,
    }),
  }),CTX,{}, {db,now:Date.parse('2026-10-03T00:00:00Z')});
  assert.equal(response.status,400);
  assert.equal((await response.json()).error.code,'DEVICE_PRIVACY_CONTRACT_INVALID');
  assert.equal(db.calls.length,0);
});

test('device API binds server tenant and installation, not body identity', async () => {
  const db=new FakeDb();
  const response=await handleAccountApiRequest(new Request('https://gateway.test/v1/account/device',{
    method:'POST',
    body:JSON.stringify({
      pushToken:'ExpoPushToken['+'A'.repeat(24)+']',
      platform:'android',
      locale:'el-GR',
    }),
  }),CTX,{}, {db,now:Date.parse('2026-10-03T00:00:00Z')});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.tenantId,TENANT);
  assert.equal(body.installationId,INSTALL);
  assert.equal(body.portfolioStored,false);
  assert.equal(JSON.stringify(db.calls).includes(OTHER),false);
});

test('alert listing is tenant scoped', async () => {
  const db=new FakeDb();
  db.alerts=[
    {tenant_id:TENANT,rule_id:'rule_01234567',symbol:'SPCE.US',kind:'PRICE_BELOW',threshold:2.5,enabled:1,created_at:'x',updated_at:'x'},
    {tenant_id:OTHER,rule_id:'rule_99999999',symbol:'ALWN.GR',kind:'PRICE_ABOVE',threshold:20,enabled:1,created_at:'x',updated_at:'x'},
  ];
  const response=await handleAccountApiRequest(new Request('https://gateway.test/v1/account/alerts'),CTX,{}, {db});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.deepEqual(body.rules.map((x)=>x.ruleId),['rule_01234567']);
  const select=db.calls.find((x)=>x.sql.includes('FROM alert_rules'));
  assert.deepEqual(select.args,[TENANT]);
});

test('account deletion is tenant-keyed and never claims cloud portfolio deletion', async () => {
  const db=new FakeDb();
  const response=await handleAccountApiRequest(new Request('https://gateway.test/v1/account',{method:'DELETE'}),CTX,{}, {db});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.deleted,true);
  assert.equal(body.portfolioDeletedFromCloud,false);
  const deletion=db.calls.find((x)=>x.sql==='DELETE FROM tenants WHERE tenant_id = ?');
  assert.deepEqual(deletion.args,[TENANT]);
});
