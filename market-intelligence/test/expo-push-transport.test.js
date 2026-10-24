import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPO_PUSH_BATCH_SIZE,
  chunkExpoPushMessages,
  sendExpoPushMessages,
  fetchExpoPushReceipts,
} from '../gateway/src/expo-push-transport.js';

const token=(i)=>`ExpoPushToken[${String(i).padStart(24,'A')}]`;
const message=(i)=>({
  to:token(i),
  title:'MINBEIS',
  body:'SPCE.US: υπάρχει νέα μεταβολή στην αξιολόγηση MINBEIS.',
  data:{symbol:'SPCE.US',kind:'MINBEIS_DECISION_CHANGE'},
  channelId:'market-intelligence',
});

test('push transport chunks at Expo hard request ceiling',()=>{
  const chunks=chunkExpoPushMessages(Array.from({length:205},(_,i)=>message(i)));
  assert.equal(EXPO_PUSH_BATCH_SIZE,100);
  assert.deepEqual(chunks.map((x)=>x.length),[100,100,5]);
});

test('push transport rejects arbitrary sensitive data payloads',()=>{
  assert.throws(()=>chunkExpoPushMessages([{
    ...message(1),
    data:{symbol:'SPCE.US',kind:'MINBEIS_DECISION_CHANGE',pnl:-500,quantity:720},
  }]),/PUSH_DATA_/);
});

test('push transport batches requests and returns invalid device tokens',async()=>{
  const calls=[];
  const result=await sendExpoPushMessages([message(1),message(2)],{
    fetchImpl:async(url,init)=>{
      calls.push({url:String(url),body:JSON.parse(init.body)});
      return new Response(JSON.stringify({data:[
        {status:'ok',id:'ticket-11111111'},
        {status:'error',message:'gone',details:{error:'DeviceNotRegistered'}},
      ]}),{status:200,headers:{'Content-Type':'application/json'}});
    },
  });
  assert.equal(calls.length,1);
  assert.equal(calls[0].body.length,2);
  assert.deepEqual(result.invalidTokens,[token(2)]);
});

test('push transport retries 429 with bounded exponential backoff',async()=>{
  let attempts=0;
  const sleeps=[];
  const result=await sendExpoPushMessages([message(1)],{
    maxAttempts:3,
    sleep:async(ms)=>{sleeps.push(ms);},
    fetchImpl:async()=>{
      attempts+=1;
      if(attempts<3) return new Response('{}',{status:429,headers:{'Content-Type':'application/json'}});
      return new Response(JSON.stringify({data:[{status:'ok',id:'ticket-22222222'}]}),{status:200,headers:{'Content-Type':'application/json'}});
    },
  });
  assert.equal(attempts,3);
  assert.deepEqual(sleeps,[250,500]);
  assert.equal(result.tickets[0].status,'ok');
});

test('receipt fetch is bounded and preserves delivery errors',async()=>{
  const result=await fetchExpoPushReceipts(['receipt-11111111'],{
    fetchImpl:async()=>new Response(JSON.stringify({data:{
      'receipt-11111111':{status:'error',details:{error:'DeviceNotRegistered'}},
    }}),{status:200,headers:{'Content-Type':'application/json'}}),
  });
  assert.equal(result.receiptCount,1);
  assert.deepEqual(result.invalidReceiptIds,['receipt-11111111']);
});
