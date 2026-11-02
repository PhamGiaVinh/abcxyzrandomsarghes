import {useCallback,useEffect,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useSupabaseClient} from '@/integrations/supabase/SupabaseClientContext';
import {Button} from '@/components/ui/button';
import {AlertDialog,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel} from '@/components/ui/alert-dialog';
import {waitForManualPlayerResponse} from '@/lib/floorManualPlayerIntent';
import {callMultiDayFloorRpc} from '@/ops/floor/multiDayFloorRpc';
import {eventJournalKey,persistEventJournal,clearEventJournal} from '@/ops/floor/multiDayEventJournal';
import {baggedReleaseIntentSchema,parseBaggedFlightContext,releaseBaggedFlightArgs,verifiedBaggedReleaseReceipt,
 type BaggedFlightContext,type BaggedReleaseIntent} from '@/ops/floor/baggedFlightRelease';
type Props={actorId:string;eventId:string;flightId:string;blocked:boolean;canStart:boolean;
 onPendingChange:(value:boolean)=>void;onReleased:()=>void};

export function BaggedFlightReleaseControl(props:Props){
 return <BaggedFlightReleaseScope key={JSON.stringify([props.actorId,props.eventId,props.flightId])} {...props}/>;
}
function BaggedFlightReleaseScope({actorId,eventId,flightId,blocked,canStart,onPendingChange,onReleased}:Props){
 const client=useSupabaseClient(),{t}=useTranslation();
 const alive=useRef(true),writing=useRef(false),generation=useRef(0);
 const [context,setContext]=useState<BaggedFlightContext|null>(null),[loading,setLoading]=useState(true);
 const [readError,setReadError]=useState(false),[writeError,setWriteError]=useState(false);
 const [busy,setBusy]=useState(false),[confirm,setConfirm]=useState<BaggedReleaseIntent|null>(null);
 const [journal,setJournal]=useState<{intent:BaggedReleaseIntent|null;invalid:boolean}>(()=>{
  try{
   const raw=sessionStorage.getItem(eventJournalKey('bag-release',actorId,eventId));
   const intent=raw===null?null:baggedReleaseIntentSchema.parse(JSON.parse(raw));
   if(intent&&(intent.actorId!==actorId||intent.eventId!==eventId))throw Error('scope');
   return {intent,invalid:false};
  }catch{return {intent:null,invalid:true};}
 });
 const own=journal.intent?.flightId===flightId?journal.intent:null;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{onPendingChange(!!journal.intent||journal.invalid);return()=>onPendingChange(false);},[journal.intent,journal.invalid,onPendingChange]);
 const reload=useCallback(async()=>{
  const seq=++generation.current;setLoading(true);setReadError(false);setConfirm(null);
  try{
   const data=await waitForManualPlayerResponse(callMultiDayFloorRpc<unknown>(client,'get_bagged_flight_tables_v1',{p_flight_tournament_id:flightId}));
   if(alive.current&&seq===generation.current)setContext(parseBaggedFlightContext(data,eventId,flightId));
  }catch{if(alive.current&&seq===generation.current){setContext(null);setReadError(true);}}
  finally{if(alive.current&&seq===generation.current)setLoading(false);}
 },[client,eventId,flightId]);
 useEffect(()=>{void reload();},[reload]);
 const send=async(intent:BaggedReleaseIntent)=>{
  if(writing.current||blocked||(!own&&(!canStart||loading||readError||journal.intent||journal.invalid)))return;
  writing.current=true;setBusy(true);setWriteError(false);setConfirm(null);
  const raw=JSON.stringify(intent);
  try{
   persistEventJournal(sessionStorage,'bag-release',actorId,eventId,raw);
   setJournal({intent,invalid:false});
   const data=await waitForManualPlayerResponse(callMultiDayFloorRpc<unknown>(client,'release_bagged_flight_table_v1',releaseBaggedFlightArgs(intent)));
   if(!alive.current)return;
   if(!verifiedBaggedReleaseReceipt(data,intent))throw Error('unverified');
   clearEventJournal(sessionStorage,'bag-release',actorId,eventId,raw);
   setJournal({intent:null,invalid:false});await reload();if(alive.current)onReleased();
  }catch{if(alive.current)setWriteError(true);}
  finally{writing.current=false;if(alive.current)setBusy(false);}
 };
 return <section className="space-y-2 border-t border-border pt-3" aria-label={t('baggedFlightRelease.title')}>
  <h5 className="font-medium">{t('baggedFlightRelease.title')}</h5>
  <p className="text-sm text-muted-foreground">{t('baggedFlightRelease.note')}</p>
  <Button type="button" variant="outline" disabled={loading||busy} onClick={()=>void reload()}>{t('baggedFlightRelease.refresh')}</Button>
  {loading&&<p role="status">{t('baggedFlightRelease.loading')}</p>}
  {readError&&<p role="alert">{t('baggedFlightRelease.readError')}</p>}
  {(writeError||journal.invalid)&&<p role="alert">{t('baggedFlightRelease.unknown')}</p>}
  {own?<Button type="button" disabled={busy||blocked} onClick={()=>void send(own)}>{t('baggedFlightRelease.recover')}</Button>
   :journal.intent?<p role="status">{t('baggedFlightRelease.peer')}</p>:null}
  {!loading&&context?.state!=='locked'&&context&&<p>{t('baggedFlightRelease.bagFirst')}</p>}
  {!loading&&context?.state==='locked'&&context.tables.length===0&&<p role="alert">{t('baggedFlightRelease.readError')}</p>}
  {!loading&&context?.tables.map(row=><div key={row.tableSessionId} className="space-y-1 rounded border border-border p-2">
   <p className="break-words">{row.name??row.tournamentTableId} · {row.playerCount} · {row.baggedTotal.toLocaleString()}</p>
   {row.state==='released'?<p role="status">{t('baggedFlightRelease.released')}</p>
    :row.state==='blocked'?<p role="alert">{t('baggedFlightRelease.readError')}</p>
    :<Button type="button" disabled={busy||blocked||!canStart||!context.releaseEnabled||!!journal.intent||journal.invalid||readError}
      onClick={()=>setConfirm(baggedReleaseIntentSchema.parse({actorId,eventId,flightId,
       tournamentTableId:row.tournamentTableId,tableSessionId:row.tableSessionId,revision:row.revision,
       playerCount:row.playerCount,baggedTotal:row.baggedTotal,rosterHash:context.rosterHash,
       dayVersion:context.dayVersion,requestId:crypto.randomUUID()}))}>{t('baggedFlightRelease.release')}</Button>}
  </div>)}
  <AlertDialog open={confirm!==null} onOpenChange={open=>{if(!open)setConfirm(null);}}><AlertDialogContent>
   <AlertDialogHeader><AlertDialogTitle>{t('baggedFlightRelease.confirm')}</AlertDialogTitle>
    <AlertDialogDescription>{t('baggedFlightRelease.note')}</AlertDialogDescription></AlertDialogHeader>
   {confirm&&<p className="break-words">{context?.tables.find(row=>row.tableSessionId===confirm.tableSessionId)?.name??confirm.tournamentTableId}
    {' · '}{confirm.playerCount}{' · '}{confirm.baggedTotal.toLocaleString()}</p>}
   <AlertDialogFooter><AlertDialogCancel>{t('baggedFlightRelease.cancel')}</AlertDialogCancel>
    <Button type="button" disabled={busy||blocked||!canStart||loading||readError} onClick={()=>{if(confirm)void send(confirm);}}>{t('baggedFlightRelease.confirm')}</Button>
   </AlertDialogFooter>
  </AlertDialogContent></AlertDialog>
 </section>;
}
