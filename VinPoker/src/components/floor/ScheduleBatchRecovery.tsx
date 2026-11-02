import {useTranslation} from 'react-i18next';
import {Button} from '@/components/ui/button';
import type {useScheduleBatchCreate} from '@/hooks/useScheduleBatchCreate';
export function ScheduleBatchRecovery({batch,onRecovered}:{batch:ReturnType<typeof useScheduleBatchCreate>;onRecovered:()=>void}) {
 const {t}=useTranslation();
 return <div className="min-w-0 space-y-2 break-words text-sm">
  {batch.error&&<p role="alert" className="text-destructive">{batch.error}</p>}
  {batch.pending&&<div className="min-w-0 space-y-2 rounded border border-border p-3">
   <p role="status">{t('bulkCreate.pendingBatch',{count:batch.pending.p_rows.length})}</p>
   <Button className="h-auto min-h-10 max-w-full whitespace-normal text-left" variant="outline" disabled={batch.busy} onClick={()=>{void batch.recover().then(ids=>{if(ids?.length)onRecovered();});}}>{t('bulkCreate.checkReceipt')}</Button>
   <Button className="h-auto min-h-10 max-w-full whitespace-normal text-left" variant="outline" disabled={batch.busy} onClick={()=>{void batch.cancel().then(ids=>{if(ids?.length)onRecovered();});}}>{t('bulkCreate.cancelPendingBatch')}</Button>
  </div>}
 </div>;
}
