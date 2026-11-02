import {AlertDialog,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,
 AlertDialogFooter,AlertDialogCancel,AlertDialogAction} from '@/components/ui/alert-dialog';
import type {StandaloneHandInput} from './useStandaloneHandInput';

export function VoidConfirmation({hook}:{hook:Pick<StandaloneHandInput,'pendingVoid'|'cancelPendingVoid'|'confirmPendingVoid'|'submitting'>}){
 const intent=hook.pendingVoid;
 if(!intent)return null;
 return <AlertDialog open onOpenChange={open=>{if(!open)hook.cancelPendingVoid();}}>
  <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Xác nhận Void hand</AlertDialogTitle>
   <AlertDialogDescription>Toàn bộ chip của hand này sẽ hoàn về trạng thái trước hand. Lịch sử Void được giữ; đây không phải Finish và không chốt kết quả hand. Yêu cầu bị từ chối nếu hand hoặc phiên bàn đã đổi. Mã hand: {intent.handId}</AlertDialogDescription>
  </AlertDialogHeader><AlertDialogFooter><AlertDialogCancel autoFocus disabled={hook.submitting}>Giữ hand</AlertDialogCancel>
   <AlertDialogAction disabled={hook.submitting} onClick={()=>void hook.confirmPendingVoid()}>Xác nhận Void hand</AlertDialogAction>
  </AlertDialogFooter></AlertDialogContent>
 </AlertDialog>;
}
