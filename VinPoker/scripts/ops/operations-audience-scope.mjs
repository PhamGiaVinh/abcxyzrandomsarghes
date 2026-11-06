import {channel} from 'node:diagnostics_channel';
import {createHash} from 'node:crypto';

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
 else if(code==='UND_ERR_HEADERS_TIMEOUT')kind='headers_timeout';
 else if(code==='UND_ERR_BODY_TIMEOUT')kind='body_timeout';
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

export function audienceGatewayConfig(text,{allowImplicitLimits=false}={}){
 let ambiguous=false;
 const read=name=>{
  const matches=[...text.matchAll(new RegExp('^\\s*'+name+'\\s+(\\d+)\\s*;','gm'))];
  if(matches.length>1)ambiguous=true;
  return matches.length===1?Number(matches[0][1]):null;
 };
 const value={workers:read('worker_processes'),connectionsPerWorker:read('worker_connections'),fileLimitPerWorker:read('worker_rlimit_nofile')};
 if(allowImplicitLimits&&!ambiguous&&Number.isSafeInteger(value.workers)&&value.workers>0&&Object.values(value).every(n=>n===null||Number.isSafeInteger(n)&&n>0))return value;
 return Object.values(value).every(n=>Number.isSafeInteger(n)&&n>0)?value:null;
}

export function prepareAudienceGatewayTemplate(text){
 // Exact public CLI2.101.0 template; its custom events block omits Kong's
 // normal injected resource directives, so environment settings alone cannot
 // change worker_connections. Add only the two explicit resource directives.
 // CLI writes the embedded file through a heredoc, adding a final newline.
 // Normalize only that trailing newline count, retaining every body byte.
 if(createHash('sha256').update(text.replace(/\n+$/,'\n')).digest('hex')!=='c51eab99a3e358ff6515a0ded65ed9b1516b58dd9e19c8974b847402b3a7356f')throw Error('Pinned isolated gateway template drift');
 return text.replace('events {',()=> 'worker_rlimit_nofile 16384;\n\nevents {\n    worker_connections 4096;');
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

// Phoenix normalizes channel errors and can hide the original ErrorEvent.
// Inspect its logger input before normalization; never serialize the input,
// endpoint, topic, close reason or arbitrary exception text.
export function audienceSocketDiagnostic(kind,message,data){
 let event=null;
 if(kind==='transport'){
  if(message==='error')event='transport_error';
  else if(message==='close')event='transport_close';
  else if(typeof message==='string'&&message.startsWith('connected to '))event='transport_open';
  else if(message==='heartbeat timeout. Attempting to re-establish connection')event='heartbeat_timeout';
 }else if(kind==='channel'&&typeof message==='string'){
  if(message.startsWith('error '))event='channel_error';
  else if(message.startsWith('timeout '))event='channel_timeout';
 }
 if(!event)return null;
 let failure=audienceFailure(data),joinKind=audienceJoinFailure(data),closeCode=null;
 const queue=[data],seen=new Set();
 for(let i=0;i<queue.length&&i<8;i++){
  const item=queue[i];if(!item||typeof item!=='object'||seen.has(item))continue;seen.add(item);
  const candidate=audienceFailure(item);if(failure.kind==='unknown'&&candidate.kind!=='unknown')failure=candidate;
  const joined=audienceJoinFailure(item);if(joinKind==='unknown'&&joined!=='unknown')joinKind=joined;
  if(closeCode===null&&Number.isInteger(item.code)&&item.code>=1000&&item.code<=4999)closeCode=item.code;
  queue.push(item.cause,item.error);
 }
 return {event,...failure,joinKind,closeCode};
}

// Native WebSocket deliberately hides the failed HTTP handshake status in its
// ErrorEvent. Observe Undici's real request diagnostics without replacing its
// dispatcher, transport, retry policy or timeout. Nothing from the URL is emitted.
export function observeAudienceHandshake(origin,onEvent){
 const target=new URL(origin);
 if(target.protocol!=='http:'||target.hostname!=='127.0.0.1'||target.username||target.password||target.pathname!=='/')throw Error('Loopback handshake diagnostic required');
 const owned=new WeakSet(),listeners=[];
 const listen=(name,callback)=>{const stream=channel(name),safe=value=>{try{callback(value);}catch{/* Observability cannot change the request outcome. */}};stream.subscribe(safe);listeners.push(()=>stream.unsubscribe(safe));};
 listen('undici:request:create',({request})=>{
  if(String(request.origin)===target.origin&&typeof request.path==='string'&&request.path.startsWith('/realtime/v1/websocket?'))owned.add(request);
 });
 listen('undici:request:headers',({request,response})=>{
  if(!owned.has(request))return;
  const status=response?.statusCode;if(Number.isInteger(status)&&status>=100&&status<=599)onEvent({event:'handshake_response',httpStatus:status});
 });
 listen('undici:request:error',({request,error})=>{
  if(owned.has(request))onEvent({event:'handshake_request_error',...audienceFailure(error)});
 });
 return ()=>listeners.forEach(stop=>stop());
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
