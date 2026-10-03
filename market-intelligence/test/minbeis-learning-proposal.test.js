import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMinbeisLearningProposals, buildMinbeisProposalShadowObservations, mergeMinbeisLearningProposalArchive } from '../src/minbeis-learning-proposal.js';

test('proposal freezes an evidence-backed bad BUY context for prospective shadow validation',()=>{
  const set=buildMinbeisLearningProposals({
    cohorts:{actionRegime:[{
      key:'BUY_PROBE|RISK_OFF',dimension:'actionRegime',sampleSize:30,distinctDecisionDates:12,distinctInstruments:7,
      evidenceReady:true,averageDecisionAlignedReturnPct:-4.2,averageDecisionAlignedExcessPct:-3.1,positiveDecisionAlignedRatePct:36
    }]}
  },{createdAt:'2026-06-01T00:00:00Z'});
  assert.equal(set.proposalCount,1);
  assert.equal(set.proposals[0].challengerAction,'WATCH');
  assert.match(set.proposals[0].evidenceHash,/^[a-f0-9]{64}$/);
  assert.equal(set.automaticApplicationAllowed,false);
});

test('shadow validation ignores all decisions at or before proposal creation',()=>{
  const proposal=buildMinbeisLearningProposals({
    cohorts:{actionRegime:[{
      key:'BUY_PROBE|RISK_OFF',dimension:'actionRegime',sampleSize:30,distinctDecisionDates:12,distinctInstruments:7,
      evidenceReady:true,averageDecisionAlignedReturnPct:-4,averageDecisionAlignedExcessPct:-3,positiveDecisionAlignedRatePct:35
    }]}
  },{createdAt:'2026-06-01T00:00:00Z'}).proposals[0];
  const rows=buildMinbeisProposalShadowObservations(proposal,[
    {decisionId:'old',decisionAt:'2026-05-01T00:00:00Z',instrumentId:'a',action:'BUY_PROBE',contextSnapshot:{research:{marketRegimeSnapshot:{regime:'RISK_OFF'}}},horizons:{'30':{status:'MATURED',realisedReturnPct:-9}}},
    {decisionId:'new',decisionAt:'2026-07-01T00:00:00Z',instrumentId:'b',action:'BUY_PROBE',contextSnapshot:{research:{marketRegimeSnapshot:{regime:'RISK_OFF'}}},horizons:{'30':{status:'MATURED',realisedReturnPct:-8}}},
  ]);
  assert.deepEqual(rows.map(x=>x.decisionId),['new']);
  assert.equal(rows[0].challengerDeltaPct,8);
  assert.equal(rows[0].validationMode,'PROSPECTIVE_SHADOW_OOS');
});


test('stable proposal identity prevents validation clock reset for identical evidence',()=>{
  const learning={cohorts:{actionRegime:[{
    key:'BUY_PROBE|RISK_OFF',dimension:'actionRegime',sampleSize:30,distinctDecisionDates:12,distinctInstruments:7,
    evidenceReady:true,averageDecisionAlignedReturnPct:-4.2,averageDecisionAlignedExcessPct:-3.1,positiveDecisionAlignedRatePct:36
  }]}};
  const first=buildMinbeisLearningProposals(learning,{createdAt:'2026-06-01T00:00:00Z'});
  const second=buildMinbeisLearningProposals(learning,{createdAt:'2026-07-01T00:00:00Z'});
  assert.equal(first.proposals[0].proposalId,second.proposals[0].proposalId);
  const archive=mergeMinbeisLearningProposalArchive(first.proposals,second);
  assert.equal(archive.proposalCount,1);
  assert.equal(archive.newProposalCount,0);
  assert.equal(archive.proposals[0].createdAt,'2026-06-01T00:00:00.000Z');
});
