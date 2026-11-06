// A stopped scope is not evidence that an HTTP failure was cancellation.
// The table transport supplies its own canonical provenance marker.
export function ownedAudienceCancellation(cause,controller,timeout,kind='http'){
 if(kind==='table')return cause?.publicTableCallerCancelled===true;
 return controller.signal.aborted&&!timeout.aborted
  &&(cause===controller.signal.reason||cause?.name==='AbortError');
}

// PublicTournamentClock also reloads participation-derived counts on ranking.
// Reconnect and withdrawal invalidate a pending request even without a clock hint.
export function audienceClockSignal(event){
 const invalidate=event.reason!=='status'&&(event.invalidatePending===true
  ||event.reason==='changed'&&event.components.includes('visibility'));
 return {invalidate,reload:event.reason!=='status'&&(invalidate
  ||event.components.includes('clock')||event.components.includes('ranking'))};
}
