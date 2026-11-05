import {it,expect} from 'vitest';
import {beginHudRestoration,currentHudSnapshot,recordHudRestoration,setHudRestorationDeadline,hudRestorationFailure} from './scale.restoration.mjs';
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
