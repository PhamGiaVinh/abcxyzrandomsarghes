import {useEffect,useMemo,useState} from 'react';
import {useAuth} from '@/hooks/useAuth';
import {supabase} from '@/integrations/supabase/client';
import {parsePtStatementDetails,type PtStatementBinding,type PtStatementDetails} from '@/lib/ptStatementDetails';
import {sessionReadEpoch} from '@/lib/sessionReadEpoch';
import {startLiveReportRefresh} from '@/lib/liveReportRefresh';
import {observeTrackerContextRead} from '@/lib/tournament/observeTrackerContextRead';
import {formatVND} from '@/lib/format';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';

type Props={statement:PtStatementBinding|null;open:boolean;onOpenChange:(open:boolean)=>void};
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
type ReadState={context:object;data:PtStatementDetails|null;error:boolean;loading:boolean};
const date=(value:string)=>new Intl.DateTimeFormat('vi-VN',{
  timeZone:'Asia/Ho_Chi_Minh',dateStyle:'short',timeStyle:'short',
}).format(new Date(value));

export function PtStatementDetailsDialog({statement,open,onOpenChange}:Props) {
  const {user,session,loading:authLoading}=useAuth();
  const [revision,setRevision]=useState(0);
  const identity=JSON.stringify([user?.id,sessionReadEpoch(session),authLoading,open,revision,
    statement?.statement_id,statement?.statement_hash,statement?.club_id,statement?.dealer_id,statement?.net_amount_vnd]);
  const context=useMemo(()=>({identity}),[identity]);
  const [state,setState]=useState<ReadState|null>(null);
  const ready=!!(open && statement && user?.id && session?.access_token && !authLoading);
  useEffect(()=>{
    if(!ready || !statement) return;
    let disposed=false;
    const stop=startLiveReportRefresh(async()=>{
      setState(prior=>({context,data:prior?.context===context?prior.data:null,error:false,loading:true}));
      try {
        const result=await observeTrackerContextRead((supabase.rpc as unknown as Rpc)('get_pt_statement_installments_v1',{
          p_statement_id:statement.statement_id,
        }));
        if(result.error) throw result.error;
        const data=parsePtStatementDetails(result.data,statement);
        if(!disposed) setState({context,data,error:false,loading:false});
      } catch {
        if(!disposed) setState({context,data:null,error:true,loading:false});
      }
    });
    return ()=>{disposed=true;stop();};
    // Context includes every immutable expected field, actor/session and visibility.
    // Recreated parent objects with the same facts must not start another poller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[context,ready]);
  const current=ready && state?.context===context?state:null;
  const data=current?.data;
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="operations-typography flex max-h-[90dvh] max-w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl [&>button]:right-2 [&>button]:top-2 [&>button]:grid [&>button]:h-11 [&>button]:w-11 [&>button]:place-items-center">
      <DialogHeader className="border-b border-border px-5 py-4 pr-16 text-left">
        <DialogTitle>Phiếu lương PT</DialogTitle>
        <DialogDescription>Số đã chốt và lịch sử chi từ cùng một phiếu lương.</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
        {!ready ? <p role="alert">Phiên đăng nhập chưa sẵn sàng.</p>
          : current?.error ? <div role="alert" className="space-y-3"><p>Chưa tải được phiếu lương. Hãy thử tải lại.</p>
            <Button variant="outline" onClick={()=>setRevision(v=>v+1)}>Tải lại phiếu</Button></div>
          : !data ? <p role="status">Đang đọc phiếu từ máy chủ…</p> : <>
          <header className="min-w-0 space-y-1">
            <p className="text-sm text-muted-foreground break-words">{data.club_name}</p>
            <h2 className="break-words text-xl font-semibold">{data.dealer_name}</h2>
            <p className="text-xs text-muted-foreground">Chốt ngày {date(data.finalized_at)}{['voided','replaced'].includes(data.state)?' · Đã hủy hoặc thay thế':''}</p>
          </header>
          <dl className="grid grid-cols-1 gap-3 min-[440px]:grid-cols-3">
            <Amount label="Đã chốt" value={data.approved_amount_vnd}/>
            <Amount label="Đã ghi nhận chi" value={data.paid_total_vnd}/>
            <Amount label="Còn phải trả" value={data.remaining_vnd} emphasis/>
          </dl>
          <section aria-label="Thu nhập đã chốt" className="space-y-3">
            <h3 className="font-semibold">Thu nhập đã chốt</h3>
            <ul className="divide-y divide-border rounded-lg border border-border px-3">
              {data.lines.map(line=><li key={line.line_no} className="min-w-0 py-3 sm:flex sm:items-start sm:justify-between sm:gap-4">
                <div className="min-w-0"><p className="break-words text-sm">{line.label}</p>
                  {line.quantity!==null && <p className="text-xs text-muted-foreground">{line.quantity.toLocaleString('vi-VN')} {line.unit}
                    {line.unit_rate_vnd!==null?` · Đơn giá ${formatVND(line.unit_rate_vnd)}`:''}</p>}</div>
                <p className="mt-1 shrink-0 whitespace-nowrap font-mono text-sm font-medium tabular-nums sm:mt-0 sm:text-right">{formatVND(line.amount_vnd)}</p>
              </li>)}
            </ul>
          </section>
          <section aria-label="Lịch sử chi" className="space-y-3">
            <h3 className="font-semibold">Các khoản CLB đã ghi nhận chi</h3>
            <p className="text-xs text-muted-foreground">Lịch sử này chưa thay thế xác nhận nhân viên đã nhận tiền hoặc đối soát ngân hàng.</p>
            {data.payments.length===0?<p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">Chưa có khoản chi được ghi nhận.</p>
              : <ol className="divide-y divide-border rounded-lg border border-border px-3">{data.payments.map(payment=><li key={payment.payment_id} className="min-w-0 py-3 sm:flex sm:items-start sm:justify-between sm:gap-4">
                <div className="min-w-0 space-y-1"><p className="text-sm">{date(payment.paid_at)} · {payment.payment_method==='bank'?'Chuyển khoản':payment.payment_method==='cash'?'Tiền mặt':payment.payment_method ?? 'Chưa ghi phương thức'}</p>
                  {payment.payment_reference && <p className="break-all text-xs text-muted-foreground">{payment.payment_reference}</p>}</div>
                <p className="mt-1 shrink-0 whitespace-nowrap font-mono font-medium tabular-nums sm:mt-0 sm:text-right">{formatVND(payment.amount_vnd)}</p>
              </li>)}</ol>}
          </section>
          <details className="min-w-0 border-t border-border pt-3 text-xs text-muted-foreground">
            <summary className="cursor-pointer py-2">Mã phiếu và đối chiếu</summary>
            <p className="break-all">{data.statement_id}</p><p className="break-all">{data.statement_hash}</p>
            <p className="mt-2">Cập nhật từ máy chủ: {date(data.as_of)}</p>
          </details>
        </>}
      </div>
      <footer className="flex justify-end border-t border-border px-5 py-3">
        <Button variant="outline" className="min-h-11" onClick={()=>onOpenChange(false)}>Đóng phiếu</Button>
      </footer>
    </DialogContent>
  </Dialog>;
}

function Amount({label,value,emphasis=false}:{label:string;value:number;emphasis?:boolean}) {
  return <div aria-label={label} className={`min-w-0 rounded-lg border p-3 ${emphasis?'border-primary/30 bg-primary/5':'border-border bg-muted/30'}`}>
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="mt-1 break-all font-mono text-lg font-semibold tabular-nums">{formatVND(value)}</dd>
  </div>;
}
