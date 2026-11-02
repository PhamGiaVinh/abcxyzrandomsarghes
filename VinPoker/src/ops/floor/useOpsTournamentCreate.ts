import {useEffect,useRef,useState} from 'react';
import type {OpsClient} from '@/ops/opsMutations';
import type {OpsEditPatch} from './useOpsTournamentEdit';
import {createTournament,recoverTournamentCreate,readTournamentCreateJournal,tournamentCreateJournalKey,TournamentCreateError,type TournamentCreateRequest} from '@/lib/tournamentCreate';
type Options={open:boolean;client:OpsClient;actorId:string|undefined;clubId:string|undefined;epoch:number;onCreated:()=>void};
type State={scope:string;ready:boolean;pending:TournamentCreateRequest|null;error:string|null};
const rejectedInput=new Set(['invalid_create_request','unsupported_create_field','invalid_blind_levels','unsupported_blind_field','required_create_fields_missing','invalid_create_money','invalid_initial_lifecycle']);
export function useOpsTournamentCreate({open,client,actorId,clubId,epoch,onCreated}:Options){
 const identity=JSON.stringify([open,actorId,clubId,epoch]),lifetime=useRef({identity,generation:0});
 if(lifetime.current.identity!==identity)lifetime.current={identity,generation:lifetime.current.generation+1};
 const scope=JSON.stringify([identity,lifetime.current.generation]),scopeRef=useRef(scope);scopeRef.current=scope;
 const mounted=useRef(false);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const done=useRef(onCreated);done.current=onCreated;
 const flight=useRef<object|null>(null),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
 const [state,setState]=useState<State>({scope:'',ready:false,pending:null,error:null});
 useEffect(()=>{
  if(!open||!actorId||!clubId||!epoch)return;
  try{const raw=localStorage.getItem(tournamentCreateJournalKey(actorId,clubId));setState({scope,ready:true,pending:raw===null?null:readTournamentCreateJournal(raw,actorId,clubId),error:null});}
  catch{setState({scope,ready:false,pending:null,error:'Không đọc được yêu cầu tạo đã lưu. Giữ dữ liệu và đối chiếu trước khi tạo thêm.'});}
 },[open,actorId,clubId,epoch,scope,revision]);
 const value=state.scope===scope?state:null;
 const save=async(patch?:OpsEditPatch,retryOriginal=false)=>{
  if(!open||!actorId||!clubId||!epoch||!value?.ready||flight.current)return;
  const operation={};flight.current=operation;setBusy(true);
  const current=()=>mounted.current&&scopeRef.current===scope&&flight.current===operation;
  const key=tournamentCreateJournalKey(actorId,clubId);
  let request=value.pending,retained=!!request;
  const verify=(expected:TournamentCreateRequest)=>{
   const raw=localStorage.getItem(key);if(raw===null||JSON.stringify(readTournamentCreateJournal(raw,actorId,clubId))!==JSON.stringify(expected))throw new TournamentCreateError('Pending create request changed',true);
  };
  const rpc=(name:string,args:Record<string,unknown>)=>client.rpc(name as never,args as never);
  try{
   if(!request){
    if(!patch)return;
    if(localStorage.getItem(key)!==null)throw new TournamentCreateError('Pending create request changed',true);
    request={p_club_id:clubId,p_expected_actor_id:actorId,p_request_id:crypto.randomUUID(),p_levels:[],p_config:{name:patch.name,start_time:patch.startTime,buy_in:patch.buyIn,rake_amount:0,service_fee_amount:0,starting_stack:patch.startingStack,game_type:'nlh',minutes_per_level:patch.minutesPerLevel,late_reg_close_level:patch.lateRegCloseLevel,status:'upcoming',current_level:1}};
    localStorage.setItem(key,JSON.stringify(request));retained=true;verify(request);
    if(current())setState({scope,ready:true,pending:request,error:null});
    await createTournament(rpc,request);
   }else{
    verify(request);
    try{await recoverTournamentCreate(rpc,request);}
    catch(error){if(!retryOriginal)throw error;if(!current())return;verify(request);await createTournament(rpc,request);}
   }
   if(!current())return;
   verify(request);localStorage.removeItem(key);if(localStorage.getItem(key)!==null)throw new TournamentCreateError('Pending create cleanup unverified',true);
   setState({scope,ready:true,pending:null,error:null});done.current();
  }catch(error){
   if(!current())return;
   // A failed retry cannot disprove an earlier commit of the retained request.
   if(!value.pending&&request&&retained&&error instanceof TournamentCreateError&&!error.unknownOutcome&&rejectedInput.has(error.message)){
    try{verify(request);localStorage.removeItem(key);if(localStorage.getItem(key)!==null)throw Error('cleanup unverified');setState({scope,ready:true,pending:null,error:'Máy chủ chưa chấp nhận dữ liệu tạo giải. Kiểm tra thông tin trước khi tạo tiếp.'});}
    catch{setState({scope,ready:true,pending:request,error:'Không đối chiếu được yêu cầu tạo đã lưu. Không tạo yêu cầu mới.'});}
   }else setState({scope,ready:true,pending:retained?request:value.pending,error:retained?'Chưa xác minh được lần tạo trước. Kiểm tra yêu cầu đã lưu; không tạo yêu cầu mới.':'Không lưu được yêu cầu tạo an toàn. Chưa gửi thay đổi; kiểm tra bộ nhớ trình duyệt.'});
  }finally{if(flight.current===operation){flight.current=null;if(mounted.current)setBusy(false);}}
 };
 return {ready:!!value?.ready,loading:!value?.ready,pending:value?.pending??null,config:value?.pending?.p_config??null,error:value?.error??null,busy,formKey:JSON.stringify([scope,revision,value?.pending?.p_request_id??null]),reload:()=>setRevision(n=>n+1),save};
}
