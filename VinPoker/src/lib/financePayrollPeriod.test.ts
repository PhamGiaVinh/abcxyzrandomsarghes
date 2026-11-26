import {expect,it} from 'vitest';
import {financePayrollMonthFromValue,resolveFinancePayrollMonth} from './financePayrollPeriod';

it.each([['2024-02','2024-02-29'],['2025-02','2025-02-28'],['2026-12','2026-12-31'],['0099-02','0099-02-28']])('resolves the full calendar month %s',(value,end)=>{
 expect(financePayrollMonthFromValue(value)).toMatchObject({value,start:value+'-01',end});
});
it.each(['0000-01','2026-00','2026-13','2026-1','2026-02-01',''])('rejects an invalid month %s',value=>{
 expect(()=>financePayrollMonthFromValue(value)).toThrow('PAYROLL_MONTH_INVALID');
});
it('marks a partial report range explicitly without prorating payroll',()=>{
 expect(resolveFinancePayrollMonth({from:'2024-02-02',to:'2024-02-20'},{year:2026,month:11})).toMatchObject({state:'month',partial:true,period:{year:2024,month:2,start:'2024-02-01',end:'2024-02-29'}});
 expect(resolveFinancePayrollMonth({from:'2024-02-01',to:'2024-02-29'},{year:2026,month:11})).toMatchObject({state:'month',partial:false});
});
it('uses the fallback only when no dates were supplied',()=>{
 expect(resolveFinancePayrollMonth(undefined,{year:2027,month:1})).toMatchObject({state:'month',period:{year:2027,month:1}});
 expect(resolveFinancePayrollMonth({from:'',to:''},{year:2027,month:1})).toEqual({state:'invalid'});
 expect(resolveFinancePayrollMonth({from:'2026-02-30',to:'2026-03-01'},{year:2027,month:1})).toEqual({state:'invalid'});
 expect(resolveFinancePayrollMonth({from:'2026-10-31',to:'2026-11-01'},{year:2027,month:1})).toEqual({state:'multiple_months'});
});
