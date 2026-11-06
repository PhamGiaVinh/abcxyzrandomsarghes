import {classifyTableReadFailure} from './scale.failures.mjs';

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
