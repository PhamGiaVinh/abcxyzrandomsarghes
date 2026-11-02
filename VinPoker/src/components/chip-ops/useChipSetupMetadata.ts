import {useEffect,useRef,useState} from 'react';
import {toast} from 'sonner';
import {supabase} from '@/integrations/supabase/client';
import {observeTrackerContextRead} from '@/lib/tournament/observeTrackerContextRead';
import {waitForManualPlayerResponse} from '@/lib/floorManualPlayerIntent';
import type {AcquireChipSetupWrite} from '@/lib/chipSetupWriteGate';
import {chipSetupMetadataArgs,clearChipSetupMetadataIntent,parseChipSetupMetadataReceipt,persistChipSetupMetadataIntent,readChipSetupMetadataIntent,
 type ChipSetupMetadataIntent,type ChipSetupMetadataPayload,type ChipSetupMetadataReceipt,type ChipSetupMetadataScope} from '@/lib/chipSetupMetadataIntent';

type Options={scope:ChipSetupMetadataScope|null;busy:boolean;acquireWrite:AcquireChipSetupWrite;onPendingChange:(pending:boolean)=>void;onResolved:(receipt:ChipSetupMetadataReceipt)=>void};
type State={key:string;ready:boolean;pending:ChipSetupMetadataIntent|null;error:string|null;working:boolean};
const unknownOutcome='Chưa xác minh được thay đổi bộ chip. Giữ nguyên yêu cầu và đối chiếu trước khi thao tác mới.';
const storageFailure='Không đọc/lưu được yêu cầu hoặc dữ liệu chưa hợp lệ. Chưa gửi lệnh mới; hãy kiểm tra và đọc lại.';
const sdk=supabase as unknown as {rpc:(name:string,args:ReturnType<typeof chipSetupMetadataArgs>)=>PromiseLike<{data:unknown;error:unknown}>};

export function useChipSetupMetadata({scope,busy,acquireWrite,onPendingChange,onResolved}:Options){
 const scopeKey=JSON.stringify(scope),current=useRef({key:scopeKey}),alive=useRef(false),flight=useRef<{release:()=>void}|null>(null);
 if(current.current.key!==scopeKey)current.current={key:scopeKey};
 const callbacks=useRef({busy,acquireWrite,onPendingChange,onResolved});callbacks.current={busy,acquireWrite,onPendingChange,onResolved};
 const [state,setState]=useState<State>({key:scopeKey,ready:false,pending:null,error:null,working:false});
 const visible=state.key===scopeKey?state:{key:scopeKey,ready:false,pending:null,error:null,working:false};
 const isCurrent=(token:object)=>alive.current&&current.current===token;
 const update=(token:object,pending:ChipSetupMetadataIntent|null,error:string|null,working=false)=>{
  if(!isCurrent(token))return;setState({key:scopeKey,ready:true,pending,error,working});callbacks.current.onPendingChange(!!pending||!!error);
 };
 const execute=async(mode:'apply'|'lookup'|'cancel',token:object,retained?:ChipSetupMetadataIntent,payload?:ChipSetupMetadataPayload)=>{
  if(!scope||!isCurrent(token)||flight.current||callbacks.current.busy)return;
  const release=callbacks.current.acquireWrite();if(!release)return;
  const owned={release};flight.current=owned;let intent=retained;
  try{
   intent??=persistChipSetupMetadataIntent(window.sessionStorage,scope,payload!);
   update(token,intent,null,true);
   const request=Promise.resolve(sdk.rpc(mode==='apply'?'chip_ops_apply_setup_metadata_v1':mode==='lookup'?'get_chip_setup_metadata_receipt_v1':'cancel_chip_setup_metadata_v1',chipSetupMetadataArgs(intent)));
   const {data,error}=await(mode==='lookup'?observeTrackerContextRead(request):waitForManualPlayerResponse(request));
   if(!isCurrent(token))return;if(error)throw error;
   if(mode==='lookup'&&data===null){update(token,intent,unknownOutcome);return;}
   const receipt=parseChipSetupMetadataReceipt(data,intent);
   clearChipSetupMetadataIntent(window.sessionStorage,intent,receipt);update(token,null,null);callbacks.current.onResolved(receipt);
  }catch{
   if(isCurrent(token)){const error=intent?unknownOutcome:storageFailure;update(token,intent??null,error);toast.error(error);}
  }finally{
   if(flight.current===owned)flight.current=null;owned.release();
   if(isCurrent(token))setState(old=>old.key===scopeKey?{...old,working:false}:old);
  }
 };
 const hydrate=()=>{
  const token=current.current;if(!scope||!isCurrent(token)||flight.current)return;
  try{const pending=readChipSetupMetadataIntent(window.sessionStorage,scope);update(token,pending,null);if(pending)void execute('lookup',token,pending);}
  catch{update(token,null,storageFailure);}
 };
 const hydrateRef=useRef(hydrate);hydrateRef.current=hydrate;
 useEffect(()=>{
  alive.current=true;hydrateRef.current();const captured=callbacks.current;
  return()=>{alive.current=false;current.current={key:current.current.key};const owned=flight.current;flight.current=null;owned?.release();captured.onPendingChange(false);};
 },[scopeKey]);
 return {...visible,blocked:!visible.ready||!!visible.pending||!!visible.error,
  submit:(payload:ChipSetupMetadataPayload)=>{if(visible.ready&&!visible.pending&&!visible.error)void execute('apply',current.current,undefined,payload);},
  lookup:()=>{if(visible.pending)void execute('lookup',current.current,visible.pending);},
  retry:()=>{if(visible.pending)void execute('apply',current.current,visible.pending);},
  cancel:()=>{if(visible.pending)void execute('cancel',current.current,visible.pending);},readAgain:hydrate};
}
