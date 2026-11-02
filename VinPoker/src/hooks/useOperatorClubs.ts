import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {observeTrackerContextRead} from '@/lib/tournament/observeTrackerContextRead';
import {sessionReadEpoch} from '@/lib/sessionReadEpoch';

export type OperatorClubRow = { id: string; name: string };
export type FloorOperatorScopeRow = {
  club_id: string;
  can_owner: boolean;
  can_cashier: boolean;
  can_floor: boolean;
};

/**
 * Caller-bound Floor/Cashier scope. The RPC derives every capability from
 * auth.uid(), clubs.owner_id, club_cashiers, and club_floors.
 */
export function useOperatorClubs() {
  const { user, session, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const [clubs, setClubs] = useState<OperatorClubRow[] | null>(null);
  const [cashierClubIds, setCashierClubIds] = useState<string[]>([]);
  const [floorClubIds, setFloorClubIds] = useState<string[]>([]);
  const [dealerClubIds, setDealerClubIds] = useState<string[]>([]);
  const [scope, setScope] = useState<FloorOperatorScopeRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nonce,setNonce]=useState(0);
  const [loadedKey,setLoadedKey]=useState<string|null>(null);
  const [verified,setVerified]=useState(false);
  const key=JSON.stringify([userId,sessionReadEpoch(session),nonce]);

  useEffect(() => {
    if (!userId) {
      setLoadedKey(null);setVerified(false);
      setClubs(authLoading ? null : []);
      setCashierClubIds([]);
      setFloorClubIds([]);
      setDealerClubIds([]);
      setScope([]);
      setError(null);
      return;
    }

    let cancelled = false;
    const controller=new AbortController();
    setVerified(false);
    setClubs(null);
    setCashierClubIds([]);
    setFloorClubIds([]);
    setDealerClubIds([]);
    setScope([]);
    setError(null);

    void (async () => {
      try {
        const result=await observeTrackerContextRead((async()=>{
          const [scopeResult,dealerResult]=await Promise.all([
            supabase.rpc("get_my_floor_operator_scope").abortSignal(controller.signal),
            supabase.rpc("dealer_control_club_ids",{_user_id:userId}).abortSignal(controller.signal),
          ]);
          if(controller.signal.aborted)throw new Error('operator_scope_read_cancelled');
          if(scopeResult.error||dealerResult.error)throw new Error('Không tải được phạm vi CLB. Vui lòng thử lại.');
          if(!Array.isArray(scopeResult.data)||!Array.isArray(dealerResult.data)
            ||!scopeResult.data.every(row=>row&&typeof row.club_id==='string'&&row.club_id.length>0&&['can_owner','can_cashier','can_floor'].every(field=>typeof row[field as keyof typeof row]==='boolean'))
            ||!dealerResult.data.every(id=>typeof id==='string'&&id.length>0))throw new Error('Dữ liệu phạm vi CLB không hợp lệ. Vui lòng thử lại.');
          const nextScope=scopeResult.data as FloorOperatorScopeRow[],dealerIds=dealerResult.data as string[];
          const ids=Array.from(new Set([...nextScope.map(row=>row.club_id),...dealerIds]));
          if(!ids.length)return {nextScope,dealerIds,clubs:[] as OperatorClubRow[],metadataError:null};
          const names=await supabase.from('clubs').select('id,name').in('id',ids).abortSignal(controller.signal);
          return {nextScope,dealerIds,clubs:(names.data??[]) as OperatorClubRow[],metadataError:names.error?'Không tải được tên CLB. Vui lòng thử lại.':null};
        })());
        if(cancelled)return;
        setScope(result.nextScope);
        setCashierClubIds(result.nextScope.filter(row=>row.can_owner||row.can_cashier).map(row=>row.club_id));
        setFloorClubIds(result.nextScope.filter(row=>row.can_owner||row.can_floor).map(row=>row.club_id));
        setDealerClubIds(result.dealerIds);setClubs(result.clubs);setError(result.metadataError);setVerified(true);setLoadedKey(key);
      } catch(caught) {
        if(cancelled)return;
        controller.abort();setClubs([]);setScope([]);setCashierClubIds([]);setFloorClubIds([]);setDealerClubIds([]);setVerified(false);setLoadedKey(key);
        setError(caught instanceof Error&&caught.message==='tracker_context_read_timeout'
          ?'Hết thời gian tải phạm vi CLB. Vui lòng thử lại.':caught instanceof Error?caught.message:'Không tải được phạm vi CLB. Vui lòng thử lại.');
      }
    })();

    return () => { cancelled = true;controller.abort(); };
  // Equivalent User objects do not invalidate scope. A new credential incarnation
  // does require a fresh server read; never expose the previous incarnation's roles.
  }, [userId, authLoading,key]);

  const current=!!userId&&!authLoading&&loadedKey===key;
  const visibleClubs=current?clubs:userId||authLoading?null:[];
  const visibleScope=current?scope:[];
  const clubIds = (visibleClubs ?? []).map((club) => club.id);
  const operatorClubIds = visibleScope.map((row) => row.club_id);
  const hasOpsAccess = visibleScope.some((row) => row.can_owner || row.can_cashier || row.can_floor);
  const hasCashierAccess = visibleScope.some((row) => row.can_owner || row.can_cashier);
  const hasOwnerAccess = visibleScope.some((row) => row.can_owner);

  return {
    loading: authLoading || visibleClubs === null,
    user,
    clubs:visibleClubs,
    clubIds,
    operatorClubIds,
    cashierClubIds:current?cashierClubIds:[],
    floorClubIds:current?floorClubIds:[],
    dealerClubIds:current?dealerClubIds:[],
    scope:visibleScope,
    hasOpsAccess,
    hasCashierAccess,
    hasOwnerAccess,
    error:current?error:null,
    scopeVerified:current&&verified,
    refresh:()=>setNonce(value=>value+1),
  };
}
