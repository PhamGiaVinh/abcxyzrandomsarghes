import {AlertDialog,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,
 AlertDialogFooter,AlertDialogCancel,AlertDialogAction} from '@/components/ui/alert-dialog';
import type {StandaloneHandInput} from './useStandaloneHandInput';
import {formatStack} from './format';

/** Shared explicit confirmation; never sends an action merely by opening. */
export function AllInConfirmation({hook}:{hook:StandaloneHandInput}){
 const intent=hook.pendingAllIn;
 if(!intent)return null;
 return <AlertDialog open onOpenChange={open=>{if(!open)hook.cancelPendingAllIn();}}>
  <AlertDialogContent>
   <AlertDialogHeader><AlertDialogTitle>Xác nhận ALL-IN</AlertDialogTitle>
    <AlertDialogDescription>ALL-IN {formatStack(intent.stack)} của {intent.displayName}? Toàn bộ stack sẽ vào pot. Yêu cầu sẽ bị từ chối nếu hand hoặc người hành động đã đổi.</AlertDialogDescription>
   </AlertDialogHeader>
   <AlertDialogFooter><AlertDialogCancel autoFocus>Hủy</AlertDialogCancel>
    <AlertDialogAction disabled={hook.submitting||hook.isReadOnly||hook.actionSyncBlocked} onClick={hook.confirmPendingAllIn}>Xác nhận ALL-IN</AlertDialogAction>
   </AlertDialogFooter>
  </AlertDialogContent>
 </AlertDialog>;
}
