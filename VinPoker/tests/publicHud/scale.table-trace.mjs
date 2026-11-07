import {classifyTableReadFailure} from './scale.failures.mjs';

// Short isolated overview diagnostics only; never retain source payloads or IDs.
export function overviewGenerationSample(value){
 if(!['source','hint','accepted','discarded'].includes(value.kind)||
  !Number.isInteger(value.scopeIndex)||value.scopeIndex<1||value.scopeIndex>20||
  typeof value.generation!=='string'||!/^\d{1,20}$/.test(value.generation)||
  !Number.isSafeInteger(value.at)||value.at<0)return null;
 const sample={kind:value.kind,scopeIndex:value.scopeIndex,generation:value.generation,at:value.at};
 for(const key of ['startedAt','publishedAt','requestEpoch','currentEpoch'])if(Number.isSafeInteger(value[key])&&value[key]>=0)sample[key]=value[key];
 if(typeof value.deferred==='boolean')sample.deferred=value.deferred;
 return sample;
}

// Fixed timing/boolean fields only. Never serialize errors, request bodies,
// headers, credentials, SQL, messages or the synthetic player's identity.
export function tableFailureSample({scenario,viewer,cause,transport,sourceEpoch,currentEpoch,online,reconnecting,eventLoopMaxMs,startedAt,finishedAt}){
 const number=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
 return {
  scenario:['concentrated','distributed','overview'].includes(scenario)?scenario:'unknown',
  viewer:Number.isInteger(viewer)&&viewer>=0&&viewer<1000?viewer:null,
  kind:classifyTableReadFailure(cause),startedAt:number(startedAt),finishedAt:number(finishedAt),
  elapsedMs:number(finishedAt-startedAt),sourceEpoch:number(sourceEpoch),currentEpoch:number(currentEpoch),
  online:online===true,reconnecting:reconnecting===true,scenarioEventLoopMaxMs:number(eventLoopMaxMs),
  transport:Object.fromEntries(['launchedAt','headersAt','completedAt','httpStatus','upstreamMs','proxyMs'].map(key=>[key,number(transport?.[key])])),
 };
}
