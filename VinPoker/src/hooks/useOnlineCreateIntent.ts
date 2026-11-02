import {useEffect,useRef,useState} from 'react';
import {onlinePokerClient} from '@/lib/onlinePoker/client';
import {waitForManualPlayerResponse} from '@/lib/floorManualPlayerIntent';
import {clearOnlineCreateJournal,onlineCreateJournalKey,parseOnlineCreateJournal,readOnlineCreateJournal,saveOnlineCreateJournal,sameOnlineCreateJournal,type OnlineCreateJournal} from '@/lib/onlinePoker/createJournal';
import {parseOnlineCreateReceipt,type OnlineCreatePayload,type OnlineCreateReceipt} from '@/lib/onlinePoker/createReceipt';
const unknown='Chưa xác minh được yêu cầu tạo bàn. Giữ mã gốc và kiểm tra receipt trước khi gửi lại; chưa tạo bàn mới.';
/** Parent must remount on actor, backend and credential incarnation. No tokens stored. */
export function useOnlineCreateIntent(actorId:string,backend:string,onSettled:(receipt:OnlineCreateReceipt)=>void){
 const [pending,setPending]=useState<OnlineCreateJournal|null>(null),[blocked,setBlocked]=useState(true),[busy,setBusy]=useState(false),[message,setMessage]=useState<string|null>(null);
 const [readOnlyRecovery,setReadOnlyRecovery]=useState(false);
 const alive=useRef(false),working=useRef(false),active=useRef<OnlineCreateJournal|null>(null);
 const retain=(intent:OnlineCreateJournal|null)=>{active.current=intent;setPending(intent);};
 const refresh=()=>{try{
  if(!navigator.locks?.request)throw Error('lock unavailable');
  const current=readOnlineCreateJournal(localStorage,actorId,backend);
  if(active.current){
   const changed=!current.intent||!sameOnlineCreateJournal(current.intent,active.current);
   setReadOnlyRecovery(changed);if(changed)setMessage('Yêu cầu đã thay đổi ở tab khác. Chỉ đọc receipt của mã gốc; không ghi đè yêu cầu mới.');
  }else{retain(current.intent);setReadOnlyRecovery(false);}
  setBlocked(false);
 }catch{setBlocked(true);setMessage('Không đọc/lưu được intent tạo bàn an toàn. Chưa thể gửi yêu cầu mới.');}};
 useEffect(()=>{
  alive.current=true;refresh();
  const changed=(event:StorageEvent)=>{try{if(event.key===null||event.key===onlineCreateJournalKey(actorId,backend))refresh();}catch{refresh();}};
  window.addEventListener('storage',changed);
  return()=>{alive.current=false;window.removeEventListener('storage',changed);};
  // Scope-keyed parent drops old credential callbacks; no mutation on mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[actorId,backend]);
 const execute=async(mode:'submit'|'read'|'retry',payload?:OnlineCreatePayload)=>{
  if(!alive.current||working.current||blocked)return;
  working.current=true;setBusy(true);setMessage(null);
  try{await navigator.locks.request(onlineCreateJournalKey(actorId,backend),async()=>{
   if(!alive.current)return;
   const prior=readOnlineCreateJournal(localStorage,actorId,backend);
   let intent:OnlineCreateJournal;
   if(mode==='submit'){
    if(active.current||prior.intent){if(!active.current)retain(prior.intent);throw Error(unknown);}
    if(!payload)return;
    intent=parseOnlineCreateJournal(JSON.stringify({version:1,actorId,backend,requestId:crypto.randomUUID(),payload}),actorId,backend);
    saveOnlineCreateJournal(localStorage,intent);retain(intent);
   }else{
    const frozen=active.current??prior.intent;if(!frozen)return;intent=frozen;
    if(mode!=='read'&&(!prior.intent||!sameOnlineCreateJournal(prior.intent,intent)))throw Error(unknown);
    retain(intent);
   }
   const read=()=>waitForManualPlayerResponse(onlinePokerClient.getCreateReceipt(intent.payload,intent.requestId,actorId));
   let resolution:Awaited<ReturnType<typeof read>>|null=null;
   if(mode!=='submit'){
    resolution=await read();if(!alive.current)return;
    if(resolution.state==='missing'&&mode==='read'){setMessage('Chưa tìm thấy receipt. Đây không phải bằng chứng chưa ghi; chỉ thử lại đúng mã, không tạo mã mới.');return;}
   }
   if(mode==='submit'||resolution?.state==='missing'){
    const beforeWrite=readOnlineCreateJournal(localStorage,actorId,backend);
    if(!beforeWrite.intent||!sameOnlineCreateJournal(beforeWrite.intent,intent))throw Error(unknown);
    try{await waitForManualPlayerResponse(onlinePokerClient.createOpenTableWithRequest(intent.payload,intent.requestId,actorId));}catch{/* Unknown write: resolve by read, never a fresh key. */}
    if(!alive.current)return;
    resolution=await read();
   }
   if(!alive.current)return;
   if(resolution?.state!=='resolved')throw Error(unknown);
   const receipt=parseOnlineCreateReceipt(resolution.receipt,intent.requestId);
   const current=readOnlineCreateJournal(localStorage,actorId,backend);
   if(current.intent&&sameOnlineCreateJournal(current.intent,intent)&&current.raw)clearOnlineCreateJournal(localStorage,intent,current.raw);
   retain(null);refresh();setMessage(null);onSettled(receipt);
  });}catch{if(alive.current){refresh();setMessage(unknown);}}
  finally{working.current=false;if(alive.current)setBusy(false);}
 };
 return {pending,blocked,busy,message,readOnlyRecovery,submit:(payload:OnlineCreatePayload)=>execute('submit',payload),recover:()=>execute('read'),retry:()=>execute('retry')};
}
