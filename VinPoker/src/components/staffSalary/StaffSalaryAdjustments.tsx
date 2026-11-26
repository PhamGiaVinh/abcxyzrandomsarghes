import {useRef,useState} from 'react';
import {useSalaryAdjustments} from '@/hooks/staffSalary/useSalaryAdjustments';
import {useAuth} from '@/hooks/useAuth';
import {sessionReadEpoch} from '@/lib/sessionReadEpoch';
import {formatVND} from '@/lib/format';
import type {SalaryRow,StaffSalarySource} from '@/lib/staffSalary/types';
import {Card} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';

export function StaffSalaryAdjustments({source,clubId,year,month,rows,canApprove}:{source:StaffSalarySource;clubId:string;year:number;month:number;rows:SalaryRow[];canApprove:boolean}){
  const query=useSalaryAdjustments(source,clubId,year,month,canApprove);
  const {user,session}=useAuth();
  const scope=JSON.stringify([clubId,year,month,user?.id,sessionReadEpoch(session),canApprove]);
  const active=useRef(scope);active.current=scope;
  const [selected,setSelected]=useState<{id:string;scope:string}|null>(null),[notice,setNotice]=useState<{text:string;scope:string}|null>(null);
  const pending=query.data?.requests.filter(row=>row.state==='pending')??[];
  const valid=pending.every(request=>rows.some(row=>row.runId===request.base_run_id&&row.staffId===request.staff_id&&!row.adjustsId&&row.employmentType==='full_time'));
  const current=canApprove&&selected?.scope===scope?pending.find(row=>row.id===selected.id):undefined;
  const base=current?rows.find(row=>row.runId===current.base_run_id):undefined;
  if(query.isPaused)return <Card role="status" className="p-3 text-sm">Mất kết nối · đề nghị bổ sung sẽ cập nhật khi có mạng.</Card>;
  if(query.isError||!valid)return <Card role="alert" className="p-3 text-sm">Chưa xác minh được đề nghị bổ sung. <Button variant="outline" size="sm" onClick={()=>void query.refetch()}>Tải lại đề nghị</Button></Card>;
  if(query.isLoading)return <p role="status" className="text-sm text-muted-foreground">Đang đối chiếu khoản bổ sung…</p>;
  if(!pending.length)return null;
  return <Card className="p-4 space-y-3">
    <h2 className="font-bold text-sm">Bổ sung chờ chủ CLB duyệt</h2>
    <p className="text-xs text-muted-foreground">Ca hoàn tất sau khi chốt được đối chiếu riêng. Đề nghị chưa phải khoản đã duyệt hoặc đã chi; phiếu gốc giữ nguyên.</p>
    {pending.map(request=>{
      const employee=rows.find(row=>row.runId===request.base_run_id)!;
      return <div key={request.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <p className="min-w-0 break-words text-sm">{employee.fullName} · <span className="font-bold tabular-nums">{formatVND(request.amount_vnd)}</span></p>
        {canApprove?<Button size="sm" variant="outline" disabled={query.approve.isPending||query.isFetching} onClick={()=>{setNotice(null);setSelected({id:request.id,scope});}}>Xem và duyệt bổ sung</Button>:<span className="text-xs text-muted-foreground">Chờ chủ CLB duyệt · chưa ghi chi</span>}
      </div>;
    })}
    {notice?.scope===scope&&<p role="status" className="text-sm">{notice.text}</p>}
    <Dialog open={!!current&&!!base} onOpenChange={open=>{if(!open)setSelected(null);}}>
      <DialogContent>
        <DialogHeader><DialogTitle>Duyệt khoản bổ sung</DialogTitle><DialogDescription>Đối chiếu khoản bổ sung với phiếu gốc. Duyệt tạo phiếu bổ sung riêng để ghi chi sau.</DialogDescription></DialogHeader>
        {current&&base&&<>
          <p>{base.fullName} · {month}/{year}</p>
          <p>Phiếu gốc: {formatVND(base.netVnd)}</p>
          <p className="font-bold">Bổ sung: {formatVND(current.amount_vnd)}</p>
          <Button disabled={query.approve.isPending||query.isFetching} onClick={async()=>{
            if(!current||query.approve.isPending)return;
            const intent={requestId:current.id,baseRunId:current.base_run_id,staffId:current.staff_id};
            setSelected(null);
            try{await query.approve.mutateAsync(intent);if(active.current===scope)setNotice({scope,text:'Đã duyệt khoản bổ sung. Phiếu bổ sung được ghi chi riêng.'});}
            catch(error){if(active.current===scope)setNotice({scope,text:error instanceof Error?error.message:'Chưa xác minh được kết quả duyệt. Tải lại trước khi thực hiện tiếp.'});}
          }}>Duyệt riêng khoản bổ sung</Button>
        </>}
      </DialogContent>
    </Dialog>
  </Card>;
}
