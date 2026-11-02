import {useEffect,useRef,useState} from 'react';
import type {OpsClient} from '@/ops/opsMutations';
import {clearTournamentEdit,loadTournamentEditContext,parseTournamentEditRequest,readTournamentEditJournal,
 recoverTournamentEdit,retainTournamentEdit,submitTournamentEdit,tournamentEditJournalKey,verifyRetainedTournamentEdit,
 TournamentEditError,type TournamentEditConfig,type TournamentEditContext,type TournamentEditRequest,type TournamentEditRpc} from '@/lib/tournamentEdit';

export type OpsEditPatch={name:string;startTime:string;buyIn:number;startingStack:number;minutesPerLevel:number;lateRegCloseLevel:number};
type Options={open:boolean;client:OpsClient;actorId:string|undefined;epoch:number;clubId:string|undefined;tourId:string|undefined;onSaved:()=>void};
type State={scope:string;loading:boolean;context:TournamentEditContext|null;pending:TournamentEditRequest|null;error:string|null};
/** Existing Ops identity and client only; all authority/expected-state checks stay on the canonical RPC. */
export function useOpsTournamentEdit(options:Options){
 const {open,client,actorId,epoch,clubId,tourId}=options;
 const identity=JSON.stringify([open,actorId,epoch,clubId,tourId]);
 const lifetime=useRef({identity,generation:0});
 if(lifetime.current.identity!==identity)lifetime.current={identity,generation:lifetime.current.generation+1};
 const scope=JSON.stringify([identity,lifetime.current.generation]),currentScope=useRef(scope);currentScope.current=scope;
 const mounted=useRef(false);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const saved=useRef(options.onSaved);saved.current=options.onSaved;
 const flight=useRef<{scope:string}|null>(null);
 const [revision,setRevision]=useState(0),[state,setState]=useState<State>({scope:'',loading:true,context:null,pending:null,error:null});
 const [busyScope,setBusyScope]=useState<string|null>(null);
 useEffect(()=>{
  if(!open||!actorId||!clubId||!tourId)return;
  let active=true;const controller=new AbortController();
  const current=()=>active&&currentScope.current===scope;
  setState({scope,loading:true,context:null,pending:null,error:null});
  try{
   const raw=localStorage.getItem(tournamentEditJournalKey(actorId,clubId,tourId));
   if(raw!==null){const pending=readTournamentEditJournal(raw,actorId,clubId,tourId);setState({scope,loading:false,context:null,pending,error:null});return;}
  }catch{setState({scope,loading:false,context:null,pending:null,error:'Không đọc được yêu cầu sửa đã lưu. Giữ dữ liệu và đối chiếu trước khi lưu thêm.'});return;}
  const rpc:TournamentEditRpc=(name,args)=>client.rpc(name as never,args as never).abortSignal(controller.signal);
  void loadTournamentEditContext(rpc,tourId,clubId,actorId)
   .then(context=>{if(current())setState({scope,loading:false,context,pending:null,error:null});})
   .catch(()=>{if(current())setState({scope,loading:false,context:null,pending:null,error:'Không xác minh được cấu hình giải. Tải lại thông tin trước khi sửa.'});})
   .finally(()=>controller.abort());
  return()=>{active=false;controller.abort();};
 },[open,client,actorId,clubId,tourId,scope,revision]);
 const value=state.scope===scope?state:null;
 const save=async(patch?:OpsEditPatch,retryOriginal=false)=>{
  if(!open||!actorId||!clubId||!tourId||!value||value.loading||flight.current?.scope===scope||(!value.pending&&!value.context))return;
  const operation={scope};flight.current=operation;setBusyScope(scope);
  const current=()=>mounted.current&&currentScope.current===scope&&flight.current===operation;
  let request=value.pending,retained=false;
  const rpc:TournamentEditRpc=(name,args)=>client.rpc(name as never,args as never);
  try{
   if(!request){
    if(!patch||!value.context)return;
    const base=value.context.state.config;
    const config:TournamentEditConfig={...base,name:patch.name,start_time:patch.startTime,buy_in:patch.buyIn,starting_stack:patch.startingStack,minutes_per_level:patch.minutesPerLevel,late_reg_close_level:patch.lateRegCloseLevel};
    request=parseTournamentEditRequest({p_tournament_id:tourId,p_club_id:clubId,p_expected_actor_id:actorId,p_request_id:crypto.randomUUID(),p_expected_state:value.context.state,p_config:config,p_levels:null},actorId,clubId,tourId);
    retainTournamentEdit(localStorage,request);retained=true;
    if(current())setState({...value,pending:request,error:null});
    await submitTournamentEdit(rpc,request);
   }else{
    retained=true;verifyRetainedTournamentEdit(localStorage,request);
    try{await recoverTournamentEdit(rpc,request);}
    catch(error){
     if(!retryOriginal)throw error;
     if(!current())return;
     verifyRetainedTournamentEdit(localStorage,request);
     await submitTournamentEdit(rpc,request);
    }
   }
   if(!current())return;
   verifyRetainedTournamentEdit(localStorage,request);clearTournamentEdit(localStorage,request);
   setState({scope,loading:false,context:null,pending:null,error:null});saved.current();
  }catch(error){
   if(!current())return;
   const known=error instanceof TournamentEditError&&!error.unknownOutcome;
   if(known&&retained&&request){
    try{clearTournamentEdit(localStorage,request);}
    catch{setState({...value,pending:request,error:'Kết quả chưa được đối chiếu với yêu cầu đã lưu. Không tạo yêu cầu mới.'});return;}
    setState({scope,loading:false,context:null,pending:null,error:'Máy chủ chưa chấp nhận thay đổi. Tải lại cấu hình trước khi sửa tiếp.'});
   }else setState({...value,pending:retained?request:value.pending,error:retained?'Chưa xác minh được lần lưu trước. Kiểm tra yêu cầu đã lưu; không tạo yêu cầu mới.':'Không lưu được yêu cầu sửa an toàn. Chưa gửi thay đổi; kiểm tra bộ nhớ trình duyệt.'});
  }finally{if(flight.current===operation){flight.current=null;if(mounted.current)setBusyScope(null);}}
 };
 return {config:value?.pending?.p_config??value?.context?.state.config??null,pending:value?.pending??null,error:value?.error??null,
  ready:!!value&&!value.loading&&!!(value.context||value.pending),loading:!value||value.loading,busy:busyScope===scope,
  formKey:JSON.stringify([scope,revision,value?.pending?.p_request_id??null]),reload:()=>setRevision(n=>n+1),save};
}
