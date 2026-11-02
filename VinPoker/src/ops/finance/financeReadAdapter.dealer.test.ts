import {expect,it} from 'vitest';
import {parseFinanceSummary} from './financeReadAdapter';
const core={revenue:{total:0,rake:0,serviceFee:0,stakingFees:0,payoutFees:0,fnb:0},cost:{payrollNet:100000,ptWagePaid:0,fnbCogs:0,compCogs:0,clubExpenses:0},net:-100000};
const live={scope:'current_outstanding',timeZone:'Asia/Ho_Chi_Minh',asOf:'2026-11-01T01:40:00Z',ptActiveUnfinalizedBalance:1207,ptFinalizedUnpaidBalance:2500,ptTotalUnpaid:3707};
it('keeps canonical dealer obligations separate from booked payroll and net',()=>{
 const parsed=parseFinanceSummary({...core,dealerLive:live});expect(parsed).toHaveProperty('dealerLive.ptActiveUnfinalizedBalance',1207);expect(parsed).toHaveProperty('dealerLive.ptFinalizedUnpaidBalance',2500);expect(parsed).toHaveProperty('dealerLive.ptTotalUnpaid',3707);expect(parsed.cost.payrollNet).toBe(100000);expect(parsed.net).toBe(-100000);
});
it('does not fabricate zero dealer obligations when the contract is absent',()=>{expect(parseFinanceSummary(core)).not.toHaveProperty('dealerLive');});
it.each([null,{}, {...live,scope:'booked_range'}, {...live,timeZone:'UTC'}, {...live,asOf:'invalid'}, {...live,ptActiveUnfinalizedBalance:null}, {...live,ptActiveUnfinalizedBalance:-1}, {...live,ptFinalizedUnpaidBalance:0.5}, {...live,ptTotalUnpaid:3706}, {...live,ptTotalUnpaid:'3707'}, {...live,ptTotalUnpaid:Number.MAX_SAFE_INTEGER+1}])('rejects malformed or inconsistent dealer obligations %j',(dealerLive)=>{
 expect(()=>parseFinanceSummary({...core,dealerLive})).toThrow('FINANCE_SUMMARY_INVALID: dealerLive');
});
