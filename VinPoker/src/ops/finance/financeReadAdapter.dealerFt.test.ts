import {expect,it} from 'vitest';
import {parseFinanceSummary} from './financeReadAdapter';
const core={revenue:{total:0,rake:0,serviceFee:0,stakingFees:0,payoutFees:0,fnb:0},cost:{payrollNet:100000,ptWagePaid:0,fnbCogs:0,compCogs:0,clubExpenses:0},net:-100000};
const live={scope:'current_month_provisional',timeZone:'Asia/Ho_Chi_Minh',asOf:'2026-10-31T17:30:00Z',period:'2026-11',gross:461538,net:413077};
it('preserves current dealer FT policy estimates separately from booked costs',()=>{const parsed=parseFinanceSummary({...core,dealerFtLive:live});expect(parsed).toHaveProperty('dealerFtLive.gross',461538);expect(parsed).toHaveProperty('dealerFtLive.net',413077);expect(parsed.cost.payrollNet).toBe(100000);expect(parsed.net).toBe(-100000);});
it('preserves a verified signed net estimate rather than replacing it with zero',()=>{expect(parseFinanceSummary({...core,dealerFtLive:{...live,net:-100}})).toHaveProperty('dealerFtLive.net',-100);});
it('does not invent zero FT estimates for a missing contract',()=>{expect(parseFinanceSummary(core)).not.toHaveProperty('dealerFtLive');});
it.each([null,{}, {...live,scope:'booked_range'}, {...live,timeZone:'UTC'}, {...live,asOf:'invalid'}, {...live,period:'2026-10'}, {...live,period:'2026-13'}, {...live,gross:-1}, {...live,gross:0.5}, {...live,net:null}, {...live,net:'413077'}, {...live,net:Number.MAX_SAFE_INTEGER+1}])('rejects malformed FT estimate %j',(dealerFtLive)=>{expect(()=>parseFinanceSummary({...core,dealerFtLive})).toThrow('FINANCE_SUMMARY_INVALID: dealerFtLive');});
