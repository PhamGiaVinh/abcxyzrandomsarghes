import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {parseOpsCapabilityScope,parseOpsGlobalCapability} from '@/ops/auth/opsCapabilityContract';
import {observeTrackerContextRead} from '@/lib/tournament/observeTrackerContextRead';

type Club={id:string;name:string};
type Scope={clubs:Club[];dealerClubIds:string[];payrollClubIds:string[];isAdmin:boolean};
const scopeError='Không tải được quyền điều hành dealer. Kiểm tra kết nối rồi thử lại.';
const metadataError='Đã xác nhận quyền nhưng không tải được danh sách CLB. Vui lòng thử lại.';

/** Same current-authority pattern as the cashier root; only this module opts in. */
export function useDealerControlClubScope(actorId:string|null,sessionEpoch:number,enabled:boolean){
 const key=JSON.stringify([actorId,sessionEpoch]);
 const [state,setState]=useState<{key:string;scope:Scope|null;error:string|null}>({key:'',scope:null,error:null});
 const retry=useRef<(()=>void)|null>(null);
 const refresh=useCallback(()=>retry.current?.(),[]);
 useEffect(()=>{
  if(!enabled||!actorId){retry.current=null;setState({key:'',scope:null,error:null});return;}
  let alive=true,running=false,controller:AbortController|null=null,timer:number|undefined;
  const check=async()=>{
   if(!alive||running)return;
   running=true;const current=new AbortController();controller=current;
   try{
    const scope=await observeTrackerContextRead((async()=>{
     const [membership,global]=await Promise.all([
      supabase.rpc('get_my_ops_capability_scope' as never).abortSignal(current.signal),
      supabase.rpc('get_my_ops_global_capability' as never).abortSignal(current.signal),
     ]);
     if(membership.error||global.error)throw Error(scopeError);
     const rows=parseOpsCapabilityScope(membership.data),isAdmin=parseOpsGlobalCapability(global.data).is_super_admin;
     let dealerClubIds=rows.filter(r=>r.can_owner||r.can_dealer_control).map(r=>r.club_id).sort();
     // Payroll here belongs to the Dealer Swing workspace. Unrelated Cashier B
     // authority remains usable from B's own module, never as payroll A.
     let payrollClubIds=rows.filter(r=>dealerClubIds.includes(r.club_id)
      &&(r.can_owner||r.can_cashier||r.can_accountant)).map(r=>r.club_id).sort();
     if(isAdmin){
      // The global DTO deliberately does not enumerate all clubs. Preserve the
      // existing caller's server-authorized superadmin membership reader.
      const all=await supabase.rpc('dealer_control_club_ids',{_user_id:actorId}).abortSignal(current.signal);
      if(all.error||!Array.isArray(all.data)||!all.data.every(id=>typeof id==='string'&&id.length>0)
       ||new Set(all.data).size!==all.data.length)throw Error(scopeError);
      dealerClubIds=[...all.data].sort();payrollClubIds=[...dealerClubIds];
     }
     if(!alive||current.signal.aborted)throw Error(scopeError);
     setState(old=>old.key===key&&old.scope&&(old.scope.isAdmin!==isAdmin
      ||JSON.stringify(old.scope.dealerClubIds)!==JSON.stringify(dealerClubIds)
      ||JSON.stringify(old.scope.payrollClubIds)!==JSON.stringify(payrollClubIds))?{key,scope:null,error:null}:old);
     const ids=Array.from(new Set([...dealerClubIds,...payrollClubIds])).sort();let clubs:Club[]=[];
     if(ids.length){
      const result=await supabase.from('clubs').select('id,name').in('id',ids).abortSignal(current.signal);
      if(result.error||!Array.isArray(result.data)||result.data.length!==ids.length
       ||new Set(result.data.map(c=>c.id)).size!==ids.length
       ||result.data.some(c=>!ids.includes(c.id)||typeof c.name!=='string'))throw Error(metadataError);
      clubs=result.data.map(c=>({id:c.id,name:c.name})).sort((a,b)=>a.id.localeCompare(b.id));
     }
     return {clubs,dealerClubIds,payrollClubIds,isAdmin};
    })());
    if(alive&&!current.signal.aborted)setState(old=>old.key===key&&!old.error&&JSON.stringify(old.scope)===JSON.stringify(scope)?old:{key,scope,error:null});
   }catch(error){
    if(alive)setState({key,scope:null,error:error instanceof Error&&[scopeError,metadataError].includes(error.message)?error.message:scopeError});
   }finally{current.abort();if(controller===current)controller=null;running=false;
    if(alive)timer=window.setTimeout(()=>void check(),2000);
   }
  };
  retry.current=()=>{if(!running){window.clearTimeout(timer);void check();}};void check();
  return()=>{alive=false;window.clearTimeout(timer);controller?.abort();retry.current=null;};
 },[actorId,enabled,key]);
 const current=enabled&&state.key===key?state:{scope:null,error:null};
 return {clubs:current.scope?.clubs??null,dealerClubIds:current.scope?.dealerClubIds??[],
  payrollClubIds:current.scope?.payrollClubIds??[],isAdmin:current.scope?.isAdmin??false,
  scopeVerified:!!current.scope,error:current.error,refresh};
}
