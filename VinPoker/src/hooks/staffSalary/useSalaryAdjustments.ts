import {useEffect,useMemo,useRef} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {z} from 'zod';
import {useAuth} from '@/hooks/useAuth';
import {supabase} from '@/integrations/supabase/client';
import {FEATURES} from '@/lib/featureFlags';
import {sessionReadEpoch} from '@/lib/sessionReadEpoch';
import {observeTrackerContextRead} from '@/lib/tournament/observeTrackerContextRead';
import type {StaffSalarySource} from '@/lib/staffSalary/types';

const amount=z.number().int().nonnegative().safe();
const timestamp=z.string().refine(value=>Number.isFinite(Date.parse(value)));
const requestSchema=z.object({
  id:z.string().min(1),base_run_id:z.string().min(1),staff_id:z.string().min(1),
  amount_vnd:amount.positive(),gross_delta_vnd:amount,state:z.enum(['pending','superseded','approved']),
  source_fingerprint:z.string().regex(/^[a-f0-9]{64}$/),child_run_id:z.string().min(1).nullable(),
  created_at:timestamp,approved_at:timestamp.nullable(),approved_by:z.string().min(1).nullable(),
});
const packetSchema=z.object({club_id:z.string(),period_year:z.number().int(),period_month:z.number().int(),requests:z.array(requestSchema)});
export type SalaryAdjustment=z.infer<typeof requestSchema>;
type ApprovalIntent={requestId:string;baseRunId:string;staffId:string};
const rpc=(fn:string,args:Record<string,unknown>)=>(supabase as unknown as {
  rpc:(fn:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:unknown}>
}).rpc(fn,args);

export function useSalaryAdjustments(source:StaffSalarySource,clubId:string|null,year:number,month:number,canApprove:boolean){
  const {user,session,loading}=useAuth(),qc=useQueryClient(),epoch=sessionReadEpoch(session);
  const enabled=FEATURES.staffSalaryAdjustments&&source==='live'&&!!clubId&&!!user?.id&&!!session?.access_token&&!loading;
  const scope=JSON.stringify([enabled,clubId,year,month,user?.id,epoch,canApprove]);
  const context=useMemo(()=>({scope}),[scope]),active=useRef(context);active.current=context;
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const inFlight=useRef(false);
  const assertCurrent=()=>{if(!mounted.current||!enabled||active.current!==context)throw Error('Phiên bảng lương đã thay đổi. Tải lại để đối chiếu.');};
  const read=async()=>{
    assertCurrent();
    const {data,error}=await observeTrackerContextRead(rpc('get_staff_salary_adjustments_v1',{p_club_id:clubId,p_year:year,p_month:month}));
    assertCurrent();if(error)throw error;
    const packet=packetSchema.parse(data);
    if(packet.club_id!==clubId||packet.period_year!==year||packet.period_month!==month
      ||new Set(packet.requests.map(row=>row.id)).size!==packet.requests.length)throw Error('Chưa xác minh được đề nghị bổ sung trong kỳ đang chọn.');
    const pendingBases=new Set<string>();
    for(const row of packet.requests){
      if(row.state==='approved' ? row.child_run_id!==row.id||!row.approved_at||!row.approved_by : !!row.child_run_id||!!row.approved_at||!!row.approved_by)throw Error('Chứng từ bổ sung không hợp lệ.');
      if(row.state==='pending'){
        if(pendingBases.has(row.base_run_id))throw Error('Đề nghị bổ sung bị trùng.');
        pendingBases.add(row.base_run_id);
      }
    }
    return packet;
  };
  const key=['staffSalary','adjustments',source,clubId,year,month,user?.id,epoch,canApprove];
  const query=useQuery({queryKey:key,enabled,retry:false,staleTime:0,refetchInterval:2000,refetchOnWindowFocus:'always',refetchOnReconnect:'always',queryFn:read});
  const mutation=useMutation({retry:false,mutationFn:async(intent:ApprovalIntent)=>{
    assertCurrent();if(!canApprove)throw Error('Chỉ chủ CLB duyệt khoản bổ sung.');
    if(inFlight.current)throw Error('Đang xác minh lần duyệt trước.');
    inFlight.current=true;let timer:ReturnType<typeof setTimeout>|undefined;
    try{
      const packet=await read(),request=packet.requests.find(row=>row.id===intent.requestId);
      if(!request||request.state!=='pending'||request.base_run_id!==intent.baseRunId||request.staff_id!==intent.staffId)throw Error('Đề nghị đã thay đổi. Tải lại trước khi duyệt.');
      assertCurrent();
      const {data,error}=await Promise.race([rpc('approve_staff_salary_adjustment_v1',{p_request_id:request.id}),new Promise<never>((_,reject)=>{
        timer=setTimeout(()=>reject(Error('Chưa xác minh được kết quả duyệt. Tải lại đề nghị trước khi thử tiếp.')),20000);
      })]);
      assertCurrent();if(error)throw error;
      const result=z.object({status:z.literal('approved'),idempotent:z.boolean().optional(),request_id:z.string(),run_id:z.string(),base_run_id:z.string(),amount_vnd:amount.positive()}).parse(data);
      if(result.request_id!==request.id||result.run_id!==request.id||result.base_run_id!==request.base_run_id||result.amount_vnd!==request.amount_vnd)throw Error('Chưa xác minh được chứng từ vừa duyệt. Tải lại bảng lương.');
      return result;
    }finally{
      clearTimeout(timer);inFlight.current=false;
      if(active.current===context){
        void qc.invalidateQueries({queryKey:key});
        void qc.invalidateQueries({queryKey:['staffSalary','month',source,clubId??'',year,month]});
      }
    }
  }});
  return {...query,data:enabled&&!query.isError&&!query.isPaused?query.data:undefined,
    refetch:()=>{assertCurrent();return query.refetch();},
    approve:{...mutation,mutateAsync:(intent:ApprovalIntent)=>{try{assertCurrent();}catch(error){return Promise.reject(error);}return mutation.mutateAsync(intent);}}};
}
