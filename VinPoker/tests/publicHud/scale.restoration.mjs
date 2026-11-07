export function currentHudSnapshot(state){
 return !!state.frozen&&state.hudCompletedEpoch===state.hudEpoch&&!state.hudActive&&!state.historyActive&&state.historySnapshot===state.frozen;
}
// A source withdrawal can commit between a summary and its independent history.
// This classifies only a definitive denial in the exact acknowledged TEST scope;
// it never turns that denial into history success or recovery credit.
export function committedHistoryWithdrawalDenial(value,attempt,receipt){
 if(!value||Object.keys(value).length!==1||value.access!=='revoked'||!receipt||receipt.hiddenConfirmed!==true)return false;
 if(attempt.tour!==receipt.tour)return false;
 const {startedAt,finishedAt}=attempt,{hideRequestedAt,hideAckAt,restoreStartedAt}=receipt;
 if(![startedAt,finishedAt,hideRequestedAt,hideAckAt].every(x=>Number.isFinite(x)&&x>=0)||startedAt>finishedAt||hideRequestedAt>hideAckAt)return false;
 if(restoreStartedAt!==null&&(!Number.isFinite(restoreStartedAt)||restoreStartedAt<hideAckAt))return false;
 return finishedAt>=hideRequestedAt&&(restoreStartedAt===null||finishedAt<restoreStartedAt);
}
export function beginHudRestoration(state,now=Date.now()){
 state.restoration={launchedAt:now,minEpoch:state.hudEpoch+1,deadlineAt:null,receiptAt:null,events:[]};
 recordHudRestoration(state,'reopen-launched',now);
}
export function recordHudRestoration(state,event,now=Date.now()){
 const wave=state.restoration;if(!wave)return;
 if(wave.deadlineAt!==null&&now>wave.deadlineAt)return;
 if(wave.events.length<48)wave.events.push({event,elapsedMs:now-wave.launchedAt,epoch:state.hudEpoch,completedEpoch:state.hudCompletedEpoch,
  frozen:!!state.frozen,hudActive:!!state.hudActive,historyActive:!!state.historyActive,historyMatches:!!state.frozen&&state.historySnapshot===state.frozen,
  timerPending:!!state.hudTimerPending,verifyAfterRead:!!state.verifyAfterRead});
 if(wave.receiptAt===null&&state.hudEpoch>=wave.minEpoch&&currentHudSnapshot(state))wave.receiptAt=now;
}
export function setHudRestorationDeadline(state,deadlineAt){
 if(!state.restoration||state.restoration.deadlineAt!==null)throw Error('One restoration deadline required');
 state.restoration.deadlineAt=deadlineAt;
}
export function hudRestorationFailure(clients,scenario,now=Date.now()){
 const missing=clients.map((state,index)=>({state,index})).filter(({state})=>state.restoration?.receiptAt==null);
 return {scenario,at:now,missing:missing.length,clients:missing.slice(0,100).map(({state,index})=>({viewer:index,
  epoch:state.hudEpoch,completedEpoch:state.hudCompletedEpoch,frozen:!!state.frozen,hudActive:!!state.hudActive,historyActive:!!state.historyActive,
  historyMatches:!!state.frozen&&state.historySnapshot===state.frozen,timerPending:!!state.hudTimerPending,verifyAfterRead:!!state.verifyAfterRead,
  restoration:state.restoration??null}))};
}
