import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {parseOpsGlobalCapability} from '@/ops/auth/opsCapabilityContract';
import {observeTrackerContextRead} from '@/lib/tournament/observeTrackerContextRead';

export type CashierAuthority={clubIds:string[];isAdmin:boolean};
type CashierClub={id:string;name:string};
type Scope=CashierAuthority&{clubs:CashierClub[];ownerClubIds:string[]};
const scopeError='Không tải được quyền truy cập CLB. Kiểm tra kết nối rồi thử lại.';
const metadataError='Đã xác nhận quyền CLB nhưng không tải được danh sách. Vui lòng thử lại.';

/** Caller-bound current authority; never use cached Auth roles as export authority. */
export async function readCashierAuthority(actorId:string,signal:AbortSignal):Promise<CashierAuthority>{
 const [membership,global]=await observeTrackerContextRead(Promise.all([
  supabase.rpc('cashier_club_ids',{_user_id:actorId}).abortSignal(signal),
  supabase.rpc('get_my_ops_global_capability' as never).abortSignal(signal),
 ]));
 if(membership.error||global.error||!Array.isArray(membership.data)||
  !membership.data.every(id=>typeof id==='string'&&id.length>0)||new Set(membership.data).size!==membership.data.length)throw Error(scopeError);
 let isAdmin:boolean;try{isAdmin=parseOpsGlobalCapability(global.data).is_super_admin;}catch{throw Error(scopeError);}
 return {clubIds:[...membership.data].sort(),isAdmin};
}

export function useCashierClubScope(actorId:string|null,sessionEpoch:number,enabled:boolean){
 const key=JSON.stringify([actorId,sessionEpoch]);
 const [state,setState]=useState<{key:string;scope:Scope|null;error:string|null}>({key:'',scope:null,error:null});
 const retry=useRef<(()=>void)|null>(null);
 const refresh=useCallback(()=>retry.current?.(),[]);
 useEffect(()=>{
  if(!enabled||!actorId){retry.current=null;setState({key:'',scope:null,error:null});return;}
  let alive=true,running=false,controller:AbortController|null=null;
  const check=async()=>{
   if(!alive||running)return;
   running=true;const current=new AbortController();controller=current;
   try{
    const authority=await readCashierAuthority(actorId,current.signal);
    if(!alive)return;
    // A newly known permission boundary invalidates the old workspace before
    // optional club labels/ownership finish loading.
    setState(old=>old.key===key&&old.scope&&(old.scope.isAdmin!==authority.isAdmin||
      JSON.stringify(old.scope.clubIds)!==JSON.stringify(authority.clubIds))?{key,scope:null,error:null}:old);
    let clubs:CashierClub[]=[],ownerClubIds:string[]=[];
    if(authority.clubIds.length){
     const result=await observeTrackerContextRead(supabase.from('clubs').select('id,name,owner_id').in('id',authority.clubIds).abortSignal(current.signal));
     if(!alive)return;
     if(result.error||!Array.isArray(result.data)||result.data.length!==authority.clubIds.length||
       new Set(result.data.map(row=>row.id)).size!==authority.clubIds.length||
       result.data.some(row=>!authority.clubIds.includes(row.id)||typeof row.name!=='string'||
        (row.owner_id!==null&&typeof row.owner_id!=='string')))throw Error(metadataError);
     clubs=result.data.map(row=>({id:row.id,name:row.name})).sort((a,b)=>a.id.localeCompare(b.id));
     ownerClubIds=result.data.filter(row=>row.owner_id===actorId).map(row=>row.id).sort();
    }
    const scope={...authority,clubs,ownerClubIds};
    setState(old=>old.key===key&&!old.error&&JSON.stringify(old.scope)===JSON.stringify(scope)?old:{key,scope,error:null});
   }catch(error){
    if(alive)setState({key,scope:null,error:error instanceof Error&&[scopeError,metadataError].includes(error.message)
      ?error.message:'Không kết nối được để xác minh quyền CLB. Kiểm tra mạng rồi thử lại.'});
   }finally{current.abort();if(controller===current)controller=null;running=false;}
  };
  retry.current=()=>void check();void check();
  const timer=window.setInterval(()=>void check(),5000);
  return()=>{alive=false;window.clearInterval(timer);controller?.abort();retry.current=null;};
 },[actorId,enabled,key]);
 const current=enabled&&state.key===key?state:{scope:null,error:null};
 return {clubs:current.scope?.clubs??null,ownerClubIds:current.scope?.ownerClubIds??[],isAdmin:current.scope?.isAdmin??false,error:current.error,refresh};
}
