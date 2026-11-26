import {useMemo,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {z} from 'zod';
import {useAuth} from '@/hooks/useAuth';
import {supabase} from '@/integrations/supabase/client';
import {sessionReadEpoch} from '@/lib/sessionReadEpoch';
import {observeTrackerContextRead} from '@/lib/tournament/observeTrackerContextRead';
import {formatVND} from '@/lib/format';
import {Button} from '@/components/ui/button';

const amount=z.number().int().nonnegative().safe();
const proofSchema=z.object({run_id:z.string(),base_run_id:z.string(),club_id:z.string(),staff_id:z.string(),recorded_net_vnd:amount,
  source_status:z.enum(['verified','unverified']),source:z.object({version:z.literal(1),staff_id:z.string(),club_id:z.string(),period_year:z.number().int(),period_month:z.number().int(),
    completed_days:amount,pending_days:amount,monthly_salary_vnd:amount,standard_shifts_per_month:amount.positive(),net_vnd:amount}).nullable()});
type Props={runId:string;baseRunId:string;staffId:string;clubId:string;year:number;month:number;netVnd:number};
export function SalaryRunSource(props:Props){
  const {user,session,loading}=useAuth(),epoch=sessionReadEpoch(session);
  const scope=JSON.stringify([props,user?.id,epoch,loading]),context=useMemo(()=>({scope}),[scope]),active=useRef(context);active.current=context;
  const [opened,setOpened]=useState<string|null>(null),enabled=opened===scope&&!!user?.id&&!!session?.access_token&&!loading;
  const query=useQuery({queryKey:['staffSalary','source',props.runId,props.baseRunId,props.netVnd,user?.id,epoch,props.clubId,props.staffId,props.year,props.month],enabled,retry:false,staleTime:60000,
    queryFn:async()=>{
      const {data,error}=await observeTrackerContextRead<{data:unknown;error:unknown}>((supabase as any).rpc('get_staff_salary_run_source_v1',{p_run_id:props.runId}));
      if(active.current!==context)throw Error('salary_source_superseded');if(error)throw error;
      const packet=proofSchema.parse(data),source=packet.source;
      if(packet.run_id!==props.runId||packet.base_run_id!==props.baseRunId||packet.club_id!==props.clubId||packet.staff_id!==props.staffId||packet.recorded_net_vnd!==props.netVnd
        ||(packet.source_status==='verified')!==!!source
        ||(source&&(source.club_id!==props.clubId||source.staff_id!==props.staffId||source.period_year!==props.year||source.period_month!==props.month)))throw Error('salary_source_scope_invalid');
      return packet;
    }});
  return <div className="w-full space-y-2 text-xs">
    <Button type="button" size="sm" variant="ghost" aria-expanded={opened===scope} onClick={()=>setOpened(opened===scope?null:scope)}>Nguồn tính phiếu lương</Button>
    {opened===scope&&<div className="rounded-md border border-border p-3 space-y-1" aria-label="Nguồn tính đã lưu">
      {!enabled?<p>Đăng nhập lại để đối chiếu nguồn tính.</p>:query.isPaused?<p role="status">Mất kết nối · chưa xác minh nguồn tính.</p>:query.isError?<p role="alert">Chưa xác minh được nguồn tính. <button type="button" className="underline" onClick={()=>void query.refetch()}>Thử lại nguồn tính</button></p>:!query.data?<p role="status">Đang đọc nguồn đã lưu…</p>:query.data.source_status==='unverified'?<p>Phiếu cũ chưa có nguồn tính đã lưu để đối chiếu.</p>:<>
        <p>Phiếu đang xem: {formatVND(query.data.recorded_net_vnd)}</p>
        <p>Nguồn đã lưu: {query.data.source!.completed_days} công hoàn tất · {query.data.source!.pending_days} công chờ hoàn tất.</p>
        <p>Mức tháng đã lưu: {formatVND(query.data.source!.monthly_salary_vnd)} · chuẩn {query.data.source!.standard_shifts_per_month} công.</p>
        <p>Thực nhận toàn kỳ theo nguồn: {formatVND(query.data.source!.net_vnd)}.</p>
      </>}
    </div>}
  </div>;
}
