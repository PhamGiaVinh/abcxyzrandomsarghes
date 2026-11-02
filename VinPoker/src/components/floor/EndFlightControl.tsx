import {useEffect,useRef,useState} from 'react';
import {z} from 'zod';
import {useSupabaseClient} from '@/integrations/supabase/SupabaseClientContext';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {AlertDialog,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel} from '@/components/ui/alert-dialog';
import {eventJournalKey,persistEventJournal,clearEventJournal} from '@/ops/floor/multiDayEventJournal';
import {waitForManualPlayerResponse} from '@/lib/floorManualPlayerIntent';
import {BaggedFlightReleaseControl} from './BaggedFlightReleaseControl';

const intentSchema=z.object({actorId:z.string().min(1),eventId:z.string().min(1),flightId:z.string().uuid(),
 dayNumber:z.number().int().positive().safe(),requestId:z.string().uuid()}).strict();
const receiptSchema=z.object({ok:z.literal(true),status:z.enum(['bagging','locked']),
 rosterCount:z.number().int().positive().safe(),rosterHash:z.string().regex(/^[a-f0-9]{32}$/),idempotent:z.boolean()});
type Intent=z.infer<typeof intentSchema>;
type Props={actorId:string;eventId:string;flightId:string;ended:boolean;canStart:boolean;blocked:boolean;
 onPendingChange:(pending:boolean)=>void;onEnded:()=>void};

/** Server freezes the roster. The client retains intent, never supplies stacks. */
export function EndFlightControl({actorId,eventId,flightId,ended,canStart,blocked,onPendingChange,onEnded}:Props){
 const client=useSupabaseClient(),alive=useRef(true),writing=useRef(false);
 const [journal,setJournal]=useState<{intent:Intent|null;error:string|null}>(()=>{
  try{
   const raw=sessionStorage.getItem(eventJournalKey('end-flight',actorId,eventId));
   const intent=raw===null?null:intentSchema.parse(JSON.parse(raw));
   if(intent&&(intent.actorId!==actorId||intent.eventId!==eventId))throw Error('scope');
   return {intent,error:null};
  }catch{return {intent:null,error:'Cannot verify the saved End Flight request. Event writes are held.'};}
 });
 const [day,setDay]=useState(''),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false);
 const [notice,setNotice]=useState<string|null>(null);
 const [releaseHeld,setReleaseHeld]=useState(false);
 const own=journal.intent?.flightId===flightId?journal.intent:null;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{onPendingChange(!!journal.intent||!!journal.error||releaseHeld);return()=>onPendingChange(false);},[journal.intent,journal.error,releaseHeld,onPendingChange]);
 const send=async()=>{
  if(writing.current||blocked||(!own&&(ended||!canStart||journal.intent||journal.error)))return;
  const parsed=intentSchema.safeParse(own??{actorId,eventId,flightId,dayNumber:Number(day),requestId:crypto.randomUUID()});
  if(!parsed.success)return;
  const intent=parsed.data,raw=JSON.stringify(intent);
  writing.current=true;setBusy(true);setConfirm(false);setNotice(null);
  try{
   persistEventJournal(sessionStorage,'end-flight',actorId,eventId,raw);
   setJournal({intent,error:null});
   const result=await waitForManualPlayerResponse(client.rpc('multi_day_end_flight_v1',{
    p_flight_tournament_id:intent.flightId,p_day_number:intent.dayNumber,p_request_id:intent.requestId,
   }));
   if(!alive.current)return;
   if(result.error)throw result.error;
   const receipt=receiptSchema.safeParse(result.data);
   if(!receipt.success)throw Error('unverified');
   clearEventJournal(sessionStorage,'end-flight',actorId,eventId,raw);
   setJournal({intent:null,error:null});
   setNotice(`Flight frozen: ${receipt.data.rosterCount} players. Record and seal their bags in Chip Master.`);
   onEnded();
  }catch(cause){
   if(!alive.current)return;
   const text=typeof cause==='object'&&cause&&'message'in cause?String(cause.message):'';
   const reason=text.includes('not_ready')?'Finish active hands and check existing bags/day close before retrying.'
    :text.includes('roster_inconsistent')?'Check canonical entries, sessions, Dealer assignment and tracked stacks.'
    :text.includes('actor_not_allowed')?'Only the club Owner or assigned Floor may end this flight.'
    :text.includes('release_off')?'Multi-day is not enabled for this club.'
    :'The result is unverified. Do not create another request.';
   setJournal(current=>({...current,error:reason}));
  }finally{writing.current=false;if(alive.current)setBusy(false);}
 };
 const dayValid=/^[1-9]\d*$/.test(day)&&Number.isSafeInteger(Number(day));
 return <section aria-label={`End Flight ${flightId}`} className="space-y-2 rounded border border-border p-3">
  <h4 className="font-medium">End Flight · {flightId.slice(0,8)}</h4>
  {notice&&<p role="status">{notice}</p>}
  {journal.error&&<p role="alert">{journal.error}</p>}
  {own?<><p role="status">End Flight day {own.dayNumber} is not reconciled. The original request is retained across reload.</p>
   <Button type="button" disabled={busy||blocked} onClick={()=>void send()}>Verify retained End Flight request</Button></>
   :journal.intent?<p role="status">Another flight has an unresolved End Flight request. Resolve it first.</p>
   :ended?<><p>Play ended. Continue bagging in Chip Master; this does not finalize payout.</p>
    <BaggedFlightReleaseControl actorId={actorId} eventId={eventId} flightId={flightId} blocked={blocked}
     canStart={canStart} onPendingChange={setReleaseHeld} onReleased={onEnded}/></>
   :<><Label htmlFor={`end-day-${flightId}`}>Day number</Label>
    <Input id={`end-day-${flightId}`} type="number" min="1" step="1" value={day} disabled={blocked||!canStart||!!journal.error}
     onChange={e=>setDay(e.target.value)}/>
    <Button type="button" disabled={busy||blocked||!canStart||!!journal.error} onClick={()=>setConfirm(true)}>End Flight</Button>
    {!canStart&&<p>Server package/rules state must allow this operation.</p>}</>}
  <AlertDialog open={confirm} onOpenChange={setConfirm}><AlertDialogContent>
   <AlertDialogHeader><AlertDialogTitle>End this flight?</AlertDialogTitle>
    <AlertDialogDescription>Freeze the tracked roster for day {day||'—'}. Finish all hands first. This blocks further play and opens bagging; it does not pay prizes or issue chips.</AlertDialogDescription></AlertDialogHeader>
   {!dayValid&&<p role="alert">Enter a positive whole day number before confirming.</p>}
   <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel>
    <Button type="button" disabled={!dayValid||busy||blocked} onClick={()=>void send()}>Confirm End Flight</Button></AlertDialogFooter>
  </AlertDialogContent></AlertDialog>
 </section>;
}
