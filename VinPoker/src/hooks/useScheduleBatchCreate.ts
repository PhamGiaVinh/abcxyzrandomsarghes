import {useEffect,useRef,useState} from 'react';
import {useAuth} from '@/hooks/useAuth';
import {supabase} from '@/integrations/supabase/client';
import {sessionReadEpoch} from '@/lib/sessionReadEpoch';
import {createScheduleBatch,cancelScheduleBatch,recoverScheduleBatch,persistScheduleBatchJournal,readScheduleBatchJournal,
 scheduleBatchJournalKey,settleScheduleBatchJournal,type ScheduleBatchRequest,type ScheduleRow} from '@/lib/tournamentScheduleBatch';

export function useScheduleBatchCreate() {
 const {user,session}=useAuth(),scope=`${user?.id}:${sessionReadEpoch(session)}`;
 const current=useRef(scope),alive=useRef(true),flight=useRef(false);current.current=scope;
 const [loaded,setLoaded]=useState(''),[pending,setPending]=useState<ScheduleBatchRequest|null>(null);
 const [error,setError]=useState<string|null>(null),[storageError,setStorageError]=useState(false),[busy,setBusy]=useState(false);
 useEffect(()=>{
  alive.current=true;setPending(null);setError(null);setStorageError(false);setBusy(false);
  try {if(user?.id){const raw=sessionStorage.getItem(scheduleBatchJournalKey(user.id));if(raw)setPending(readScheduleBatchJournal(raw,user.id));}}
  catch {setStorageError(true);setError('SCHEDULE_JOURNAL_INVALID');}
  setLoaded(scope);return()=>{alive.current=false;};
 },[scope,user?.id]);
 const visiblePending=pending?.p_expected_actor_id===user?.id&&loaded===scope?pending:null;
 const blocked=!user?.id||loaded!==scope||storageError||!!visiblePending;
 const run=async(rows?:ScheduleRow[],cancel=false)=>{
  if(flight.current||!user?.id||loaded!==scope||storageError||!alive.current)return null;
  if(rows&&visiblePending)return null;
  const captured=scope,actor=user.id;flight.current=true;setBusy(true);setError(null);
  const active=()=>alive.current&&current.current===captured;
  try {
   let request=visiblePending;
   if(rows){
    if(sessionStorage.getItem(scheduleBatchJournalKey(actor))!==null)throw new Error('SCHEDULE_JOURNAL_CHANGED');
    request={p_expected_actor_id:actor,p_request_id:crypto.randomUUID(),p_rows:rows};
    persistScheduleBatchJournal(sessionStorage,request);setPending(request);
   }
   if(!request)return null;
   const rpc=(name:string,args:Record<string,unknown>)=>(supabase as unknown as {rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>}).rpc(name,args);
   const ids=await (cancel?cancelScheduleBatch(rpc,request):rows?createScheduleBatch(rpc,request):recoverScheduleBatch(rpc,request));
   if(!active())return null;
   settleScheduleBatchJournal(sessionStorage,request);setPending(null);return ids;
  }catch(cause){if(active())setError(cause instanceof Error?cause.message:'SCHEDULE_OUTCOME_UNKNOWN');return null;}
  finally {flight.current=false;if(active())setBusy(false);}
 };
 return {pending:visiblePending,error:loaded===scope?error:null,busy,blocked,
  submit:(rows:ScheduleRow[])=>run(rows),recover:()=>run(),cancel:()=>run(undefined,true)};
}
