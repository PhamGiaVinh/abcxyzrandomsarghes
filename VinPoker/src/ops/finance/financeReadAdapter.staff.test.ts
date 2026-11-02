import {expect,it} from 'vitest';
import {parseFinanceSummary} from './financeReadAdapter';
const core={revenue:{total:0,rake:0,serviceFee:0,stakingFees:0,payoutFees:0,fnb:0},
 cost:{payrollNet:100000,ptWagePaid:0,fnbCogs:0,compCogs:0,clubExpenses:0},net:-100000};
const live={scope:'current_outstanding',timeZone:'Asia/Ho_Chi_Minh',asOf:'2026-10-31T11:00:00Z',ftPeriod:'2026-10',ftProvisionalGross:200000,ftProvisionalNet:180000,ptUnpaidBalance:11152};
it('preserves booked expense and current provisional balances as separate server values',()=>{
 const value=parseFinanceSummary({...core,staffLive:live});expect(value.cost.payrollNet).toBe(100000);expect(value.net).toBe(-100000);
 expect(value.staffLive?.ftProvisionalNet).toBe(180000);expect(value.staffLive?.ptUnpaidBalance).toBe(11152);
});
it('does not manufacture a zero staff balance when the backend contract is absent',()=>{
 expect(parseFinanceSummary(core).staffLive).toBeUndefined();
});
it.each([null,{...live,ptUnpaidBalance:null},{...live,ftProvisionalNet:-1},{...live,ftProvisionalGross:0.5},
 {...live,scope:'booked_range'},{...live,asOf:'invalid'},{...live,ftPeriod:'2026-13'},{...live,ftPeriod:'2026-09'},{...live,timeZone:'UTC'}])('rejects unverified staff balances %j',(staffLive)=>{
 expect(()=>parseFinanceSummary({...core,staffLive})).toThrow('FINANCE_STAFF_LIVE_MALFORMED');
});
