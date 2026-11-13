// Sanitized isolated-runtime diagnostics. Gauges are not per-request wait latency.
const poolNames=['pgrst_db_pool_available','pgrst_db_pool_waiting','pgrst_db_pool_max','pgrst_db_pool_timeouts_total'];
export async function readBoundedMetrics(response){
 if(!response.ok||!response.body){await response.body?.cancel();return {available:false,reason:'http'};}
 const reader=response.body.getReader();let size=0,text='';const decoder=new TextDecoder();
 try{
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
   if(size>65536){await reader.cancel();return {available:false,reason:'invalid_size'};}
   text+=decoder.decode(value,{stream:true});
  }
  return parsePostgrestPoolMetrics(text+decoder.decode());
 }finally{reader.releaseLock();}
}
export function parsePostgrestPoolMetrics(text){
 if(typeof text!=='string'||text.length>65536)return {available:false,reason:'invalid_size'};
 const metrics={};
 for(const line of text.split('\n')){
  if(!line.trim()||line.trimStart().startsWith('#'))continue;
  const name=line.trim().split(/[\s{]/,1)[0];if(!poolNames.includes(name))continue;
  const match=/^(\w+)\s+([0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)\s*$/.exec(line.trim());
  const value=match?Number(match[2]):NaN;
  if(!Number.isSafeInteger(value)||value<0||Object.hasOwn(metrics,name))return {available:false,reason:'invalid_metric'};
  metrics[name]=value;
 }
 if(poolNames.some(name=>!Object.hasOwn(metrics,name)))return {available:false,reason:'missing_metric'};
 if(metrics.pgrst_db_pool_max<1||metrics.pgrst_db_pool_available>metrics.pgrst_db_pool_max)return {available:false,reason:'invalid_bounds'};
 return {available:true,metrics,scope:'Point-in-time pool counts; not request acquisition duration.'};
}
export function parsePostgrestServerTiming(text){
 if(typeof text!=='string'||text.length>4096)return {available:false};
 const phases={};
 for(const entry of text.split(',')){
  const name=entry.trim().split(';',1)[0];if(!['jwt','parse','plan','transaction','response'].includes(name))continue;
  const match=/^[a-z]+\s*;\s*dur=([0-9]+(?:\.[0-9]+)?)\s*$/.exec(entry.trim());
  const value=match?Number(match[1]):NaN;
  if(!Number.isFinite(value)||value<0||value>120000||Object.hasOwn(phases,name))return {available:false};
  phases[name]=value;
 }
 return Object.keys(phases).length?{available:true,phases}:{available:false};
}
