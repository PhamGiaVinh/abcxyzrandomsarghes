import {describe,it,expect} from 'vitest';
import {tableFailureSample} from './scale.table-trace.mjs';

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
