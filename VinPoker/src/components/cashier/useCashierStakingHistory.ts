import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {useAuth} from '@/hooks/useAuth';
import {sessionReadEpoch} from '@/lib/sessionReadEpoch';
import {observeTrackerContextRead} from '@/lib/tournament/observeTrackerContextRead';
import {readCashierAuthority} from './useCashierClubScope';
import {toast} from 'sonner';

export type CashierHistoryRow={
 id:string;club_id:string;player_id:string|null;custom_event_name:string|null;status:string;created_at:string;filled_percent:number;
 result_prize_vnd?:number|null;buy_in_amount_vnd?:number|null;refund_reason?:string|null;refunded_at?:string|null;
 tournament?:{name:string}|null;player:{display_name:string|null}|null;
};
type Kind='history'|'refund';
export function useCashierStakingHistory(clubIds:string[],kind:Kind){
 const {user,session}=useAuth(),actorId=user?.id??null;
 const ids=[...new Set(clubIds)].sort(),idKey=JSON.stringify(ids),key=JSON.stringify([actorId,sessionReadEpoch(session),idKey,kind]);
 const currentKey=useRef(key);currentKey.current=key;
 const [revision,setRevision]=useState(0),[state,setState]=useState<{key:string;rows:CashierHistoryRow[]|null;error:string|null}>({key:'',rows:null,error:null});
 const [exportError,setExportError]=useState<string|null>(null),[exporting,setExporting]=useState(false);
 const generation=useRef(0),alive=useRef(false),readFlight=useRef<AbortController|null>(null),exportFlight=useRef<AbortController|null>(null);
 useEffect(()=>{
  alive.current=true;const epoch=++generation.current,controller=new AbortController();readFlight.current=controller;
  const current=()=>alive.current&&currentKey.current===key&&generation.current===epoch;
  setState({key,rows:null,error:null});setExportError(null);setExporting(false);
  void(async()=>{try{
   if(!actorId||!ids.length){if(current())setState({key,rows:[],error:null});return;}
   const fields=kind==='history'
    ? 'id,custom_event_name,status,created_at,result_prize_vnd,filled_percent,club_id,player_id'
    : 'id,custom_event_name,status,created_at,refund_reason,refunded_at,refunded_by,buy_in_amount_vnd,filled_percent,club_id,player_id,tournament:tournament_id(name)';
   let query=supabase.from('staking_deals').select(fields).in('club_id',ids);
   query=kind==='history'?query.in('status',['completed','cancelled']):query.eq('status','deal_refunded');
   const result=await observeTrackerContextRead(query.order(kind==='history'?'updated_at':'refunded_at',{ascending:false}).limit(500).abortSignal(controller.signal));
   if(!current())return;
   if(result.error||!Array.isArray(result.data))throw Error('unverified_history');
   const rows=result.data as unknown as CashierHistoryRow[];
   if(rows.some(row=>!row||typeof row.id!=='string'||!ids.includes(row.club_id)))throw Error('foreign_history_row');
   const players=[...new Set(rows.map(row=>row.player_id).filter((id):id is string=>typeof id==='string'))];
   let names=new Map<string,{display_name:string|null}>();
   if(players.length){
    const profiles=await observeTrackerContextRead(supabase.from('profiles').select('user_id,display_name').in('user_id',players).abortSignal(controller.signal));
    if(!current())return;if(profiles.error)throw Error('unverified_players');
    names=new Map((profiles.data??[]).map(row=>[row.user_id,{display_name:row.display_name}]));
   }
   if(current())setState({key,rows:rows.map(row=>({...row,player:row.player_id?names.get(row.player_id)??null:null})),error:null});
  }catch{if(current())setState({key,rows:[],error:'Không tải được lịch sử trong phạm vi CLB. Hãy thử lại.'});}
  finally{controller.abort();if(readFlight.current===controller)readFlight.current=null;}})();
  return()=>{alive.current=false;generation.current++;controller.abort();exportFlight.current?.abort();exportFlight.current=null;};
 // ids are canonicalized into idKey; array identity must not restart a read.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[actorId,key,idKey,kind,revision]);
 const reload=useCallback(()=>{generation.current++;readFlight.current?.abort();exportFlight.current?.abort();exportFlight.current=null;setState({key,rows:null,error:null});setRevision(value=>value+1);},[key]);
 const exportRows=async(rows:CashierHistoryRow[],deliver:(allowed:CashierHistoryRow[])=>void)=>{
  if(!actorId||exportFlight.current||currentKey.current!==key||state.key!==key||state.rows===null||state.error)return;
  const epoch=generation.current,controller=new AbortController();exportFlight.current=controller;setExporting(true);setExportError(null);
  const current=()=>alive.current&&currentKey.current===key&&generation.current===epoch&&exportFlight.current===controller;
  const snapshot=[...rows];
  try{
   const authority=await readCashierAuthority(actorId,controller.signal);
   if(!current())return;
   const allowed=snapshot.filter(row=>ids.includes(row.club_id)&&authority.clubIds.includes(row.club_id));
   if(!allowed.length)throw Error('export_scope_revoked');
   if(allowed.length!==snapshot.length)toast.warning('Một số CLB đã đổi quyền. Chỉ xuất các dòng còn được phép.');
   // No async work between the final context check and synchronous file delivery.
   if(current())deliver(allowed);
  }catch{if(current())setExportError('Chưa xác minh được quyền xuất dữ liệu. Không tải tệp; hãy thử lại.');}
  finally{controller.abort();if(exportFlight.current===controller){exportFlight.current=null;if(alive.current&&currentKey.current===key)setExporting(false);}}
 };
 const visible=state.key===key?state:{rows:null,error:null};
 return {rows:visible.rows,error:visible.error,reload,exportRows,exporting,exportError};
}

