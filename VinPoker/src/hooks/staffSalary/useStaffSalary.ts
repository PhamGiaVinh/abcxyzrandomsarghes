import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef } from 'react';
import { z } from 'zod';
import { sessionReadEpoch } from '@/lib/sessionReadEpoch';
import { observeTrackerContextRead } from '@/lib/tournament/observeTrackerContextRead';
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { mockSalaryClubs, mockSalaryMonth } from "@/lib/staffSalary/mockSalary";
import type {
  SalaryClub,
  SalaryMonthView,
  SalaryPeriodStatus,
  SalaryRow,
  StaffSalarySource,
} from "@/lib/staffSalary/types";

const db = supabase as unknown as { from: (table: string) => any };
const rpc = (fn: string, args: Record<string, unknown>): PromiseLike<{data:any;error:any}> => (supabase.rpc as any)(fn, args);

const amount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const signedAmount = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const salaryRow = z.object({
  staff_id:z.string().min(1),full_name:z.string().min(1),department:z.string(),
  employment_type:z.enum(['full_time','part_time']),worked_days:count.nullable().optional(),worked_minutes:count.nullable().optional(),
  gross_vnd:amount,manual_bhxh_vnd:signedAmount,manual_tax_vnd:signedAmount,net_vnd:amount,
  id:z.string().min(1).optional(),run_id:z.string().min(1).optional(),status:z.enum(['locked','paid']).optional(),already_locked:z.boolean().optional(),
});
const reportPacket = z.object({
  club_id:z.string().min(1),period_year:z.number().int(),period_month:z.number().int().min(1).max(12),
  header:z.object({id:z.string().min(1).optional(),status:z.enum(['prepared','submitted','approved','rejected']),
    submitted_at:z.string().nullable().optional(),approved_at:z.string().nullable().optional(),rejected_reason:z.string().nullable().optional()}),
  rows:z.array(salaryRow),total_gross_vnd:amount,total_net_vnd:amount,standard_shifts_per_month:z.number().int().positive().optional(),
});
const previewPacket = z.object({club_id:z.string().min(1),period_year:z.number().int(),period_month:z.number().int().min(1).max(12),
  standard_shifts_per_month:z.number().int().positive(),staff:z.array(salaryRow)});

function mapRow(r: z.infer<typeof salaryRow>, locked: boolean): SalaryRow {
  if (locked ? !(r.id ?? r.run_id) || !r.status : typeof r.already_locked !== 'boolean') throw Error('STAFF_SALARY_ROW_INVALID');
  return {
    staffId: r.staff_id,
    fullName: r.full_name,
    department: r.department,
    employmentType: r.employment_type,
    workedDays: r.worked_days ?? null,
    workedMinutes: r.worked_minutes ?? null,
    grossVnd: r.gross_vnd,
    manualBhxhVnd: r.manual_bhxh_vnd,
    manualTaxVnd: r.manual_tax_vnd,
    netVnd: r.net_vnd,
    alreadyLocked: locked ? undefined : r.already_locked,
    runId: locked ? (r.id ?? r.run_id ?? null) : null,
    status: locked ? (r.status ?? null) : null,
  };
}

export function useSalaryClubs(source: StaffSalarySource, requested: boolean) {
  const {user,session,loading:authLoading,isAdmin,isClubAdmin}=useAuth();
  const epoch=sessionReadEpoch(session);
  const enabled=requested&&!authLoading&&(source==='mock'||(!!user?.id&&!!session?.access_token));
  const scope=JSON.stringify([source,user?.id,epoch,authLoading,isAdmin,isClubAdmin,requested]);
  const context=useMemo(()=>({scope}),[scope]),active=useRef(context);active.current=context;
  const clubsSchema=z.array(z.object({id:z.string().min(1),name:z.string().min(1)}));
  const clubs=(data:unknown)=>{
    const rows=clubsSchema.parse(data);
    if(new Set(rows.map(c=>c.id)).size!==rows.length)throw Error('STAFF_SALARY_CLUBS_DUPLICATED');
    return rows;
  };
  const read=async(query:PromiseLike<{data:unknown;error:unknown}>)=>{
    const result=await observeTrackerContextRead(query);
    if(active.current!==context)throw Error('STAFF_SALARY_READ_SUPERSEDED');
    if(result.error)throw result.error;
    return result.data;
  };
  const query=useQuery({
    queryKey:['staffSalary','clubs',source,user?.id??'anon',epoch,authLoading,isAdmin,isClubAdmin,requested],
    enabled,retry:false,staleTime:60_000,refetchInterval:5_000,refetchOnWindowFocus:'always',refetchOnReconnect:'always',
    queryFn:async():Promise<SalaryClub[]>=>{
      if(!enabled||active.current!==context)throw Error('STAFF_SALARY_AUTH_REQUIRED');
      if(source==='mock')return mockSalaryClubs();
      if(!user?.id)throw Error('STAFF_SALARY_AUTH_REQUIRED');
      if(isAdmin||isClubAdmin){
        return clubs(await read(db.from('clubs').select('id,name').order('name').limit(50)))
          .map(c=>({id:c.id,name:c.name,role:'admin' as const}));
      }
      const [owned,memberships]=await Promise.all([
        read(db.from('clubs').select('id,name').eq('owner_id',user.id)),
        read(db.from('club_accountants').select('club_id').eq('user_id',user.id)),
      ]);
      const result=new Map<string,SalaryClub>();
      for(const c of clubs(owned))result.set(c.id,{id:c.id,name:c.name,role:'owner'});
      const accountantRows=z.array(z.object({club_id:z.string().min(1)})).parse(memberships);
      const ids=[...new Set(accountantRows.map(r=>r.club_id))].filter(id=>!result.has(id));
      if(ids.length){
        const accountantClubs=clubs(await read(db.from('clubs').select('id,name').in('id',ids)));
        if(accountantClubs.some(c=>!ids.includes(c.id)))throw Error('STAFF_SALARY_CLUB_SCOPE_INVALID');
        for(const c of accountantClubs)result.set(c.id,{id:c.id,name:c.name,role:'accountant'});
      }
      return [...result.values()].sort((a,b)=>a.name.localeCompare(b.name));
    },
  });
  return {...query,data:enabled&&!query.isError&&!query.isPaused?query.data:undefined,isLoading:authLoading||query.isLoading,
    refetch:(...args:Parameters<typeof query.refetch>)=>{
      if(!enabled||active.current!==context)return Promise.reject(Error('STAFF_SALARY_AUTH_REQUIRED'));
      return query.refetch(...args);
    }};
}

export function useStaffSalaryMonth(
  source: StaffSalarySource,
  clubId: string | null,
  year: number,
  month: number,
) {
  const {user,session,loading:authLoading,isAdmin,isClubAdmin}=useAuth();
  const epoch=sessionReadEpoch(session);
  const enabled=!!clubId&&!authLoading&&(source==='mock'||(!!user?.id&&!!session?.access_token));
  const scope=JSON.stringify([source,clubId,year,month,user?.id,epoch,authLoading,isAdmin,isClubAdmin]);
  const context=useMemo(()=>({scope}),[scope]),active=useRef(context);active.current=context;
  const query=useQuery({
    queryKey: ["staffSalary", "month", source, clubId ?? "", year, month,user?.id??'',epoch,authLoading,isAdmin,isClubAdmin],
    enabled,
    staleTime: 20_000,
    retry:false,
    refetchInterval:5_000,
    refetchOnWindowFocus:'always',
    refetchOnReconnect:'always',
    queryFn: async (): Promise<SalaryMonthView> => {
      if(!enabled||active.current!==context)throw Error('STAFF_SALARY_AUTH_REQUIRED');
      if(!Number.isInteger(year)||year<1||!Number.isInteger(month)||month<1||month>12)throw Error('STAFF_SALARY_PERIOD_INVALID');
      if (!clubId) return mockSalaryMonth("", year, month);
      if (source === "mock") return mockSalaryMonth(clubId, year, month);

      const { data, error: e1 } = await observeTrackerContextRead(rpc("get_staff_salary_report", {
        p_club_id: clubId,
        p_year: year,
        p_month: month,
      }));
      if (e1) throw e1;
      if(active.current!==context)throw Error('STAFF_SALARY_READ_SUPERSEDED');
      const rep=reportPacket.parse(data);
      if(rep.club_id!==clubId||rep.period_year!==year||rep.period_month!==month)throw Error('STAFF_SALARY_SCOPE_INVALID');
      const header=rep.header;
      const lockedRows=rep.rows.map(r=>mapRow(r,true));
      if(new Set(lockedRows.map(r=>r.staffId)).size!==lockedRows.length
        ||new Set(lockedRows.map(r=>r.runId)).size!==lockedRows.length
        ||lockedRows.reduce((s,r)=>s+r.grossVnd,0)!==rep.total_gross_vnd
        ||lockedRows.reduce((s,r)=>s+r.netVnd,0)!==rep.total_net_vnd)throw Error('STAFF_SALARY_TOTALS_INVALID');
      const frozen=lockedRows.length>0||!!header.id||header.status!=='prepared';
      let standardShifts:number|null=rep.standard_shifts_per_month??null;

      let previewRows: SalaryRow[] = [];
      if (!frozen) {
        const { data: preview, error: e2 } = await observeTrackerContextRead(rpc("get_staff_salary_month", {
          p_club_id: clubId,
          p_year: year,
          p_month: month,
        }));
        if (e2) throw e2;
        if(active.current!==context)throw Error('STAFF_SALARY_READ_SUPERSEDED');
        const prev=previewPacket.parse(preview);
        if(prev.club_id!==clubId||prev.period_year!==year||prev.period_month!==month)throw Error('STAFF_SALARY_SCOPE_INVALID');
        previewRows=prev.staff.map(r=>mapRow(r,false));standardShifts=prev.standard_shifts_per_month;
        if(new Set(previewRows.map(r=>r.staffId)).size!==previewRows.length)throw Error('STAFF_SALARY_ROWS_DUPLICATED');
      }

      return {
        clubId,
        year,
        month,
        standardShifts,
        status: header.status,
        submittedAt: header.submitted_at ?? null,
        approvedAt: header.approved_at ?? null,
        rejectedReason: header.rejected_reason ?? null,
        hasRuns: frozen,
        lockedRows,
        previewRows,
        // Preview display sums verified server row amounts, never chooses pay.
        // Chốt/paid RPCs accept only intent and calculate money on the server.
        totalGrossVnd: frozen?rep.total_gross_vnd:previewRows.reduce((s,r)=>s+r.grossVnd,0),
        totalNetVnd: frozen?rep.total_net_vnd:previewRows.reduce((s,r)=>s+r.netVnd,0),
      };
    },
  });
  return {...query,data:enabled&&!query.isError&&!query.isPaused?query.data:undefined,isLoading:authLoading||query.isLoading,
    refetch:(...args:Parameters<typeof query.refetch>)=>{
      if(!enabled||active.current!==context)return Promise.reject(Error('STAFF_SALARY_AUTH_REQUIRED'));
      return query.refetch(...args);
    }};
}

/** Chốt → gửi → duyệt/từ chối → đánh dấu trả. Live only; mock shows an info toast. */
export function useSalaryActions(
  source: StaffSalarySource,
  clubId: string | null,
  year: number,
  month: number,
) {
  const qc = useQueryClient();
  const key = ["staffSalary", "month", source, clubId ?? "", year, month];
  const invalidate = () => qc.invalidateQueries({ queryKey: key });
  const {user,session,loading:authLoading,isAdmin,isClubAdmin,isClubOwner,isAccountant}=useAuth();
  const epoch=sessionReadEpoch(session);
  const scope=JSON.stringify([source,clubId,year,month,user?.id,epoch,authLoading,isAdmin,isClubAdmin,isClubOwner,isAccountant]);
  const context=useMemo(()=>({scope}),[scope]),active=useRef(context);active.current=context;
  const inFlight=useRef(false);
  const assertContext=()=>{
    if(active.current!==context||authLoading||(source==='live'&&(!clubId||!user?.id||!session?.access_token)))throw Error('Phiên bảng lương đã thay đổi. Vui lòng kiểm tra lại.');
    if(!Number.isInteger(year)||year<1||!Number.isInteger(month)||month<1||month>12)throw Error('Kỳ lương không hợp lệ.');
  };
  const unknown='Chưa xác minh được kết quả thao tác lương. Kiểm tra trạng thái bảng lương trước khi thực hiện tiếp.';
  const receipt=(fn:string,args:Record<string,unknown>,value:unknown)=>{
    const r=z.object({status:z.string(),idempotent:z.boolean().optional()}).passthrough().parse(value);
    if(r.error!=null)throw Error(unknown);
    for(const [field,expected] of Object.entries({club_id:clubId,period_year:year,period_month:month})){
      if(field in r&&r[field]!==expected)throw Error(unknown);
    }
    const fullScope=()=>{if(r.club_id!==clubId||r.period_year!==year||r.period_month!==month)throw Error(unknown);};
    const instant=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v));
    if(fn==='chot_staff_salary_month'){
      fullScope();if(r.status!=='ok'||!count.safeParse(r.locked_now).success||!amount.safeParse(r.total_net_vnd).success)throw Error(unknown);
    }else if(fn==='submit_staff_salary_month'){
      if(!(r.status==='approved'&&r.idempotent===true)){
        fullScope();if(r.status!=='submitted'||!z.number().int().positive().safe().safeParse(r.runs).success)throw Error(unknown);
      }
    }else if(fn==='approve_staff_salary_month'){
      if(r.status!=='approved')throw Error(unknown);
      if(r.idempotent!==true){fullScope();if(!instant(r.approved_at))throw Error(unknown);}
    }else if(fn==='reject_staff_salary_month'){
      if(r.status!=='rejected'||r.reason!==args.p_reason)throw Error(unknown);
    }else if(fn==='mark_staff_salary_paid'){
      if(r.status!=='paid'||r.run_id!==args.p_run_id||(r.idempotent!==true&&!instant(r.paid_at)))throw Error(unknown);
    }else throw Error(unknown);
    return r;
  };

  const guardMock = (): boolean => {
    if (source === "mock") {
      toast.info("Preview mock — bật cờ staffSalaryChot để chạy thật.");
      return true;
    }
    return false;
  };

  const run = async (fn: string, args: Record<string, unknown>, okMsg: string) => {
    let timer:ReturnType<typeof setTimeout>|undefined,ownsFlight=false;
    try{
      assertContext();if(inFlight.current)throw Error('Đang xác minh thao tác lương trước.');
      inFlight.current=true;ownsFlight=true;
      if(fn==='mark_staff_salary_paid'){
        const response=await observeTrackerContextRead(rpc('get_staff_salary_report',{p_club_id:clubId,p_year:year,p_month:month}));
        assertContext();if(response.error)throw response.error;
        const report=reportPacket.parse(response.data);
        const matches=report.rows.filter(row=>(row.id??row.run_id)===args.p_run_id);
        if(report.club_id!==clubId||report.period_year!==year||report.period_month!==month||report.header.status!=='approved'
          ||matches.length!==1||!['locked','paid'].includes(matches[0].status??''))throw Error('Không xác minh được dòng lương đã duyệt trong CLB và kỳ đang chọn.');
        if(matches[0].employment_type==='part_time')throw Error('Bảng tháng PT chỉ tổng hợp khoản đã trả theo ngày, không chi trả lại từ đây.');
      }
      const {data,error}=await Promise.race([Promise.resolve(rpc(fn,args)),new Promise<never>((_,reject)=>{
        timer=setTimeout(()=>reject(Error(unknown)),20_000);
      })]);
      assertContext();if(error)throw error;
      if(data&&typeof data==='object'&&!Array.isArray(data)&&typeof data.error==='string'&&data.error.trim())throw Error(data.detail??data.error);
      const verified=receipt(fn,args,data);
      toast.success(fn==='submit_staff_salary_month'&&verified.status==='approved'?'Bảng lương đã được duyệt.':okMsg);
      return data;
    }catch(error){throw Object.assign(Error(error instanceof Error?error.message:unknown),{context});}
    finally{clearTimeout(timer);if(ownsFlight){inFlight.current=false;if(active.current===context)void invalidate();}}
  };
  const onError=(e:any)=>{if(active.current===e.context)toast.error(e.message??unknown);};

  const chot = useMutation({
    retry:false,
    mutationFn: async () => {
      if (guardMock()) return null;
      return run("chot_staff_salary_month", { p_club_id: clubId, p_year: year, p_month: month }, "Đã chốt lương tháng.");
    },
    onError,
  });

  const submit = useMutation({
    retry:false,
    mutationFn: async (note?: string) => {
      if (guardMock()) return null;
      return run(
        "submit_staff_salary_month",
        { p_club_id: clubId, p_year: year, p_month: month, p_note: note ?? null },
        "Đã gửi báo cáo cho chủ CLB.",
      );
    },
    onError,
  });

  const approve = useMutation({
    retry:false,
    mutationFn: async () => {
      if (guardMock()) return null;
      return run("approve_staff_salary_month", { p_club_id: clubId, p_year: year, p_month: month }, "Đã duyệt bảng lương.");
    },
    onError,
  });

  const reject = useMutation({
    retry:false,
    mutationFn: async (reason?: string) => {
      if (guardMock()) return null;
      return run(
        "reject_staff_salary_month",
        { p_club_id: clubId, p_year: year, p_month: month, p_reason: reason ?? null },
        "Đã từ chối bảng lương.",
      );
    },
    onError,
  });

  const markPaid = useMutation({
    retry:false,
    mutationFn: async (runId: string) => {
      if (guardMock()) return null;
      return run(
        "mark_staff_salary_paid",
        { p_run_id: runId, p_payment_method: "cash", p_payment_reference: null },
        "Đã đánh dấu đã trả.",
      );
    },
    onError,
  });
  const scoped=<T extends {mutate:(...args:any[])=>unknown;mutateAsync:(...args:any[])=>Promise<any>}>(mutation:T)=>({...mutation,
    mutate:(...args:Parameters<T['mutate']>)=>{try{assertContext();}catch{return;}
      return mutation.mutate(...args);},
    mutateAsync:(...args:Parameters<T['mutateAsync']>)=>{
      try{assertContext();}catch(error){return Promise.reject(error);}
      return mutation.mutateAsync(...args);
    }});
  return { chot:scoped(chot), submit:scoped(submit), approve:scoped(approve), reject:scoped(reject), markPaid:scoped(markPaid) };
}
