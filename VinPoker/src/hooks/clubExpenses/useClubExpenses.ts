import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef } from "react";
import { z } from "zod";
import { useAuth } from "@/hooks/useAuth";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { readMockExpenses, mockRecordExpense, summarize } from "@/lib/clubExpenses/mockExpenses";
import type {
  ClubExpenseRow,
  ClubExpenseSource,
  ClubExpensesSummary,
  ExpenseCategory,
  ExpensePaymentSource,
  ExpensePaymentStatus,
} from "@/lib/clubExpenses/types";

const amount = z.number().int().safe();
const category = z.enum(['rent','utilities','salary_topup','marketing','supplies','maintenance','tax_fee','misc']);
const timestamp = z.string().datetime({offset:true});
const expenseRow = z.object({
  id:z.string().min(1),club_id:z.string().min(1).optional(),category,amount_vnd:amount,
  description:z.string().nullable().optional(),incurred_at:timestamp,
  tournament_id:z.string().nullable().optional(),series_id:z.string().nullable().optional(),
  payment_status:z.enum(['paid','unpaid']),payment_source:z.enum(['cash','bank']).nullable().optional(),
  attachment_url:z.string().nullable().optional(),adjusts_id:z.string().nullable().optional(),
  entered_by:z.string().nullable().optional(),created_at:timestamp.nullable().optional(),
});
const expensePacket = z.object({
  club_id:z.string().min(1),from:timestamp,to:timestamp,rows:z.array(expenseRow),
  total_vnd:amount,paid_vnd:amount,unpaid_vnd:amount,by_category:z.record(category,amount),
});
const recordInput=z.object({category,amountVnd:amount.refine(v=>v!==0),incurredAt:timestamp,
  description:z.string().optional(),paymentStatus:z.enum(['paid','unpaid']),paymentSource:z.enum(['cash','bank']).nullable().optional()});
const recordIntent=z.object({version:z.literal(1),actor:z.string().min(1),club:z.string().min(1),requestId:z.string().uuid(),input:recordInput});
const recordReceipt=z.object({status:z.literal('ok'),expense_id:z.string().uuid(),idempotent:z.boolean()});
const unknownExpense='Chưa xác minh được kết quả ghi. Giữ nguyên nội dung để thử lại cùng mã giao dịch; không ghi lại bằng dòng mới.';

function mapRow(row: z.infer<typeof expenseRow>, clubId: string): ClubExpenseRow {
  return {
    id: row.id,
    clubId,
    category: row.category,
    amountVnd: row.amount_vnd,
    description: row.description ?? null,
    incurredAt: row.incurred_at,
    tournamentId: row.tournament_id ?? null,
    seriesId: row.series_id ?? null,
    paymentStatus: row.payment_status,
    paymentSource: row.payment_source ?? null,
    attachmentUrl: row.attachment_url ?? null,
    adjustsId: row.adjusts_id ?? null,
    enteredBy: row.entered_by ?? null,
    createdAt: row.created_at ?? null,
  };
}

function parseSummary(data: unknown, clubId: string, from: string, to: string): ClubExpensesSummary {
  const packet=expensePacket.parse(data);
  const begin=Date.parse(from),end=Date.parse(to);
  if(packet.club_id!==clubId||Date.parse(packet.from)!==begin||Date.parse(packet.to)!==end
    ||packet.rows.some(r=>(r.club_id!==undefined&&r.club_id!==clubId)||Date.parse(r.incurred_at)<begin||Date.parse(r.incurred_at)>=end))throw Error('EXPENSE_SCOPE_INVALID');
  const sum=(rows:typeof packet.rows)=>rows.reduce((s,r)=>s+BigInt(r.amount_vnd),0n);
  if(new Set(packet.rows.map(r=>r.id)).size!==packet.rows.length
    ||sum(packet.rows)!==BigInt(packet.total_vnd)
    ||sum(packet.rows.filter(r=>r.payment_status==='paid'))!==BigInt(packet.paid_vnd)
    ||sum(packet.rows.filter(r=>r.payment_status==='unpaid'))!==BigInt(packet.unpaid_vnd)
    ||category.options.some(c=>sum(packet.rows.filter(r=>r.category===c))!==BigInt(packet.by_category[c]??0)))throw Error('EXPENSE_TOTALS_INVALID');
  const rows = packet.rows.map(r=>mapRow(r,clubId));
  return {
    clubId,
    from,
    to,
    rows,
    totalVnd: packet.total_vnd,
    paidVnd: packet.paid_vnd,
    unpaidVnd: packet.unpaid_vnd,
    byCategory: packet.by_category,
  };
}

export function useClubExpenses(source: ClubExpenseSource, clubId: string | null, from: string, to: string) {
  const {user,session,loading:authLoading,isAdmin,isClubAdmin,isClubOwner,isCashier,isAccountant}=useAuth();
  const epoch=sessionReadEpoch(session);
  const enabled=!!clubId&&!authLoading&&(source==='mock'||(!!user?.id&&!!session?.access_token));
  const scope=JSON.stringify([source,clubId,from,to,user?.id,epoch,authLoading,isAdmin,isClubAdmin,isClubOwner,isCashier,isAccountant]);
  const context=useMemo(()=>({scope}),[scope]),active=useRef(context);active.current=context;
  const query=useQuery({
    queryKey: ["clubExpenses", "summary", source, clubId ?? "", from, to,user?.id??'',epoch,authLoading,isAdmin,isClubAdmin,isClubOwner,isCashier,isAccountant],
    enabled,retry:false,refetchInterval:5_000,refetchOnWindowFocus:'always',refetchOnReconnect:'always',
    staleTime: 30_000,
    queryFn: async (): Promise<ClubExpensesSummary> => {
      if(!enabled||active.current!==context)throw Error('EXPENSE_AUTH_REQUIRED');
      if(!Number.isFinite(Date.parse(from))||!Number.isFinite(Date.parse(to))||Date.parse(from)>=Date.parse(to))throw Error('EXPENSE_PERIOD_INVALID');
      if (!clubId) return summarize("", from, to, []);
      if (source === "mock") return readMockExpenses(clubId, from, to);
      const { data, error } = await observeTrackerContextRead((supabase.rpc as any)("get_club_expenses", {
        p_club_id: clubId,
        p_from: from,
        p_to: to,
      }) as PromiseLike<{data:unknown;error:unknown}>);
      if(active.current!==context)throw Error('EXPENSE_READ_SUPERSEDED');
      if (error) throw error;
      return parseSummary(data, clubId, from, to);
    },
  });
  return {...query,data:enabled&&!query.isError?query.data:undefined,isLoading:authLoading||query.isLoading,
    refetch:(...args:Parameters<typeof query.refetch>)=>{
      if(!enabled||active.current!==context)return Promise.reject(Error('EXPENSE_AUTH_REQUIRED'));
      return query.refetch(...args);
    }};
}

export function useRecordClubExpense(source: ClubExpenseSource, clubId: string | null, from: string, to: string) {
  const queryClient = useQueryClient();
  const queryKey = ["clubExpenses", "summary", source, clubId ?? "", from, to];
  const {user,session,loading:authLoading,isAdmin,isClubAdmin,isClubOwner,isCashier,isAccountant}=useAuth();
  const epoch=sessionReadEpoch(session);
  const scope=JSON.stringify([source,clubId,from,to,user?.id,epoch,authLoading,isAdmin,isClubAdmin,isClubOwner,isCashier,isAccountant]);
  const context=useMemo(()=>({scope}),[scope]),active=useRef(context);active.current=context;
  const inFlight=useRef(false);
  const store=useMemo(()=>{
    const key=`vinpoker:expense-record:v1:${user?.id??''}:${clubId??''}`;
    try{
      const raw=source==='live'&&user?.id&&clubId?sessionStorage.getItem(key):null;
      const intent=raw===null?null:recordIntent.parse(JSON.parse(raw));
      if(intent&&(intent.actor!==user?.id||intent.club!==clubId))throw Error('EXPENSE_INTENT_SCOPE_INVALID');
      return {key,intent,error:false};
    }catch{return {key,intent:null,error:true};}
  },[source,user?.id,clubId]);
  const assertContext=()=>{
    if(active.current!==context||authLoading||!clubId||(source==='live'&&(!user?.id||!session?.access_token)))throw Error('Phiên ghi chi phí đã thay đổi. Vui lòng kiểm tra lại.');
  };
  const clearIntent=(intent:z.infer<typeof recordIntent>,confirmed=false)=>{
    const saved=sessionStorage.getItem(store.key);
    // A second form may already have acknowledged this same server receipt.
    if(saved===null&&confirmed){store.intent=null;return;}
    if(saved!==JSON.stringify(intent))throw Error(unknownExpense);
    sessionStorage.removeItem(store.key);
    if(sessionStorage.getItem(store.key)!==null)throw Error(unknownExpense);
    store.intent=null;
  };

  const mutation=useMutation({
    retry:false,
    mutationFn: async (input: {
      category: ExpenseCategory;
      amountVnd: number;
      incurredAt: string;
      description?: string;
      paymentStatus: ExpensePaymentStatus;
      paymentSource?: ExpensePaymentSource | null;
    }) => {
      let timer:ReturnType<typeof setTimeout>|undefined;
      let ownsFlight=false;
      try{
      assertContext();
      if(inFlight.current)throw Error('Đang xác minh lần ghi trước.');
      const verified=recordInput.parse(input);
      if (source === "mock") return {...mockRecordExpense({ clubId, ...verified } as Parameters<typeof mockRecordExpense>[0]),context};
      if(store.error)throw Error('Không đọc được mã giao dịch đang chờ. Chưa gửi lần ghi mới.');
      const stored=sessionStorage.getItem(store.key);
      if(stored!==null){
        const prior=recordIntent.parse(JSON.parse(stored));
        if(prior.actor!==user!.id||prior.club!==clubId||(store.intent&&JSON.stringify(store.intent)!==stored))throw Error(unknownExpense);
        store.intent=prior;
      }else if(store.intent)throw Error(unknownExpense);
      const args=(value:typeof verified)=>({
        p_club_id: clubId,
        p_category: value.category,
        p_amount_vnd: value.amountVnd,
        p_incurred_at: value.incurredAt,
        p_description: value.description || null,
        p_payment_status: value.paymentStatus,
        p_payment_source: value.paymentSource ?? null,
        p_tournament_id: null,
        p_series_id: null,
        p_attachment_url: null,
        p_adjusts_id: null,
      });
      const fresh=!store.intent;
      if(store.intent&&JSON.stringify(args(store.intent.input))!==JSON.stringify(args(verified)))throw Error(unknownExpense);
      const intent=store.intent??recordIntent.parse({version:1,actor:user!.id,club:clubId,requestId:crypto.randomUUID(),input:verified});
      sessionStorage.setItem(store.key,JSON.stringify(intent));
      if(sessionStorage.getItem(store.key)!==JSON.stringify(intent))throw Error('Không lưu được mã giao dịch. Chưa gửi lần ghi mới.');
      store.intent=intent;inFlight.current=true;ownsFlight=true;
      const {data,error}=await Promise.race([
        Promise.resolve((supabase.rpc as any)('record_club_expense',{...args(verified),p_idempotency_key:intent.requestId})) as Promise<{data:unknown;error:any}>,
        new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error(unknownExpense)),20_000);}),
      ]).catch(()=>{throw Error(unknownExpense);});
      assertContext();
      if(error){
        const rejected=['42501','P0001','22P02','22003','23505','23503','23514'].includes(error.code);
        if(fresh&&rejected)clearIntent(intent);
        throw Error(rejected?error.message??'Không thể ghi chi phí.':unknownExpense);
      }
      if(data&&typeof data==='object'&&!Array.isArray(data)&&typeof (data as any).error==='string'){
        if(!(data as any).error.trim()||(data as any).status==='ok'||(data as any).expense_id)throw Error(unknownExpense);
        if(fresh)clearIntent(intent);
        throw Error((data as any).detail??(data as any).error);
      }
      const receipt=recordReceipt.safeParse(data);
      if(!receipt.success||(data as any).error!=null)throw Error(unknownExpense);
      clearIntent(intent,true);
      return {...receipt.data,context};
      }catch(error){throw Object.assign(Error(error instanceof Error?error.message:unknownExpense),{context});}
      finally{clearTimeout(timer);if(ownsFlight)inFlight.current=false;}
    },
    onSuccess: (result) => {
      if(active.current!==result.context)return;
      toast.success(source === "mock" ? "Đã ghi dòng preview." : "Đã ghi chi phí.");
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (error: any) => {if(active.current===error.context)toast.error(error?.message ?? "Không thể ghi chi phí.");},
  });
  const pending=store.intent?.input;
  return {...mutation,pendingInput:pending?{category:pending.category,amountVnd:pending.amountVnd,incurredAt:pending.incurredAt,
      description:pending.description,paymentStatus:pending.paymentStatus,paymentSource:pending.paymentSource}:null,contextKey:scope,
    mutate:(...args:Parameters<typeof mutation.mutate>)=>{assertContext();return mutation.mutate(...args);},
    mutateAsync:(...args:Parameters<typeof mutation.mutateAsync>)=>{
      try{assertContext();}catch(error){return Promise.reject(error);}
      return mutation.mutateAsync(...args);
    }};
}
