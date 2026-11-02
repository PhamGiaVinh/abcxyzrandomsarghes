import {Button} from '@/components/ui/button';
import {AlertDialog,AlertDialogTrigger,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,
 AlertDialogFooter,AlertDialogCancel,AlertDialogAction} from '@/components/ui/alert-dialog';
import type {StandaloneHandInput} from './useStandaloneHandInput';

/** Shared recovery controls for the product console and native browser harness. */
export function PendingFinishControls({hook}:{hook:Pick<StandaloneHandInput,
 'pendingFinish'|'pendingFinishError'|'submitting'|'handleReconcilePendingFinish'|'handleCancelPendingFinish'
 |'pendingUndo'|'pendingUndoCancellationToken'|'undoRecoveryBusy'|'undoRecoveryError'|'handleReconcilePendingUndo'|'handleCancelPendingUndo'>}) {
 return <>
  {hook.pendingUndo&&<div role="status" className="flex flex-wrap items-center gap-2 border border-border bg-muted p-3 text-sm">
   <span>Undo đang chờ xác minh. Đối chiếu receipt hoặc xác nhận hủy yêu cầu; không gửi lại lệnh hoàn tác.</span>
   <Button variant="outline" size="sm" disabled={hook.submitting||hook.undoRecoveryBusy} onClick={hook.handleReconcilePendingUndo}>
    {hook.undoRecoveryBusy?'Đang đối chiếu Undo…':'Đối chiếu Undo đã gửi'}
   </Button>
   {hook.pendingUndoCancellationToken&&<AlertDialog key={hook.pendingUndoCancellationToken}>
    <AlertDialogTrigger asChild><Button variant="outline" size="sm" disabled={hook.submitting||hook.undoRecoveryBusy}>
     Hủy yêu cầu Undo (giữ hành động)
    </Button></AlertDialogTrigger>
    <AlertDialogContent>
     <AlertDialogHeader><AlertDialogTitle>Hủy yêu cầu Undo đang chờ?</AlertDialogTitle>
      <AlertDialogDescription>Không xóa hành động. Nếu Undo đã được máy chủ ghi nhận, kết quả đó vẫn được giữ. Chỉ hủy đúng yêu cầu đang chờ; máy chủ sẽ chặn bản gửi đến muộn.</AlertDialogDescription>
     </AlertDialogHeader>
     <AlertDialogFooter><AlertDialogCancel>Giữ yêu cầu Undo</AlertDialogCancel>
      <AlertDialogAction disabled={hook.submitting||hook.undoRecoveryBusy}
       onClick={()=>hook.handleCancelPendingUndo(hook.pendingUndoCancellationToken!)}>Xác nhận hủy yêu cầu Undo</AlertDialogAction>
     </AlertDialogFooter>
    </AlertDialogContent>
   </AlertDialog>}
   {hook.undoRecoveryError&&<p role="alert" className="w-full text-destructive">{hook.undoRecoveryError}</p>}
  </div>}
  {hook.pendingFinishError&&<p role="alert" className="border border-destructive p-3 text-sm">{hook.pendingFinishError}</p>}
  {hook.pendingFinish&&<div role="status" className="flex flex-wrap items-center gap-2 border border-border bg-muted p-3 text-sm">
   <span>Finish đang chờ xác minh. Không gửi yêu cầu mới khi chưa rõ kết quả.</span>
   <Button variant="outline" size="sm" disabled={hook.submitting} onClick={hook.handleReconcilePendingFinish}>
    Đối chiếu Finish đã gửi
   </Button>
   <AlertDialog key={JSON.stringify([hook.pendingFinish.actor_id,hook.pendingFinish.tournament_id,hook.pendingFinish.tournament_table_id,hook.pendingFinish.hand_id,hook.pendingFinish.request_id])}>
    <AlertDialogTrigger asChild><Button variant="outline" size="sm" disabled={hook.submitting||!hook.pendingFinish.request_id}>
     Hủy yêu cầu Finish (không void hand)
    </Button></AlertDialogTrigger>
    <AlertDialogContent>
     <AlertDialogHeader><AlertDialogTitle>Hủy yêu cầu Finish đang chờ?</AlertDialogTitle>
      <AlertDialogDescription>Không void hand. Nếu máy chủ đã lưu, kết quả đã lưu sẽ được giữ. Chỉ hủy đúng yêu cầu đang chờ xác minh.</AlertDialogDescription>
     </AlertDialogHeader>
     <AlertDialogFooter><AlertDialogCancel>Giữ yêu cầu</AlertDialogCancel>
      <AlertDialogAction disabled={hook.submitting} onClick={()=>hook.handleCancelPendingFinish(hook.pendingFinish!.request_id)}>Xác nhận hủy yêu cầu Finish</AlertDialogAction>
     </AlertDialogFooter>
    </AlertDialogContent>
   </AlertDialog>
  </div>}
 </>;
}
