import {useEffect,useMemo,useState} from 'react';
import {useAuth} from '@/hooks/useAuth';
import {supabase} from '@/integrations/supabase/client';
import {sessionReadEpoch} from '@/lib/sessionReadEpoch';
import {startLiveReportRefresh} from '@/lib/liveReportRefresh';
import {observeTrackerContextRead} from '@/lib/tournament/observeTrackerContextRead';
import {parsePtStatementHistory,type PtStatementHistory,type PtStatementCursor} from '@/lib/ptStatementDetails';
import {PtStatementDetailsDialog} from '@/components/cashier/PtStatementDetailsDialog';
import {Button} from '@/components/ui/button';
import {formatVND} from '@/lib/format';

type Scope={clubId:string;dealerId:string};
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
const date=(s:string)=>new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',dateStyle:'short',timeStyle:'short'}).format(new Date(s));

/** The recipient sees frozen obligations separately from unfinalized accrual. No payment controls. */
export function DealerPtStatementHistory(scope:Scope) {
  const {user,session,loading}=useAuth();
  const ready=!!(user?.id && session?.access_token && !loading);
  if(!ready) return null;
  return <ScopedHistory key={JSON.stringify([user.id,sessionReadEpoch(session),scope.clubId,scope.dealerId])} {...scope}/>;
}

function ScopedHistory({clubId,dealerId}:Scope) {
  const [before,setBefore]=useState<PtStatementCursor|null>(null);
  const [revision,setRevision]=useState(0);
  const identity=JSON.stringify([clubId,dealerId,before,revision]);
  const context=useMemo(()=>({identity}),[identity]);
  const [state,setState]=useState<{context:object;data:PtStatementHistory|null;error:boolean}|null>(null);
  const [selected,setSelected]=useState<{context:object;id:string}|null>(null);
  useEffect(()=>{
    let disposed=false;
    const stop=startLiveReportRefresh(async()=>{
      try {
        const result=await observeTrackerContextRead((supabase.rpc as unknown as Rpc)('list_my_pt_statements_v1',{
          p_club_id:clubId,p_dealer_id:dealerId,p_before_at:before?.finalized_at??null,p_before_id:before?.statement_id??null,
        }));
        if(result.error) throw result.error;
        const data=parsePtStatementHistory(result.data,{club_id:clubId,dealer_id:dealerId},before);
        if(!disposed) setState({context,data,error:false});
      } catch {
        if(!disposed) setState({context,data:null,error:true});
      }
    });
    return ()=>{disposed=true;stop();};
    // Context represents the complete page/retry scope; identities change by remount above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[context]);
  const current=state?.context===context?state:null;
  const page=current?.data;
  const statement=selected?.context===context?page?.items.find(row=>row.statement_id===selected.id)??null:null;
  return <section aria-label="Phiếu lương PT đã chốt" className="mb-3 rounded-2xl border border-border bg-card p-4">
    <header className="mb-3 space-y-1">
      <h2 className="text-sm font-semibold">Phiếu lương đã chốt</h2>
      <p className="text-xs text-muted-foreground">Tách riêng với số tạm tính chưa chốt. Số đã chi do CLB ghi nhận, chưa thay thế xác nhận nhận tiền.</p>
    </header>
    {current?.error?<p role="alert" className="text-sm text-destructive">Chưa tải được phiếu đã chốt. Hãy tải lại.</p>
      :!page?<p role="status" className="text-sm text-muted-foreground">Đang đọc phiếu đã chốt…</p>
      :page.items.length===0?<p className="text-sm text-muted-foreground">{before?'Không có phiếu cũ hơn.':'Chưa có phiếu lương PT đã chốt.'}</p>
      :<ul className="divide-y divide-border">{page.items.map(row=><li key={row.statement_id} aria-label={`Phiếu ${row.statement_id}`} className="min-w-0 space-y-3 py-3 first:pt-0">
        <p className="text-xs text-muted-foreground">Chốt {date(row.finalized_at)}{['voided','replaced'].includes(row.state)?' · Đã hủy hoặc thay thế':''}</p>
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Amount label="Đã chốt" value={row.net_amount_vnd}/>
          <Amount label="CLB đã ghi chi" value={row.paid_total_vnd}/>
          <Amount label="Còn phải trả" value={row.remaining_vnd}/>
        </dl>
        <Button variant="outline" size="sm" className="min-h-11" aria-label={`Xem phiếu ${row.statement_id}`} onClick={()=>setSelected({context,id:row.statement_id})}>Xem phiếu &amp; lịch sử chi</Button>
      </li>)}</ul>}
    <footer className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
      <Button variant="ghost" size="sm" className="min-h-11" onClick={()=>{setSelected(null);setBefore(null);setRevision(v=>v+1);}}>Tải lại mới nhất</Button>
      {page?.next_cursor && <Button variant="outline" size="sm" className="min-h-11" onClick={()=>{setSelected(null);setBefore(page.next_cursor);}}>Xem phiếu cũ hơn</Button>}
    </footer>
    <PtStatementDetailsDialog statement={statement} open={!!statement} onOpenChange={open=>{if(!open)setSelected(null);}}/>
  </section>;
}

function Amount({label,value}:{label:string;value:number}) {
  return <div className="flex min-w-0 items-baseline justify-between gap-3 sm:block"><dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="mt-1 whitespace-nowrap font-mono text-sm font-semibold tabular-nums">{formatVND(value)}</dd></div>;
}
