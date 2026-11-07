import {describe,it,expect} from 'vitest';
import {tableFailureSample,overviewGenerationSample} from './scale.table-trace.mjs';

it('retains only numeric fixture generation clocks without payloads or identities',()=>{
 const input={kind:'accepted',scopeIndex:20,generation:'123',at:100,startedAt:80,publishedAt:70,requestEpoch:2,currentEpoch:3,
  playerId:'private',tournamentId:'private',token:'private',payload:{cards:'private'}};
 expect(overviewGenerationSample(input)).toEqual({kind:'accepted',scopeIndex:20,generation:'123',at:100,startedAt:80,publishedAt:70,requestEpoch:2,currentEpoch:3});
 expect(JSON.stringify(overviewGenerationSample(input))).not.toContain('private');
 for(const invalid of [{scopeIndex:0},{scopeIndex:21},{generation:'private'},{generation:'1'.repeat(21)},{at:NaN},{kind:'private'}])expect(overviewGenerationSample({...input,...invalid})).toBeNull();
 expect(overviewGenerationSample({...input,kind:'source',deferred:true,publishedAt:NaN})).toEqual({kind:'source',scopeIndex:20,generation:'123',at:100,startedAt:80,requestEpoch:2,currentEpoch:3,deferred:true});
});

describe('bounded table failure timing provenance',()=>{
 it('retains transport and scope clocks without serializing error/request data',()=>{
  const sample=tableFailureSample({scenario:'concentrated',viewer:3,cause:{message:'PUBLIC_TABLE_DEADLINE',secret:'private'},
   transport:{launchedAt:100,headersAt:110,completedAt:120,httpStatus:200,upstreamMs:8,proxyMs:1,Authorization:'private',body:'private'},
   sourceEpoch:4,currentEpoch:5,online:true,reconnecting:false,eventLoopMaxMs:12,startedAt:100,finishedAt:5100});
  expect(sample.kind).toBe('rpc_deadline');expect(sample.elapsedMs).toBe(5000);
  expect(sample.transport).toEqual({launchedAt:100,headersAt:110,completedAt:120,httpStatus:200,upstreamMs:8,proxyMs:1});
  expect(JSON.stringify(sample)).not.toContain('private');
 });
 it('keeps absent timing unknown, rejects nonnumeric values and preserves failure class',()=>{
  const sample=tableFailureSample({scenario:'private',viewer:1001,cause:{message:'PUBLIC_TABLE_UNAVAILABLE',body:'private'},
   transport:{headersAt:Infinity,httpStatus:'500'},sourceEpoch:NaN,online:false});
  expect(sample.scenario).toBe('unknown');expect(sample.viewer).toBeNull();expect(sample.kind).toBe('unavailable');
  expect(sample.transport.headersAt).toBeNull();expect(sample.transport.httpStatus).toBeNull();expect(sample.elapsedMs).toBeNull();
 });
});
