import http from 'node:http';
import {parsePostgrestServerTiming} from './scale.postgrest-metrics.mjs';

// Load-generator transport only. Every call is a distinct real HTTP request;
// no response cache, batch, application retry or cross-viewer deduplication.
export function createLocalHttpTransport(){
 const agent=new http.Agent({keepAlive:true,maxSockets:6000,maxFreeSockets:1000});
 return {
  request(url,{headers,body,signal,onHeaders}){
   const target=new URL(url);
   if(target.protocol!=='http:'||target.hostname!=='127.0.0.1'||target.username||target.password)throw Error('Isolated loopback HTTP required');
   return new Promise((resolve,reject)=>{
    let settled=false,responseStatus;
    const finish=(error,value)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',onAbort);
     if(error&&responseStatus!==undefined&&(responseStatus<200||responseStatus>=300))error=Object.assign(Error('HTTP_FAILED_RESPONSE'),{httpStatus:responseStatus});
     if(error)reject(error);else resolve(value);
    };
    const onAbort=()=>finish(signal.reason);
    if(signal?.aborted){finish(signal.reason);return;}
    signal?.addEventListener('abort',onAbort,{once:true});
    const req=http.request(target,{method:'POST',headers:{'Accept-Encoding':'identity',...headers,'Content-Length':Buffer.byteLength(body)},signal,agent},res=>{
     responseStatus=res.statusCode;
     const headersAt=performance.now();
     const chunks=[];
     res.on('data',chunk=>chunks.push(chunk));
     res.on('aborted',()=>finish(Error('HTTP_RESPONSE_ABORTED')));
     res.on('error',error=>finish(error));
     res.on('end',()=>{
      if(!res.complete){finish(Error('HTTP_RESPONSE_INCOMPLETE'));return;}
      finish(null,{status:res.statusCode,ok:res.statusCode>=200&&res.statusCode<300,headers:res.headers,headersAt,text:Buffer.concat(chunks).toString('utf8')});
     });
     if(onHeaders)try{
      const timing=parsePostgrestServerTiming(res.headers['server-timing']);
      onHeaders?.({status:responseStatus,headersAt,...(timing.available?{postgrestPhases:timing.phases}:{})});
     }catch{}
    });
    req.on('error',error=>finish(error));req.end(body);
   });
  },
  metrics(){return {kind:'NODE_HTTP_KEEPALIVE',acceptEncoding:'identity',maxSockets:agent.maxSockets,maxFreeSockets:agent.maxFreeSockets,
   activeSockets:Object.values(agent.sockets).reduce((n,a)=>n+a.length,0),freeSockets:Object.values(agent.freeSockets).reduce((n,a)=>n+a.length,0),queuedRequests:Object.values(agent.requests).reduce((n,a)=>n+a.length,0)};},
  close(){agent.destroy();},
 };
}
