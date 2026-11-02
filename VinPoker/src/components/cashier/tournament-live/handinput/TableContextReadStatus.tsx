import {Loader2} from 'lucide-react';
import {Button} from '@/components/ui/button';

/** Shared by both operator layouts; unavailable is never an empty seat map. */
export function TableContextReadStatus({state,message,onBack,onRetry}:{state:'loading'|'error';message?:string|null;onBack:()=>void;onRetry:()=>void}){
  return <section className="space-y-3 rounded-xl border border-border bg-card p-4" role={state==='loading'?'status':'alert'} aria-busy={state==='loading'}>
    <p className="flex items-center gap-2 text-sm">
      {state==='loading'&&<Loader2 className="h-4 w-4 animate-spin" aria-hidden/>}
      {state==='loading'?'Đang tải người chơi và trạng thái hand của bàn…':message||'Chưa xác minh được người chơi hoặc trạng thái hand. Không thao tác trên dữ liệu chưa tải được.'}
    </p>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={onBack}>Quay lại danh sách bàn</Button>
      {state==='error'&&<Button onClick={onRetry}>Thử tải lại bàn</Button>}
    </div>
  </section>;
}
