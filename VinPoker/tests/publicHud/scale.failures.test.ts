import {describe,it,expect} from 'vitest';
import {classifyHudReadFailure,sanitizeWriterNestedPlans} from './scale.failures.mjs';
describe('safe HUD read failure diagnosis',()=>{
 it('separates preparation expiry, actual deadlines and caller cancellation',()=>{
  expect(classifyHudReadFailure({publicHudRevalidationExpired:true})).toBe('preparation_deadline');
  expect(classifyHudReadFailure({publicHudDeadline:true,publicHudCallerCancelled:true})).toBe('rpc_deadline');
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
