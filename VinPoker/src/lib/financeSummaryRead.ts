// Read validation only: never calculate, round or repair ledger values.
export { sessionReadEpoch as financeSessionReadEpoch } from './sessionReadEpoch';

/** Calendar query scope only; never use the browser timezone to choose a finance day. */
export function financeBusinessToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}

export function assertFinanceCalendarRange(from:string,to:string) {
  const valid=(value:string)=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith('0000'))return false;
    const instant=Date.parse(value+'T00:00:00Z');
    return Number.isFinite(instant)&&new Date(instant).toISOString().slice(0,10)===value;
  };
  if(!valid(from)||!valid(to)||from>to)throw new Error('FINANCE_SUMMARY_INVALID: calendar range');
}

/** Verify the server query echo; never recompute the returned ledger totals. */
export function assertFinanceCalendarScope(data:Record<string,unknown>,query:{from:string;to:string;clubId:string|null}) {
  const start=Date.parse(query.from+'T00:00:00+07:00');
  const end=Date.parse(query.to+'T00:00:00+07:00')+86400000;
  if(data.fromDate!==query.from||data.toDate!==query.to||data.clubId!==query.clubId
    ||data.timeZone!=='Asia/Ho_Chi_Minh'||data.periodEndExclusive!==true
    ||typeof data.periodFrom!=='string'||Date.parse(data.periodFrom)!==start
    ||typeof data.periodTo!=='string'||Date.parse(data.periodTo)!==end) {
    throw new Error('FINANCE_SUMMARY_INVALID: calendar scope');
  }
}

export function financeRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`FINANCE_SUMMARY_INVALID: ${field}`);
  return value as Record<string, unknown>;
}
export function financeNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value))) throw new Error(`FINANCE_SUMMARY_INVALID: ${field}`);
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`FINANCE_SUMMARY_INVALID: ${field}`);
  return number;
}
function fields(object: Record<string, unknown>, required: string[], optional: string[], field: string) {
  const result: Record<string, number> = {};
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(object, key)) throw new Error(`FINANCE_SUMMARY_INVALID: ${field}.${key}`);
    result[key] = financeNumber(object[key], `${field}.${key}`);
  }
  // Only absent documented legacy fields may default in the consumer, not null.
  for (const key of optional) if (Object.prototype.hasOwnProperty.call(object, key)) result[key] = financeNumber(object[key], `${field}.${key}`);
  return result;
}
export function parseFinanceCore(value: unknown) {
  const data = financeRecord(value, 'summary');
  const revenue = fields(financeRecord(data.revenue, 'revenue'), ['stakingFees','payoutFees','rake','total'],
    ['stakingFixed','stakingPercent','stakingArchive','rakeActual','rakeExpected','rakeVariance','rakeOnline','rakeOffline','rakeReentry','serviceFee','fnb'], 'revenue');
  const cost = fields(financeRecord(data.cost, 'cost'), ['payrollNet','payrollGross','adjustments'],
    ['ptWagePaid','fnbCogs','compCogs','clubExpenses'], 'cost');
  return { data, revenue, cost, net: financeNumber(data.net, 'net') };
}
export function financeRows(value: unknown, field: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error(`FINANCE_SUMMARY_INVALID: ${field}`);
  return value.map((row, index) => financeRecord(row, `${field}[${index}]`));
}
export function financeText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`FINANCE_SUMMARY_INVALID: ${field}`);
  return value;
}
/** Permission denial is explicit; transport/contract errors are not evidence of lost access. */
export function financeReadErrorKey(error: unknown): string {
  const detail = error && typeof error === 'object' ? error as {code?: string; status?: number; message?: string} : {};
  if (detail.code === '42501' || detail.status === 403) return 'financeRead.forbidden';
  if (detail.code === 'PGRST202' || detail.code === '42883') return 'financeRead.missingBackend';
  if (detail.message?.startsWith('FINANCE_SUMMARY_INVALID')) return 'financeRead.invalid';
  if (detail.message === 'AUTH_REQUIRED') return 'financeRead.authRequired';
  return 'financeRead.unavailable';
}

export type FinanceStaffLive={scope:'current_outstanding';asOf:string;ftPeriod:string;ftProvisionalGross:number;ftProvisionalNet:number;ptUnpaidBalance:number};
export function parseFinanceStaffLive(input: unknown): FinanceStaffLive {
  const value=input as Record<string,unknown>;
  if((!value||typeof value!=='object'||Array.isArray(value))||value.scope!=='current_outstanding'||value.timeZone!=='Asia/Ho_Chi_Minh'
    ||typeof value.asOf!=='string'||!Number.isFinite(Date.parse(value.asOf))
    ||typeof value.ftPeriod!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(value.ftPeriod)
    ||value.ftPeriod!==financeBusinessToday(new Date(value.asOf)).slice(0,7)) throw Error('FINANCE_STAFF_LIVE_MALFORMED');
  const money=(key:string)=>{
    const amount=value[key];
    if(typeof amount!=='number'||!Number.isSafeInteger(amount)||amount<0)throw Error('FINANCE_STAFF_LIVE_MALFORMED');
    return amount;
  };
  return {scope:'current_outstanding',asOf:value.asOf,ftPeriod:value.ftPeriod,
    ftProvisionalGross:money('ftProvisionalGross'),ftProvisionalNet:money('ftProvisionalNet'),ptUnpaidBalance:money('ptUnpaidBalance')};
}

export type FinanceDealerLive={scope:'current_outstanding';asOf:string;ptActiveUnfinalizedBalance:number;ptFinalizedUnpaidBalance:number;ptTotalUnpaid:number};
export function parseFinanceDealerLive(input:unknown):FinanceDealerLive {
  const value=input as Record<string,unknown>;
  const invalid=()=>new Error('FINANCE_SUMMARY_INVALID: dealerLive');
  if(!value||typeof value!=='object'||Array.isArray(value)||value.scope!=='current_outstanding'
    ||value.timeZone!=='Asia/Ho_Chi_Minh'||typeof value.asOf!=='string'||!Number.isFinite(Date.parse(value.asOf))) throw invalid();
  const money=(key:string)=>{const amount=value[key];if(typeof amount!=='number'||!Number.isSafeInteger(amount)||amount<0)throw invalid();return amount;};
  const active=money('ptActiveUnfinalizedBalance'),finalized=money('ptFinalizedUnpaidBalance'),total=money('ptTotalUnpaid');
  // Validate the server contract; never substitute a client-computed balance.
  if(active+finalized!==total)throw invalid();
  return {scope:'current_outstanding',asOf:value.asOf,ptActiveUnfinalizedBalance:active,ptFinalizedUnpaidBalance:finalized,ptTotalUnpaid:total};
}

export type FinanceDealerFtLive={scope:'current_month_provisional';asOf:string;period:string;gross:number;net:number};
export function parseFinanceDealerFtLive(input:unknown):FinanceDealerFtLive {
  const value=input as Record<string,unknown>,invalid=()=>new Error('FINANCE_SUMMARY_INVALID: dealerFtLive');
  if(!value||typeof value!=='object'||Array.isArray(value)||value.scope!=='current_month_provisional'
    ||value.timeZone!=='Asia/Ho_Chi_Minh'||typeof value.asOf!=='string'||!Number.isFinite(Date.parse(value.asOf))
    ||typeof value.period!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(value.period)
    ||value.period!==financeBusinessToday(new Date(value.asOf)).slice(0,7))throw invalid();
  if(typeof value.gross!=='number'||!Number.isSafeInteger(value.gross)||value.gross<0
    ||typeof value.net!=='number'||!Number.isSafeInteger(value.net))throw invalid();
  return {scope:'current_month_provisional',asOf:value.asOf,period:value.period,gross:value.gross,net:value.net};
}
