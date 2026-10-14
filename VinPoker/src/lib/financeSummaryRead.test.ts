import {describe,it,expect} from 'vitest';
import {parseFinanceCore,financeSessionReadEpoch,financeReadErrorMessage} from './financeSummaryRead';
const packet=()=>({revenue:{stakingFees:1,payoutFees:2,rake:3,total:6},cost:{payrollNet:7,payrollGross:8,adjustments:-1},net:-1});
describe('finance RPC read contract',()=>{
 it('does not describe network or invalid payload errors as missing permission',()=>{
  expect(financeReadErrorMessage({code:'42501'})).toContain('chưa có quyền');
  expect(financeReadErrorMessage(new TypeError('Failed to fetch'))).not.toContain('chưa có quyền');
  expect(financeReadErrorMessage(new Error('FINANCE_SUMMARY_INVALID: net'))).toContain('không hợp lệ');
  expect(financeReadErrorMessage({code:'PGRST202'})).toContain('phiên bản báo cáo');
 });
 it('preserves signed server totals and documented absent legacy optional fields',()=>{
  const parsed=parseFinanceCore(packet());expect(parsed.net).toBe(-1);expect(parsed.cost.adjustments).toBe(-1);
  expect(parsed.revenue.rakeActual).toBeUndefined();
 });
 it.each([null,undefined,false,'', ' ',NaN,Infinity,'NaN','0x10',{}])('rejects invalid headline %s instead of converting it to zero',value=>{
  expect(()=>parseFinanceCore({...packet(),net:value})).toThrow('FINANCE_SUMMARY_INVALID');
 });
 it('accepts explicit numeric zero and numeric wire strings without recomputing totals',()=>{
  expect(parseFinanceCore({...packet(),net:'0'}).net).toBe(0);
 });
 it('rejects explicit null optional values and missing required subtotals',()=>{
  const p=packet();expect(()=>parseFinanceCore({...p,revenue:{...p.revenue,fnb:null}})).toThrow();
  expect(()=>parseFinanceCore({...p,cost:{payrollNet:0}})).toThrow();
 });
 it('shares one session incarnation across readers, changing it after token refresh or new login',()=>{
  const session={access_token:'TEST_ONLY_A'};const first=financeSessionReadEpoch(session);
  expect(financeSessionReadEpoch(session)).toBe(first);
  session.access_token='TEST_ONLY_B';expect(financeSessionReadEpoch(session)).not.toBe(first);
  expect(financeSessionReadEpoch({access_token:'TEST_ONLY_A'})).not.toBe(first);
 });
});
