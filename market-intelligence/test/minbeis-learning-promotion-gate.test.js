import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMinbeisLearningPromotionGate } from '../src/minbeis-learning-promotion-gate.js';

function rows(n, delta=2){
  return Array.from({length:n},(_,i)=>({
    proposalId:'p1',decisionId:'d'+i,decisionAt:`2026-${String((i%6)+1).padStart(2,'0')}-${String((i%27)+1).padStart(2,'0')}T00:00:00Z`,
    instrumentId:'c'+(i%12),challengerDeltaPct:delta,validationMode:'PROSPECTIVE_SHADOW_OOS'
  }));
}

test('promotion gate remains shadow-only with inadequate prospective evidence',()=>{
  const r=evaluateMinbeisLearningPromotionGate({proposalId:'p1'},rows(10));
  assert.equal(r.status,'SHADOW_RESEARCH_ONLY');
  assert.equal(r.automaticPromotionAllowed,false);
  assert.ok(r.blockers.includes('PROMOTION_PROSPECTIVE_SAMPLE_TOO_SMALL'));
});

test('promotion gate can produce a candidate but never auto-promotes',()=>{
  const r=evaluateMinbeisLearningPromotionGate({proposalId:'p1'},rows(90),{
    minimumSample:60,minimumDistinctDates:20,minimumDistinctInstruments:10,minimumBlockSample:15
  });
  assert.equal(r.status,'PROMOTION_CANDIDATE');
  assert.equal(r.promotionCandidate,true);
  assert.equal(r.automaticPromotionAllowed,false);
  assert.equal(r.productionMutationAllowed,false);
  assert.equal(r.requiresExplicitHumanApproval,true);
});

test('chronologically unstable challenger is blocked',()=>{
  const rws=rows(90,2).map((x,i)=>({...x,challengerDeltaPct:i<60?2:-3}));
  const r=evaluateMinbeisLearningPromotionGate({proposalId:'p1'},rws,{
    minimumSample:60,minimumDistinctDates:20,minimumDistinctInstruments:10,minimumBlockSample:15
  });
  assert.equal(r.status,'SHADOW_RESEARCH_ONLY');
  assert.ok(r.blockers.includes('PROMOTION_NOT_STABLE_ACROSS_SUBPERIODS'));
});
