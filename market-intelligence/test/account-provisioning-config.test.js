import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAccountEnabledWranglerConfig } from '../gateway/scripts/render-account-enabled-wrangler.mjs';

const base={
  name:'investor-control-market-gateway',
  main:'src/index.js',
  vars:{MINBEIS_ACCOUNT_API_ENABLED:'false'},
  kv_namespaces:[{binding:'MINBEIS_RESEARCH_QUEUE'}],
};

test('renderer enables accounts only with explicit Firebase and D1 identifiers',()=>{
  const rendered=buildAccountEnabledWranglerConfig(base,{
    firebaseProjectId:'minbeis-prod-1234',
    databaseId:'12345678-1234-1234-1234-123456789abc',
  });
  assert.equal(rendered.vars.MINBEIS_ACCOUNT_API_ENABLED,'true');
  assert.equal(rendered.vars.FIREBASE_PROJECT_ID,'minbeis-prod-1234');
  assert.deepEqual(rendered.d1_databases,[{
    binding:'MINBEIS_ACCOUNTS_DB',
    database_name:'minbeis-accounts',
    database_id:'12345678-1234-1234-1234-123456789abc',
  }]);
  assert.equal(rendered.kv_namespaces[0].binding,'MINBEIS_RESEARCH_QUEUE');
});

test('renderer fails closed when provisioning identifiers are absent',()=>{
  assert.throws(()=>buildAccountEnabledWranglerConfig(base,{
    firebaseProjectId:'',
    databaseId:'12345678-1234-1234-1234-123456789abc',
  }),/FIREBASE_PROJECT_ID_REQUIRED/);
  assert.throws(()=>buildAccountEnabledWranglerConfig(base,{
    firebaseProjectId:'minbeis-prod-1234',
    databaseId:'',
  }),/MINBEIS_ACCOUNTS_DB_ID_REQUIRED/);
});

test('renderer replaces only account binding and preserves unrelated bindings',()=>{
  const rendered=buildAccountEnabledWranglerConfig({
    ...base,
    d1_databases:[
      {binding:'OTHER_DB',database_name:'other',database_id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'},
      {binding:'MINBEIS_ACCOUNTS_DB',database_name:'old',database_id:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'},
    ],
  },{
    firebaseProjectId:'minbeis-prod-1234',
    databaseId:'cccccccc-cccc-cccc-cccc-cccccccccccc',
  });
  assert.equal(rendered.d1_databases.length,2);
  assert.equal(rendered.d1_databases.find((x)=>x.binding==='OTHER_DB').database_name,'other');
  assert.equal(rendered.d1_databases.find((x)=>x.binding==='MINBEIS_ACCOUNTS_DB').database_id,'cccccccc-cccc-cccc-cccc-cccccccccccc');
});
