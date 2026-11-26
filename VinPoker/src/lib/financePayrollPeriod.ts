import {assertFinanceCalendarRange} from './financeSummaryRead';

/** Calendar scope only: monthly payroll is never prorated/recomputed in the client. */
export type FinancePayrollMonth={year:number;month:number};
export function financePayrollMonthRange(period:FinancePayrollMonth){
 if(!Number.isInteger(period.year)||period.year<1||period.year>9999||!Number.isInteger(period.month)||period.month<1||period.month>12)throw Error('PAYROLL_MONTH_INVALID');
 const value=`${String(period.year).padStart(4,'0')}-${String(period.month).padStart(2,'0')}`;
 const start=value+'-01',last=new Date(start+'T00:00:00Z');last.setUTCMonth(last.getUTCMonth()+1);last.setUTCDate(0);
 return {...period,value,label:`Tháng ${period.month}/${period.year}`,start,end:last.toISOString().slice(0,10)};
}
export function financePayrollMonthFromValue(value:string){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(value))throw Error('PAYROLL_MONTH_INVALID');
 const [year,month]=value.split('-').map(Number);return financePayrollMonthRange({year,month});
}
export function resolveFinancePayrollMonth(range:{from:string;to:string}|undefined,fallback:FinancePayrollMonth){
 if(!range)return {state:'month' as const,period:financePayrollMonthRange(fallback),partial:false};
 try{assertFinanceCalendarRange(range.from,range.to);}catch{return {state:'invalid' as const};}
 if(range.from.slice(0,7)!==range.to.slice(0,7))return {state:'multiple_months' as const};
 const period=financePayrollMonthFromValue(range.from.slice(0,7));
 return {state:'month' as const,period,partial:range.from!==period.start||range.to!==period.end};
}
