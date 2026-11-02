import {useEffect,useRef,useState} from 'react';
import {canonicalVoiceJson} from '@/lib/trackerVoice/canonicalRequest';
import {dealerFeatureBackend,dealerFeatureJournalKey,readDealerFeatureJournal,retainDealerFeatureIntent,
 settleDealerFeatureIntent,matchDealerFeatureReceipt,resolveDealerFeatureReceipt,type DealerFeatureDraft,type DealerFeatureIntent} from '@/lib/dealerFeatureProfileIntent';
import {cancelProfileSave,loadFeatureTableProfile,readProfileSaveReceipt,saveProfileToDb,type FeatureTableProfile} from './featureTableMock';

const unknown='Chưa xác minh được kết quả lưu. Giữ mã yêu cầu, kiểm tra receipt trước khi gửi lại; không tạo mã mới.';
/** The parent remounts for actor/backend/credential/club/table. Never writes on mount. */
export function useFeatureProfileSave(actorId:string|null,clubId:string,tableId:string,
 onLoaded:(profile:FeatureTableProfile)=>void,onSaved:(status:'saved'|'cancelled')=>void){
 const [pending,setPending]=useState<DealerFeatureIntent|null>(null),[blocked,setBlocked]=useState(true),[busy,setBusy]=useState(false);
 const [message,setMessage]=useState<string|null>(null),[readOnly,setReadOnly]=useState(false);
 const alive=useRef(false),working=useRef(false),active=useRef<DealerFeatureIntent|null>(null);
 const callbacks=useRef({onLoaded,onSaved});callbacks.current={onLoaded,onSaved};
 let backend='';try{backend=dealerFeatureBackend(import.meta.env.VITE_SUPABASE_URL);}catch{/* Invalid endpoint disables writes. */}
 const scope={actorId:actorId??'',clubId,tableId,backend};
 const retain=(intent:DealerFeatureIntent|null)=>{active.current=intent;setPending(intent);};
 const refreshJournal=()=>{
  if(!actorId||!backend||!navigator.locks?.request)throw Error('DEALER_PROFILE_CONTEXT_UNAVAILABLE');
  const journal=readDealerFeatureJournal(localStorage,scope),current=journal?.state==='pending'?journal.intent:null;
  if(active.current){setReadOnly(!current||canonicalVoiceJson(current)!==canonicalVoiceJson(active.current));}
  else {retain(current);setReadOnly(false);}
  return current;
 };
 const load=async()=>{
  if(!alive.current||working.current)return;
  working.current=true;setBusy(true);setBlocked(true);setMessage(null);
  try{
   const prior=refreshJournal();
   if(prior){callbacks.current.onLoaded({tableMode:prior.profile.tableMode,isFinal:prior.profile.isFinal,allowOverride:prior.profile.allowOverride,pool:prior.profile.pool.map(m=>({dealerId:m.dealerId,isPrimary:m.isPrimary,name:m.dealerId}))});setMessage(unknown);}
   else {
    const profile=await loadFeatureTableProfile(clubId,tableId,()=>alive.current);
    if(!alive.current)return;callbacks.current.onLoaded(profile);
   }
   if(alive.current)setBlocked(false);
  }catch{if(alive.current){setBlocked(true);setMessage('Không xác minh được cấu hình hoặc journal an toàn. Chưa thể lưu thay đổi.');}}
  finally{working.current=false;if(alive.current)setBusy(false);}
 };
 useEffect(()=>{
  alive.current=true;void load();
  const changed=(event:StorageEvent)=>{
   if(event.key!==null&&event.key!==dealerFeatureJournalKey(scope))return;
   try{const prior=refreshJournal();if(prior)setMessage(unknown);}catch{setBlocked(true);setMessage(unknown);}
  };
  window.addEventListener('storage',changed);
  return()=>{alive.current=false;window.removeEventListener('storage',changed);};
  // Scope-keyed parent invalidates old credentials; callbacks live in a ref.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[actorId,clubId,tableId,backend]);
 const execute=async(mode:'submit'|'read'|'retry'|'cancel',draft?:DealerFeatureDraft)=>{
  if(!alive.current||working.current||blocked)return;
  working.current=true;setBusy(true);setMessage(null);
  try{await navigator.locks.request(dealerFeatureJournalKey(scope),async()=>{
   if(!alive.current)return;
   const journal=readDealerFeatureJournal(localStorage,scope);
   let intent:DealerFeatureIntent;
   if(mode==='submit'){
    if(active.current||journal?.state==='pending'){if(!active.current&&journal)retain(journal.intent);throw Error(unknown);}
    if(!draft)return;intent=retainDealerFeatureIntent(localStorage,scope,draft);retain(intent);
   }else{
    const frozen=active.current??(journal?.state==='pending'?journal.intent:null);if(!frozen)return;intent=frozen;
    if((mode==='retry'||mode==='cancel')&&(journal?.state!=='pending'||canonicalVoiceJson(journal.intent)!==canonicalVoiceJson(intent)))throw Error(unknown);
   }
   let receipt:unknown;
   if(mode==='read'||mode==='retry'){
    const packet=await readProfileSaveReceipt(intent);if(!alive.current)return;
    const resolution=resolveDealerFeatureReceipt(packet,intent);
    if(resolution.status==='missing'){
     if(mode==='read'){setMessage('Chưa tìm thấy receipt; chưa thể kết luận chưa ghi. Chỉ thử lại đúng mã yêu cầu.');return;}
    }else{
     receipt=resolution.receipt;
    }
   }
   if(receipt===undefined){
    const latest=readDealerFeatureJournal(localStorage,scope);
    if(!latest||latest.state!=='pending'||canonicalVoiceJson(latest.intent)!==canonicalVoiceJson(intent)||!alive.current)throw Error(unknown);
    receipt=await (mode==='cancel'?cancelProfileSave(intent):saveProfileToDb(intent));if(!alive.current)return;
   }
   const result=matchDealerFeatureReceipt(receipt,intent);
   const current=readDealerFeatureJournal(localStorage,scope);
   if(current&&canonicalVoiceJson(current.intent)===canonicalVoiceJson(intent))settleDealerFeatureIntent(localStorage,intent,receipt);
   // Refresh current server state, not the potentially superseded saved snapshot.
   await loadFeatureTableProfile(clubId,tableId,()=>alive.current);if(!alive.current)return;
   retain(null);setMessage(null);callbacks.current.onSaved(result.status);
  });}catch{if(alive.current){try{refreshJournal();}catch{setBlocked(true);}setMessage(unknown);}}
  finally{working.current=false;if(alive.current)setBusy(false);}
 };
 return {pending,blocked,busy,message,readOnly,load,submit:(draft:DealerFeatureDraft)=>execute('submit',draft),recover:()=>execute('read'),retry:()=>execute('retry'),cancel:()=>execute('cancel')};
}
