import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {describe,expect,it,vi} from 'vitest';
import {trackerUndoReceiptMatches} from '../../src/lib/trackerUndoReceipt';

const actor='675fe35e-60a8-4452-bb90-e79486d54da6';
const context={table_session_id:'ee2b9393-0c96-42f9-8667-7f306edeb9bc',tournament_table_id:'d294f4a4-082b-4efc-a6ca-1f96579ea344',control_epoch:4};
async function invoke(extra:Record<string,unknown>,rpcData:unknown={status:'success',hand_id:'11111111-1111-4111-8111-111111111111'}){
 let handler!:(request:Request)=>Promise<Response>;
 const rpc=vi.fn(async()=>({data:rpcData,error:null}));
 const source=readFileSync('supabase/functions/tournament-live-update/index.ts','utf8')
  .replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,'');
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  Request,Response,trackerUndoReceiptMatches,console:{log:vi.fn(),error:vi.fn(),warn:vi.fn()},
  createClient:()=>({auth:{getUser:async()=>({data:{user:{id:actor}},error:null})},rpc}),
  Deno:{env:{get:(key:string)=>({SUPABASE_URL:'http://local.invalid',SUPABASE_ANON_KEY:'LOCAL_TEST',TRACKER_VALIDATION_MODE:'warn'})[key]},
   serve:(fn:typeof handler)=>{handler=fn;}},
 });
 const response=await handler(new Request('http://local.invalid/tracker',{method:'POST',headers:{authorization:'Bearer LOCAL_TEST'},
  body:JSON.stringify({action:'start_hand',tournament_id:'46cab483-91e7-4220-aacf-e17bdf05269c',table_id:context.tournament_table_id,
   hand_number:20,button_seat:1,hand_time:'2026-10-20T00:00:00Z',...extra})}));
 return {status:response.status,body:await response.json(),rpc};
}
describe('actual Tracker Edge start requires exact session and epoch',()=>{
 it.each([{}, {table_session_id:context.table_session_id}, {tournament_table_id:context.tournament_table_id},
  {...context,table_session_id:null},{...context,control_epoch:0},{...context,control_epoch:1.5}])('rejects missing/partial/malformed context %j before any writer',async(extra)=>{
  const r=await invoke(extra);expect(r.status).toBe(422);expect(r.body.code).toBe('INVALID_TRACKER_CONTEXT');expect(r.rpc).not.toHaveBeenCalled();
 });
 it('forwards a complete context only to canonical v3 without inferring current session',async()=>{
  const r=await invoke(context);expect(r.status).toBe(200);
  expect(r.rpc).toHaveBeenCalledExactlyOnceWith('start_tracker_hand_v3',{
   p_tournament_id:'46cab483-91e7-4220-aacf-e17bdf05269c',p_tournament_table_id:context.tournament_table_id,
   p_table_session_id:context.table_session_id,p_control_epoch:4,p_hand_number:20,p_button_seat:1,
   p_hand_time:'2026-10-20T00:00:00Z',p_created_by:actor});
 });
});

const undo={action:'undo_last_action_v1',tournament_table_id:context.tournament_table_id,
 hand_id:'11111111-1111-4111-8111-111111111111',expected_action_id:'22222222-2222-4222-8222-222222222222',
 expected_source_revision:7,idempotency_key:'undo-TEST-saved-key'};
const undoProof={ok:true,duplicate:false,operation:'undo_open_hand',hand_id:undo.hand_id,
 undone_action_id:undo.expected_action_id,source_revision:8};
describe('actual Tracker Edge undo verdict and receipt',()=>{
 it.each(['dealer_assignment_not_unique','actor_not_allowed','last_action_changed'])('does not wrap %s denial as success',async(code)=>{
  const r=await invoke(undo,{ok:false,error:code});expect(r.status).toBe(409);expect(r.body.code).toBe(code);
  expect(r.rpc).toHaveBeenCalledExactlyOnceWith('undo_tracker_last_action_v1',expect.objectContaining({p_hand_id:undo.hand_id,p_idempotency_key:undo.idempotency_key}));
 });
 it.each([null,{}, {ok:false}, {...undoProof,hand_id:'wrong-hand'}, {...undoProof,undone_action_id:'wrong-action'},
  {...undoProof,source_revision:7}, {...undoProof,operation:'another-operation'}])('keeps malformed or mismatched undo receipt unknown: %j',async(proof)=>{
  const r=await invoke(undo,proof);expect(r.status).toBe(502);expect(r.body.code).toBe('undo_receipt_unconfirmed');
 });
 it.each([false,true])('accepts an exact confirmed receipt, duplicate=%s',async(duplicate)=>{
  const r=await invoke(undo,{...undoProof,duplicate});expect(r.status).toBe(200);expect(r.body.data).toEqual({...undoProof,duplicate});
 });
});
