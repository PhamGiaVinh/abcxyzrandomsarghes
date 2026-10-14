import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { type PayrollStatusKey, type AgingBucketKey, PAYROLL_STATUS_META } from '@/lib/clubFinance';
import { parseFinanceCore, financeRecord, financeNumber, financeRows, financeText, financeSessionReadEpoch } from '@/lib/financeSummaryRead';

export interface ClubFinanceSummary {
  revenue: {
    stakingFees:number; stakingFixed:number; stakingPercent:number; stakingArchive:number; payoutFees:number;
    rake:number; rakeActual:number; rakeExpected:number; rakeVariance:number;
    rakeOnline:number; rakeOffline:number; rakeReentry:number; serviceFee:number; total:number; fnb:number;
  };
  cost: {payrollNet:number; payrollGross:number; adjustments:number; fnbCogs:number; compCogs:number};
  net:number; statusTotals:Record<PayrollStatusKey,number>; unpaidTotal:number; reconciledTotal:number;
  aging:Record<AgingBucketKey,number>;
  trend:{key:string; revenue:number; cost:number}[];
  perPeriod:{id:string; clubId:string; clubName:string; periodKey:string; gross:number; net:number; status:PayrollStatusKey}[];
  perClub:{clubId:string; name:string; revenue:number; cost:number; net:number}[];
}
export interface FinanceQuery {from:string; to:string; clubFilter:string}

function parseSummary(value:unknown) {
  const {data,revenue:r,cost:c,net}=parseFinanceCore(value);
  const status=financeRecord(data.statusTotals,'statusTotals');
  const statusTotals={} as Record<PayrollStatusKey,number>;
  for(const key of Object.keys(status)) if(!Object.prototype.hasOwnProperty.call(PAYROLL_STATUS_META,key)) throw new Error('FINANCE_SUMMARY_INVALID: statusTotals');
  for(const key of Object.keys(PAYROLL_STATUS_META) as PayrollStatusKey[])
    statusTotals[key]=Object.prototype.hasOwnProperty.call(status,key)?financeNumber(status[key],`statusTotals.${key}`):0;
  const a=financeRecord(data.aging,'aging');
  const aging={} as Record<AgingBucketKey,number>;
  for(const key of ['d0_30','d31_60','d61_90','d90p'] as AgingBucketKey[]) aging[key]=financeNumber(a[key],`aging.${key}`);
  const clubs=financeRows(data.clubs,'clubs').map(row=>({id:financeText(row.id,'clubs.id'),name:financeText(row.name,'clubs.name')}));
  const summary:ClubFinanceSummary={
    revenue:{stakingFees:r.stakingFees,stakingFixed:r.stakingFixed??r.stakingFees,stakingPercent:r.stakingPercent??0,
      stakingArchive:r.stakingArchive??0,payoutFees:r.payoutFees,rake:r.rake,rakeActual:r.rakeActual??r.rake,
      rakeExpected:r.rakeExpected??r.rake,rakeVariance:r.rakeVariance??0,rakeOnline:r.rakeOnline??0,
      rakeOffline:r.rakeOffline??0,rakeReentry:r.rakeReentry??0,serviceFee:r.serviceFee??0,total:r.total,fnb:r.fnb??0},
    cost:{payrollNet:c.payrollNet,payrollGross:c.payrollGross,adjustments:c.adjustments,fnbCogs:c.fnbCogs??0,compCogs:c.compCogs??0},
    net,statusTotals,aging,unpaidTotal:financeNumber(data.unpaidTotal,'unpaidTotal'),reconciledTotal:financeNumber(data.reconciledTotal,'reconciledTotal'),
    trend:financeRows(data.trend,'trend').map(row=>({key:financeText(row.key,'trend.key'),revenue:financeNumber(row.revenue,'trend.revenue'),cost:financeNumber(row.cost,'trend.cost')})),
    perPeriod:financeRows(data.perPeriod,'perPeriod').map(row=>{
      const status=financeText(row.status,'perPeriod.status');
      if(!Object.prototype.hasOwnProperty.call(PAYROLL_STATUS_META,status)) throw new Error('FINANCE_SUMMARY_INVALID: perPeriod.status');
      return {id:financeText(row.id,'perPeriod.id'),clubId:financeText(row.clubId,'perPeriod.clubId'),clubName:financeText(row.clubName,'perPeriod.clubName'),
        periodKey:financeText(row.periodKey,'perPeriod.periodKey'),gross:financeNumber(row.gross,'perPeriod.gross'),net:financeNumber(row.net,'perPeriod.net'),status:status as PayrollStatusKey};
    }),
    perClub:financeRows(data.perClub,'perClub').map(row=>({clubId:financeText(row.clubId,'perClub.clubId'),name:financeText(row.name,'perClub.name'),
      revenue:financeNumber(row.revenue,'perClub.revenue'),cost:financeNumber(row.cost,'perClub.cost'),net:financeNumber(row.net,'perClub.net')})),
  };
  return {clubs,summary};
}

/** RPC-only, read-only. A failed canonical read is not a client-calculated balance. */
export function useClubFinanceSummary({from,to,clubFilter}:FinanceQuery): {
  loading: boolean;
  error: string | null;
  clubs: {id: string; name: string}[];
  summary: ClubFinanceSummary | null;
  reload: () => Promise<void>;
} {
  const {user,session,isAdmin,loading:authLoading}=useAuth();
  // Local identity fences A -> B -> A and session refresh without persisting tokens.
  const scope=JSON.stringify([from,to,clubFilter,user?.id,isAdmin,financeSessionReadEpoch(session),authLoading]);
  const context=useMemo(()=>({scope}),[scope]);
  const active=useRef<typeof context|null>(null); const generation=useRef(0);
  const [state,setState]=useState<{context:typeof context|null; loading:boolean; error:string|null; clubs:{id:string;name:string}[]; summary:ClubFinanceSummary|null}>
    ({context:null,loading:true,error:null,clubs:[],summary:null});
  const load=useCallback(async()=>{
    if(active.current!==context) return;
    const request=++generation.current;
    const current=()=>active.current===context&&generation.current===request;
    setState({context,loading:true,error:null,clubs:[],summary:null});
    if(authLoading) return;
    if(!user?.id || !session?.access_token) {setState({context,loading:false,error:'AUTH_REQUIRED',clubs:[],summary:null});return;}
    try {
      const fromTs=new Date(from+'T00:00:00').toISOString();
      const toTs=new Date(to+'T23:59:59').toISOString();
      const {data,error}=await supabase.rpc('get_club_finance_summary',{
        p_from:fromTs,p_to:toTs,p_club_id:clubFilter!=='all'?clubFilter:undefined,
      });
      if(error) throw error;
      const parsed=parseSummary(data);
      if(current()) setState({context,loading:false,error:null,...parsed});
    } catch(error) {
      const message=error instanceof Error?error.message:
        error&&typeof error==='object'&&'message' in error&&typeof error.message==='string'?error.message:'Lỗi tải dữ liệu tài chính';
      if(current()) setState({context,loading:false,error:message,clubs:[],summary:null});
    }
  },[context,authLoading,user?.id,session?.access_token,from,to,clubFilter]);
  useEffect(()=>{active.current=context;void load();return()=>{if(active.current===context) active.current=null;};},[context,load]);
  const visible=state.context===context?state:{loading:true,error:null,clubs:[],summary:null};
  return {loading:visible.loading,error:visible.error,clubs:visible.clubs,summary:visible.summary,reload:load};
}
