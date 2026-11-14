import {describe,it,expect} from 'vitest';
import {classifyHudReadFailure,sanitizeWriterNestedPlans,writerCaptureFailureKind,sanitizeHudAttemptTrace} from './scale.failures.mjs';
it('retains only eight sanitized attempt snapshots including an unfinished request',()=>{
 const attempts=Array.from({length:12},(_,i)=>({attempt:i+1,launchedAt:1000+i,state:'unavailable',url:'PRIVATE',body:'PRIVATE'}));
 const rows=sanitizeHudAttemptTrace(attempts);
 expect(rows).toHaveLength(8);expect(rows[0].attempt).toBe(5);
 expect(rows[7]).toEqual({attempt:12,launchedAt:1011,state:'unavailable'});
 attempts[11].state='current';expect(rows[7].state).toBe('unavailable');
 expect(JSON.stringify(rows)).not.toContain('PRIVATE');
 expect(sanitizeHudAttemptTrace([{headersAt:NaN,elapsedMs:-1,state:'PRIVATE',httpStatus:200,completedAt:1234}])).toEqual([{httpStatus:200,completedAt:1234}]);
 expect(sanitizeHudAttemptTrace(null)).toEqual([]);
});
describe('safe HUD read failure diagnosis',()=>{
 it('separates preparation expiry, actual deadlines and caller cancellation',()=>{
  expect(classifyHudReadFailure({publicHudRevalidationExpired:true})).toBe('revalidation_budget_expired_in_wait');
  expect(classifyHudReadFailure({publicHudDeadline:true,publicHudCallerCancelled:true})).toBe('physical_rpc_deadline');
  expect(classifyHudReadFailure({publicHudDeadline:true,publicHudRevalidationPhase:'rpc'})).toBe('revalidation_budget_expired_in_rpc');
  expect(classifyHudReadFailure({publicHudCallerCancelled:true})).toBe('caller_cancelled');
 });
 it('never exports arbitrary error text or changes a failure to success',()=>{
  expect(classifyHudReadFailure(Error('PUBLIC_HUD_INVALID_PREPARATION'))).toBe('invalid_preparation');
  expect(classifyHudReadFailure(Error('PRIVATE_VALUE_DO_NOT_EMIT'))).toBe('unknown');
  expect(classifyHudReadFailure(null)).toBe('unknown');
 });
});

it('sanitizes nested writer plans without exposing query or filter text',()=>{
 const input='plan: '+JSON.stringify({'Query Text':'PRIVATE_SQL_DO_NOT_EMIT',Plan:{'Node Type':'Seq Scan','Relation Name':'hand_players','Actual Rows':2,'Actual Loops':3,'Actual Total Time':4,Filter:'PRIVATE_FILTER_DO_NOT_EMIT'}},null,2);
 expect(sanitizeWriterNestedPlans(input)).toEqual({capturedPlans:1,scans:[{node:'Seq Scan',table:'hand_players',rows:2,loops:3,totalMs:4}]});
 expect(JSON.stringify(sanitizeWriterNestedPlans(input))).not.toContain('PRIVATE_');
 expect(sanitizeWriterNestedPlans('truncated')).toEqual({capturedPlans:0,scans:[]});
});

it('reports unavailable writer instrumentation without exporting database text',()=>{
 expect(writerCaptureFailureKind({stderr:'ERROR: permission denied for private instrumentation SECRET'},0)).toBe('instrumentation_permission');
 expect(writerCaptureFailureKind({stderr:'ERROR: could not access file SECRET'},0)).toBe('instrumentation_unavailable');
 expect(writerCaptureFailureKind({code:'ENOBUFS'},0)).toBe('capture_buffer_limit');
 expect(writerCaptureFailureKind({stderr:'writer_plan_capture'},0)).toBe('logs_not_returned');
 expect(writerCaptureFailureKind({},3)).toBeNull();
});

it('classifies table errors without returning arbitrary messages',async()=>{
 const {classifyTableReadFailure}=await import('./scale.failures.mjs');
 expect(classifyTableReadFailure({message:'PUBLIC_TABLE_DEADLINE'})).toBe('rpc_deadline');
 expect(classifyTableReadFailure({code:'ERR_ASSERTION',message:'PRIVATE'})).toBe('scope_assertion');
 expect(classifyTableReadFailure({message:'PRIVATE'})).toBe('unknown');
});
