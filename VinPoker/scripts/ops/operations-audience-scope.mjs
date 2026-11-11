import {channel} from 'node:diagnostics_channel';
import {createHash} from 'node:crypto';
import http from 'node:http';
import {isIP} from 'node:net';

// Re-entry telemetry exports fixed phase durations/counts only, never header text.
export function reentryServerTiming(header){
 const unavailable={capture:'unavailable'};
 if(typeof header!=='string'||header.length>4096)return unavailable;
 const phases={};let totalMs;
 for(const part of header.split(',').map(x=>x.trim())){
  if(!/^reentry_/.test(part))continue;
  const match=/^reentry_(auth|tour|configuration|registration|notification|total);dur=([0-9]+(?:\.[0-9]+)?)(?:;desc="([1-9][0-9]?)")?$/.exec(part);
  if(!match)return unavailable;
  const [,phase,duration,count]=match,ms=Number(duration);
  if(!Number.isFinite(ms)||ms>120000)return unavailable;
  if(phase==='total'){if(totalMs!==undefined||count!==undefined)return unavailable;totalMs=ms;}
  else {if(Object.hasOwn(phases,phase)||count===undefined||Number(count)>10)return unavailable;phases[phase]={ms,calls:Number(count)};}
 }
 if(totalMs===undefined)return unavailable;
 return {capture:'available',totalMs,phases};
}

// Whitelist scalar pool counters only. Never retain labels or arbitrary metrics.
export function audiencePoolStats(text){
 const names={pgrst_db_pool_available:'available',pgrst_db_pool_waiting:'waiting',pgrst_db_pool_max:'max',pgrst_db_pool_timeouts_total:'timeouts'};
 if(typeof text!=='string'||Buffer.byteLength(text)>65536)throw Error('Invalid isolated pool counters');
 const result={};
 for(const line of text.split(/\r?\n/)){
  const name=line.match(/^(pgrst_db_pool_[a-z_]+)(?=[\s{])/)?.[1];
  if(!Object.hasOwn(names,name??''))continue;
  const sample=/^pgrst_db_pool_[a-z_]+\s+([0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)\s*$/.exec(line);
  const value=sample?Number(sample[1]):NaN,key=names[name];
  if(!Number.isSafeInteger(value)||value<0||Object.hasOwn(result,key))throw Error('Invalid isolated pool counters');
  result[key]=value;
 }
 if(Object.keys(result).length!==4||result.max<1||result.available>result.max)throw Error('Incomplete isolated pool counters');
 return result;
}

// Only a pre-existing private/loopback admin endpoint, without credentials,
// redirects or retry. The caller additionally binds it to its owned container.
export function readAudiencePoolMetrics(address,timeoutMs=1000){
 const target=new URL(address);
 if(target.protocol!=='http:'||isIP(target.hostname)!==4||!(/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(target.hostname))||!target.port||target.username||target.password||target.search||target.hash||target.pathname!=='/metrics'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>1000)throw Error('Private isolated metrics endpoint required');
 return new Promise((resolve,reject)=>{
  let settled=false;const started=Date.now(),chunks=[];let bytes=0;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(Error('Isolated pool metrics unavailable')):resolve(value);};
  const request=http.get(target,{headers:{'Accept-Encoding':'identity'}},response=>{
   if(response.statusCode!==200){finish(true);response.destroy();return;}
   response.on('data',chunk=>{bytes+=chunk.length;if(bytes>65536){finish(true);response.destroy();request.destroy();}else chunks.push(chunk);});
   response.on('error',()=>finish(true));
   response.on('end',()=>{try{
    if(Date.now()-started>=timeoutMs){finish(true);return;}
    finish(false,{...audiencePoolStats(Buffer.concat(chunks).toString('utf8')),startedAtMs:started,observedAtMs:Date.now(),observerMs:Date.now()-started});
   }catch{finish(true);}});
  });
  const timer=setTimeout(()=>{finish(true);request.destroy();},timeoutMs);
  request.on('error',()=>finish(true));
 });
}

// docker stats emits only these requested fields; reject malformed values and
// discard all labels. Container identities/configuration are never exported.
export function audienceResourceStats(text){
 const match=/^([0-9]+(?:\.[0-9]+)?)%\|([0-9]+(?:\.[0-9]+)?)%\|([0-9]+)\s*$/.exec(text);
 if(!match)throw Error('Invalid isolated resource counters');
 const [cpuPercent,memoryPercent,pids]=match.slice(1).map(Number);
 if(![cpuPercent,memoryPercent,pids].every(Number.isFinite)||cpuPercent>100000||memoryPercent>100||!Number.isSafeInteger(pids))throw Error('Invalid isolated resource counters');
 return {cpuPercent,memoryPercent,pids};
}

// A stopped scope is not evidence that an HTTP failure was cancellation.
// The table transport supplies its own canonical provenance marker.
export function ownedAudienceCancellation(cause,controller,timeout,kind='http'){
 if(kind==='table')return cause?.publicTableCallerCancelled===true;
 return controller.signal.aborted&&!timeout.aborted
  &&(cause===controller.signal.reason||cause?.name==='AbortError');
}

// PublicTournamentClock also reloads participation-derived counts on ranking.
// Reconnect and withdrawal invalidate a pending request even without a clock hint.
export function audienceScopeSignal(event){
 const changed=event.reason==='changed',clearClock=changed&&event.components.includes('visibility');
 const handOnly=changed&&event.components.includes('hand_visibility')&&!clearClock&&event.invalidatePending!==true;
 return {invalidate:event.reason!=='status'&&(event.invalidatePending===true||clearClock||handOnly),clearClock,handOnly};
}
export function audienceClockSignal(event){
 const scope=audienceScopeSignal(event),invalidate=scope.invalidate&&!scope.handOnly;
 return {invalidate,reload:event.reason!=='status'&&(invalidate
  ||event.components.includes('clock')||event.components.includes('ranking'))};
}

// Same metadata-only hidden-hub policy as usePublicSpectatorSnapshot.
export function selectedAudienceMetadata(event){
 return event.reason!=='status'&&(event.reason!=='changed'||event.invalidatePending===true
  ||event.components.includes('visibility')||event.components.includes('hand_visibility'));
}

// Never return exception messages, SQL text or arbitrary error properties.
export function audienceFailure(cause,status){
 const code=cause?.code??cause?.cause?.code;
 const httpStatus=Number.isInteger(status)&&status>=400&&status<=599?status:null;
 let kind='unknown';
 if(['EMFILE','ENFILE'].includes(code))kind='file_descriptor_limit';
 else if(['worker_deadline','deadline_exceeded','generation_absorb_failed','broadcast_flush_failed','claim_failed'].includes(cause?.message))kind=cause.message;
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

export function audienceWorkerFailure(name,error){
 const operations=['absorb_public_spectator_generations_v2','flush_public_spectator_broadcast_v2','claim_public_spectator_projection_v2','get_public_spectator_projection_source_v2','publish_public_spectator_projection_v2','fail_public_spectator_projection_v2'];
 const reasons=['lease_expired','forbidden','invalid_limit'];
 return {operation:operations.includes(name)?name:'unknown',reason:reasons.includes(error?.message)?error.message:'unknown'};
}

export function audienceServerTiming(headers){
 const result={};
 const number=text=>typeof text==='string'&&/^\d+(?:\.\d+)?$/.test(text)&&Number(text)<=60000?Number(text):null;
 for(const part of (headers.get('server-timing')??'').split(',')){
  const match=/^\s*(jwt|parse|plan|transaction|response);dur=(\d+(?:\.\d+)?)\s*$/.exec(part);
  if(match){const value=number(match[2]);if(value!==null)result[match[1]]=value;}
 }
 for(const [header,key]of [['x-kong-upstream-latency','kongUpstream'],['x-kong-proxy-latency','kongProxy']]){
  const value=number(headers.get(header));if(value!==null)result[key]=value;
 }
 return result;
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

// Bounded diagnostics for selected-table admission. No identifiers, payloads,
// arbitrary errors or source values leave this helper; readiness is unchanged.
const detailEvents=new Set(['selection','visibility','invalidate','request','dispatch','clock-commit','fenced','accepted','rejected']);
export function recordAudienceDetailEvent(state,event,now=Date.now()){
 if(!detailEvents.has(event))throw Error('Unknown detail diagnostic event');
 const trace=state.detailTrace??=[];
 trace.push({event,at:now,epoch:state.epoch??0,clockReady:state.clockReady===true,full:state.lastDetailFull===true});
 if(trace.length>12)trace.shift();
}
export function audienceSelectionReadiness(clients,selection,now=Date.now()){
 if(!selection)return null;
 const counts={missing:0,offline:0,tableNotReady:0,clockNotReady:0,wrongTable:0,wrongSession:0,inFlight:0};
 const samples=[];
 for(let index=0;index<clients.length;index++){
  const c=clients[index];
  const flags={offline:!c.online,tableNotReady:!c.ready,clockNotReady:!c.clockReady,
   wrongTable:c.tableId!==selection.tableId,wrongSession:c.observedSession!==selection.sessionId,
   inFlight:c.detailInFlight===true};
  if(!flags.offline&&!flags.tableNotReady&&!flags.clockNotReady&&!flags.wrongTable&&!flags.wrongSession)continue;
  counts.missing++;for(const key of Object.keys(flags))if(flags[key])counts[key]++;
  if(samples.length<20)samples.push({index,...flags,
   lastRequestAgeMs:c.detailStartedAt==null?null:Math.max(0,now-c.detailStartedAt),
   started:c.detailStarted??0,accepted:c.detailAccepted??0,fenced:c.detailFenced??0,rejected:c.detailRejected??0,
   lastDetailFull:c.lastDetailFull===true,fullReads:c.detailFullReads??0,clockCommits:c.clockCommits??0,clockInvalidations:c.clockInvalidations??0,
   trace:(c.detailTrace??[]).map(({event,at,epoch,clockReady,full})=>({event,ageMs:Math.max(0,now-at),epoch,clockReady,full}))});
 }
 return {counts,samples};
}
