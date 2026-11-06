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

// Never return exception messages, SQL text or arbitrary error properties.
export function audienceFailure(cause,status){
 const code=cause?.code??cause?.cause?.code;
 const httpStatus=Number.isInteger(status)&&status>=400&&status<=599?status:null;
 let kind='unknown';
 if(['EMFILE','ENFILE'].includes(code))kind='file_descriptor_limit';
 else if(cause?.name==='TimeoutError')kind='deadline';
 else if(code==='UND_ERR_CONNECT_TIMEOUT')kind='connect_timeout';
 else if(['ECONNRESET','ECONNREFUSED','EPIPE','UND_ERR_SOCKET'].includes(code))kind='connection_lost';
 else if(httpStatus!==null)kind='http_error';
 else if(cause?.name==='SyntaxError')kind='invalid_json';
 else if(code==='ERR_ASSERTION')kind='scope_validation';
 const serverCode=typeof code==='string'&&/^(?:[0-9][0-9A-Z]{4}|P0[0-9A-Z]{3}|XX[0-9A-Z]{3}|PGRST\d{3})$/.test(code)?code:null;
 return {kind,httpStatus,serverCode};
}

export function audienceFileLimits(text){
 const match=/^Max open files\s+(\d+)\s+(\d+)\s+files\s*$/m.exec(text);
 return match?{soft:Number(match[1]),hard:Number(match[2])}:null;
}

export function audienceJoinFailure(error){
 const text=typeof error?.message==='string'?error.message.slice(0,1024):'';
 if(/ConnectionRateLimitReached|Too many connected users/i.test(text))return 'connection_limit';
 if(/ClientJoinRateLimitReached|Too many joins per second/i.test(text))return 'join_rate_limit';
 if(/ChannelRateLimitReached|Too many channels/i.test(text))return 'channel_limit';
 if(/IncreaseConnectionPool|DatabaseLackOfConnections|DatabaseConnectionRateLimitReached/i.test(text))return 'database_capacity';
 if(/InvalidJWTToken|JwtSignatureError|Unauthorized/i.test(text))return 'authorization';
 return 'unknown';
}

// Observe the real SDK callback; retain the client identity used by the actual
// product's WeakMaps, exact channel args, subscription timeout and return value.
export function observeAudienceSubscriptions(client,onStatus){
 const channel=client.channel.bind(client);
 client.channel=(...args)=>{
  const result=channel(...args),subscribe=result.subscribe.bind(result);
  result.subscribe=(callback,timeout)=>subscribe((status,error)=>{
   try{onStatus(status,error);}finally{callback?.(status,error);}
  },timeout);
  return result;
 };
}
