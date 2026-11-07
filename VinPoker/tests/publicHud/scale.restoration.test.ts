import {it,expect} from 'vitest';
import {beginHudRestoration,currentHudSnapshot,recordHudRestoration,setHudRestorationDeadline,hudRestorationFailure,committedHistoryWithdrawalDenial} from './scale.restoration.mjs';
const viewer=()=>({frozen:{} as object|null,historySnapshot:null as unknown,hudEpoch:3,hudCompletedEpoch:3,hudActive:false,historyActive:false,restoration:null as any});
it('requires a post-reopen owned epoch and the history of that exact snapshot',()=>{
 const state=viewer();state.historySnapshot=state.frozen;beginHudRestoration(state,100);
 recordHudRestoration(state,'old-completion',101);expect(state.restoration.receiptAt).toBeNull();
 state.hudEpoch=4;state.hudCompletedEpoch=4;state.historySnapshot={};recordHudRestoration(state,'wrong-history',102);expect(state.restoration.receiptAt).toBeNull();
 state.historySnapshot=state.frozen;state.historyActive=true;recordHudRestoration(state,'active-history',103);expect(state.restoration.receiptAt).toBeNull();
 state.historyActive=false;recordHudRestoration(state,'history-completed',104);expect(state.restoration.receiptAt).toBe(104);
});
it('retains each receipt across later revocation without counting it as final-current',()=>{
 const state=viewer();beginHudRestoration(state,100);state.hudEpoch=4;state.hudCompletedEpoch=4;state.historySnapshot=state.frozen;
 recordHudRestoration(state,'complete',110);state.hudEpoch++;state.frozen=null;state.historySnapshot=null;
 recordHudRestoration(state,'revoked',120);expect(state.restoration.receiptAt).toBe(110);expect(currentHudSnapshot(state)).toBe(false);
 expect(hudRestorationFailure([state],'distributed',130).missing).toBe(0);
});
it('never credits a cancelled, superseded or late response and never resets the deadline',()=>{
 const state=viewer();beginHudRestoration(state,100);setHudRestorationDeadline(state,200);
 state.hudEpoch=5;state.hudCompletedEpoch=4;state.historySnapshot=state.frozen;recordHudRestoration(state,'superseded',150);expect(state.restoration.receiptAt).toBeNull();
 state.hudCompletedEpoch=5;state.hudActive=true;recordHudRestoration(state,'cancel-pending',160);expect(state.restoration.receiptAt).toBeNull();
 state.hudActive=false;recordHudRestoration(state,'too-late',201);expect(state.restoration.receiptAt).toBeNull();
 expect(()=>setHudRestorationDeadline(state,300)).toThrow();expect(hudRestorationFailure([state],'distributed',202).missing).toBe(1);
});


it('recognizes only an exact acknowledged withdrawal overlapping the history response',()=>{
 const receipt={tour:'tour20',hideRequestedAt:100,hideAckAt:120,hiddenConfirmed:true,restoreStartedAt:200};
 const attempt={tour:'tour20',startedAt:90,finishedAt:110};
 expect(committedHistoryWithdrawalDenial({access:'revoked'},attempt,receipt)).toBe(true);
 // A response before the hide ACK is reconciled only after true confirmation.
 expect(committedHistoryWithdrawalDenial({access:'revoked'},attempt,{...receipt,hiddenConfirmed:false})).toBe(false);
 for(const value of [{access:'public',state:'warming'},{access:'public',state:'unavailable'},{access:'revoked',counters:{publicHands:100}},{publicHudDeadline:true}])expect(committedHistoryWithdrawalDenial(value,attempt,receipt)).toBe(false);
 for(const change of [{tour:'other'},{finishedAt:99},{finishedAt:200},{startedAt:201,finishedAt:210},{startedAt:NaN}])expect(committedHistoryWithdrawalDenial({access:'revoked'},{...attempt,...change},receipt)).toBe(false);
 for(const change of [{hideAckAt:null},{hideAckAt:99},{hiddenConfirmed:false},{restoreStartedAt:119}])expect(committedHistoryWithdrawalDenial({access:'revoked'},attempt,{...receipt,...change})).toBe(false);
});
it('never certifies history or restoration from an expected denial',()=>{
 const state=viewer();beginHudRestoration(state,100);state.hudEpoch=4;state.hudCompletedEpoch=4;
 const receipt={tour:'tour20',hideRequestedAt:100,hideAckAt:120,hiddenConfirmed:true,restoreStartedAt:null};
 expect(committedHistoryWithdrawalDenial({access:'revoked'},{tour:'tour20',startedAt:90,finishedAt:130},receipt)).toBe(true);
 state.frozen=null;state.historySnapshot=null;recordHudRestoration(state,'history-finished',140);
 expect(currentHudSnapshot(state)).toBe(false);expect(state.restoration.receiptAt).toBeNull();
});
