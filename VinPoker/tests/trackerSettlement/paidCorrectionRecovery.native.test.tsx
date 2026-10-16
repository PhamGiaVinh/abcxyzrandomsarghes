import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { useState, type ComponentProps } from "react";
import { execFileSync } from "node:child_process";
import { webcrypto } from "node:crypto";
import { MemoryRouter } from "react-router-dom";
import { createPaidCompletedHandFixture } from "../cashier/paidJourney.fixture.mjs";
import { runPaidCorrectionEdge } from "./paidCorrectionEdge.native.mjs";
import { useCorrectionCommitRecovery } from "@/components/cashier/tournament-live/useCorrectionCommitRecovery";
import { HandHistoryWorkspace, ResettlePreview } from "@/components/cashier/tournament-live/HandHistoryWorkspace";
import { HandEditPanel, type HandEditPanelProps } from "@/components/cashier/tournament-live/HandEditPanel";
import { buildServerSettlementEdit, runClientResettle } from "@/components/cashier/tournament-live/resettleApply";
import { readCorrectionIntent, type CorrectionCommitIntent } from "@/lib/tracker-poker/correctionCommitIntent";
const h=vi.hoisted(()=>{const invoke=vi.fn(),from=vi.fn(),rpc=vi.fn();return {actor:"",invoke,from,rpc,client:{from,rpc,functions:{invoke}}};});
vi.mock("@/hooks/useAuth",()=>({useAuth:()=>({user:{id:h.actor}})}));
vi.mock("@/integrations/supabase/SupabaseClientContext",()=>({useSupabaseClient:()=>h.client}));
vi.mock("@/lib/featureFlags",()=>({FEATURES:{trackerAtomicResettle:true,trackerHandHistoryEdit:true,trackerResettleForward:true,trackerHistoryCompletionWorker:true},isTrackerAtomicResettleAvailable:()=>true}));
const enabled=process.env.VINPOKER_NATIVE_CORRECTION_UI==='1',database='vinpoker_ops_cash115_qualified_c';
const prefix=process.platform==='win32'?['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${database}`,'psql']:[];
const sql=(input:string)=>execFileSync(prefix.length?'wsl':'psql',[...prefix,'-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:30000,stdio:['pipe','pipe','pipe']}).trim();
let testRole:string|undefined;

// Strict read-only SDK seam. Actual parent predicates/paging and authenticated
// database reads execute; HTTP/PostgREST and auth provider are not exercised.
function bindParentReads(actor:string,tour:string){
 const quote=(v:unknown)=>`'${String(v).replaceAll("'","''")}'`;
 const authenticated=`SET request.jwt.claim.sub=${quote(actor)};SET request.jwt.claims=${quote(JSON.stringify({role:'authenticated',sub:actor}))};SET ROLE authenticated;`;
 const column=(v:string)=>{expect(v).toMatch(/^[a-z_]+$/);return v;};
 h.from.mockImplementation((table:string)=>{
  expect(['tournament_hands','hand_players','hand_actions','tournament_seats']).toContain(table);
  let columns='',where:string[]=[],order:string[]=[],limit:number|undefined,offset=0;
  const builder={select:(v:string)=>{expect(v).toMatch(/^[a-z_, ]+$/);columns=v;return builder;},
   eq:(key:string,value:unknown)=>{where.push(`${column(key)}=${quote(value)}`);return builder;},
   gte:(key:string,value:unknown)=>{where.push(`${column(key)}>=${quote(value)}`);return builder;},
   in:(key:string,values:unknown[])=>{expect(values.length).toBeGreaterThan(0);where.push(`${column(key)} IN (${values.map(quote).join(',')})`);return builder;},
   order:(key:string,options?:{ascending?:boolean})=>{order.push(column(key)+(options?.ascending===false?' DESC':' ASC'));return builder;},
   limit:(n:number)=>{expect(n).toBe(1);limit=n;return builder;},
   range:(from:number,to:number)=>{expect(Number.isSafeInteger(from)&&from>=0&&to>=from&&to-from<1000).toBe(true);offset=from;limit=to-from+1;return builder;},
   then:(resolve:(value:unknown)=>unknown,reject:(error:unknown)=>unknown)=>{
    try{expect(columns).not.toBe('');const data=JSON.parse(sql(authenticated+`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM (SELECT ${columns} FROM public.${table}${where.length?' WHERE '+where.join(' AND '):''}${order.length?' ORDER BY '+order.join(','):''}${limit!==undefined?' LIMIT '+limit:''} OFFSET ${offset}) x;`));return Promise.resolve({data,error:null}).then(resolve,reject);}
    catch(error){return Promise.reject(error).then(resolve,reject);}
   }};return builder;
 });
 h.rpc.mockImplementation(async(name:string,args:{p_tournament_id:string})=>{
  expect(['list_tracker_tables_v2','get_tracker_historical_display_queue_status']).toContain(name);expect(args).toEqual({p_tournament_id:tour});
  const query=name==='get_tracker_historical_display_queue_status'
   ? `SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM public.${name}(${quote(tour)}) x;`
   : `SELECT public.${name}(${quote(tour)});`;
  return {data:JSON.parse(sql(authenticated+query)),error:null};
 });
}
afterEach(()=>{cleanup();localStorage.clear();});
afterAll(()=>{if(testRole)sql(`DROP ROLE ${testRole};`);});
function Panel({intent,mutation,view,players}:{intent:CorrectionCommitIntent;mutation:()=>Promise<{data:unknown;error:unknown}>;
 view:ComponentProps<typeof ResettlePreview>['view'];players:ComponentProps<typeof ResettlePreview>['players']}){
 const [outcome,setOutcome]=useState('idle');
 const recovery=useCorrectionCommitRecovery(intent.tournament_id,intent.hand_id,()=>setOutcome('recovered'));
 return <section><p role="status">{outcome}</p><p>{recovery.message}</p>
  <ResettlePreview view={view} players={players} busy={recovery.busy} confirmationBlocked={!!recovery.message} onClose={()=>{}} onConfirm={()=>{void recovery.commit(intent,mutation).then(ok=>setOutcome(ok?'confirmed':'unknown')).catch(()=>setOutcome('blocked'));}}/>
  <button type="button" disabled={recovery.busy} onClick={()=>{void recovery.recover();}}>Kiểm tra receipt TEST</button></section>;
}
describe.skipIf(!enabled)('Correction hook UI → actual Edge → PostgreSQL (not hosted browser)',()=>{
 it('recovers one committed correction after missing receipt and remount, without another mutation',async()=>{
  expect(process.env.PGHOST).toBe('127.0.0.1');expect(process.env.PGPORT).toBe('55441');expect(process.env.PGUSER).toBe('postgres');expect(process.env.PGDATABASE).toBe(database);
  for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])expect(process.env[key]).toBeFalsy();
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:webcrypto});
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_key:unknown,_options:unknown,fn:()=>Promise<unknown>)=>await fn()}});
  const {fixture,hand}=createPaidCompletedHandFixture(sql,{verified:true});h.actor=fixture.actor;
  testRole='correction_ui_'+crypto.randomUUID().replaceAll('-','');sql(`CREATE ROLE ${testRole} NOLOGIN INHERIT BYPASSRLS;GRANT service_role TO ${testRole};`);
  const service=`SET request.jwt.claim.role='service_role';SET request.jwt.claims='{"role":"service_role"}';SET ROLE ${testRole};`;
  const logical=sql(`SELECT tournament_table_id FROM public.tournament_hands WHERE id='${hand}';`);
  sql(`INSERT INTO public.tracker_correction_uat_scopes(club_id,tournament_id,tournament_table_id,user_id,capability,enabled) VALUES('${fixture.club}','${fixture.tour}','${logical}','${fixture.actor}','correct_completed_hand',true);`);
  await runPaidCorrectionEdge({sql,service,fixture,hand,scenario:async({invoke,body,setMaskReceipt,errors})=>{
   const snapshot=JSON.parse(sql(service+`SELECT public.get_tracker_historical_display_snapshot('${hand}',NULL);`));
   const editorPlayers=snapshot.players.map(p=>({...p,display_name:'TEST seat '+p.seat_number}));
   let submitted:Parameters<NonNullable<HandEditPanelProps['onResettle']>>|undefined;
   const legacySave=vi.fn();
   const editor=render(<HandEditPanel board={snapshot.hand.community_cards} potSize={snapshot.hand.pot_size} players={editorPlayers}
    actions={snapshot.actions} buttonSeat={snapshot.hand.button_seat} writesEnabled={false} resettleEnabled onCancel={()=>{}} onSave={legacySave}
    onResettle={(...args)=>{submitted=args;}}/>);
   for(const [rank,suit] of [['2','♣'],['3','♦'],['4','♥']]){
    await act(async()=>{fireEvent.click(screen.getAllByRole('button',{name:'Chọn lá bài'})[0]);});
    await act(async()=>{fireEvent.click(await screen.findByRole('button',{name:'Chọn hạng '+rank}));});
    await act(async()=>{fireEvent.click(await screen.findByRole('button',{name:'Chọn '+rank+suit}));});
    await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
   }
   expect(screen.queryByText(/Chức năng ghi sửa hand đang tạm khóa/)).not.toBeInTheDocument();
   fireEvent.change(screen.getByRole('textbox',{name:'Lý do sửa — bắt buộc'}),{target:{value:body.correction_reason}});
   expect(screen.getByRole('button',{name:'Xem trước tính chip'})).toBeEnabled();
   fireEvent.click(screen.getByRole('button',{name:'Xem trước tính chip'}));expect(submitted).toBeDefined();expect(legacySave).not.toHaveBeenCalled();
   const [editedTarget,patch,reason,,expectedStacks]=submitted!;
   body={...body,edit:buildServerSettlementEdit(patch),correction_reason:reason,expected_target_ending_stacks:expectedStacks};
   expect(body.edit.communityCards).toEqual(['2c','3d','4h']);editor.unmount();
   const previewResponse=await invoke(body),preview=await previewResponse.json();expect(previewResponse.status).toBe(200);
   const intent:CorrectionCommitIntent={expected_actor_id:fixture.actor,tournament_id:fixture.tour,hand_id:hand,idempotency_key:crypto.randomUUID(),
    expected_source_revision:preview.source_revision,expected_source_chain_hash:preview.source_chain_hash,expected_outcome_hash:preview.outcome_hash,expected_request_hash:preview.request_hash};
   const target={...snapshot.hand,players:snapshot.players,actions:snapshot.actions};
   const client=runClientResettle({target,later:[],editedTarget});expect(client.result.ok).toBe(true);
   const view={result:client.result,targetHandId:hand,expectedEndingStacks:body.expected_target_ending_stacks,
    serverPreview:{sourceRevision:preview.source_revision,sourceChainHash:preview.source_chain_hash,outcomeHash:preview.outcome_hash,requestHash:preview.request_hash,actorId:fixture.actor}};
   const players=snapshot.players.map(p=>({player_id:p.player_id,display_name:'TEST seat '+p.seat_number,ending_stack:p.ending_stack}));
   const cash=()=>sql(`SELECT jsonb_agg(to_jsonb(m) ORDER BY id)::text FROM public.cashier_buyin_movements m WHERE tournament_id='${fixture.tour}';`),cashBefore=cash();
   let writes=0;setMaskReceipt(true);
   const mutation=async()=>{writes++;expect(readCorrectionIntent(localStorage,intent)).toEqual(intent);
    const response=await invoke({...body,...intent,mode:'commit'});expect(response.status).toBe(502);return {data:await response.json(),error:new Error('TEST missing commit receipt')};};
   h.invoke.mockImplementation(async(_name:string,{body:request}:{body:unknown})=>{const response=await invoke(request);return {data:await response.json(),error:response.ok?null:new Error('TEST read failure')};});
   const first=render(<Panel intent={intent} mutation={mutation} view={view} players={players}/>);
   expect(screen.getByRole('button',{name:'Xác nhận sửa hand'})).toBeEnabled();
   await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Xác nhận sửa hand'}));});
   await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('unknown'),{timeout:10_000});
   expect(screen.getByRole('button',{name:'Xác nhận sửa hand'})).toBeDisabled();
   expect(readCorrectionIntent(localStorage,intent)).toEqual(intent);expect(writes).toBe(1);
   expect(Number(sql(`SELECT source_revision FROM public.tournament_hands WHERE id='${hand}';`))).toBeGreaterThan(intent.expected_source_revision);expect(cash()).toBe(cashBefore);
   const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('hand',(SELECT to_jsonb(x) FROM public.tournament_hands x WHERE id='${hand}'),
    'outcomes',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_settlement_outcomes x WHERE hand_id='${hand}'),
    'seats',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x WHERE tournament_id='${fixture.tour}'),
    'counts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY player_id,entry_number) FROM public.tournament_chip_counts x WHERE tournament_id='${fixture.tour}'),
    'cash',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x WHERE tournament_id='${fixture.tour}'))::text);`);
   const after=fingerprint();expect(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}' AND idempotency_key='${intent.idempotency_key}';`)).toBe('1');
   first.unmount();render(<Panel intent={intent} mutation={mutation} view={view} players={players}/>);
   expect(screen.getByText(/Có yêu cầu sửa hand chưa rõ/)).toBeInTheDocument();
   await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Kiểm tra receipt TEST'}));});
   await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('recovered'));
   expect(h.invoke).toHaveBeenCalledWith('tournament-live-resettle-commit',{body:{mode:'resolve',...intent}});
   expect(readCorrectionIntent(localStorage,intent)).toBeNull();expect(writes).toBe(1);expect(fingerprint()).toBe(after);expect(errors).toEqual([]);
  }});
 });
 it('runs the full parent editor/preview/commit and remount receipt recovery against actual SQL',async()=>{
  expect(process.env.PGHOST).toBe('127.0.0.1');expect(process.env.PGPORT).toBe('55441');expect(process.env.PGDATABASE).toBe(database);
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:webcrypto});
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_key:unknown,_options:unknown,fn:()=>Promise<unknown>)=>await fn()}});
  const {fixture,hand}=createPaidCompletedHandFixture(sql,{verified:true});h.actor=fixture.actor;
  if(!testRole){testRole='correction_ui_'+crypto.randomUUID().replaceAll('-','');sql(`CREATE ROLE ${testRole} NOLOGIN INHERIT BYPASSRLS;GRANT service_role TO ${testRole};`);}
  const service=`SET request.jwt.claim.role='service_role';SET request.jwt.claims='{"role":"service_role"}';SET ROLE ${testRole};`;
  const logical=sql(`SELECT tournament_table_id FROM public.tournament_hands WHERE id='${hand}';`);
  sql(`INSERT INTO public.tracker_correction_uat_scopes(club_id,tournament_id,tournament_table_id,user_id,capability,enabled) VALUES('${fixture.club}','${fixture.tour}','${logical}','${fixture.actor}','correct_completed_hand',true);`);
  bindParentReads(fixture.actor,fixture.tour);h.invoke.mockClear();
  const baselineWorker=execFileSync(process.execPath,['--experimental-transform-types','tests/trackerSettlement/paidHistoryWorker.native.mjs','--verified'],
   {cwd:process.cwd(),encoding:'utf8',timeout:30_000,maxBuffer:1_000_000,env:{...process.env,VINPOKER_HISTORY_PARENT_HAND:hand,VINPOKER_HISTORY_PARENT_BASELINE:JSON.stringify(fixture)}});
  expect(baselineWorker).toContain('ACTUAL_PAID_PARENT_BASELINE_HISTORY_WORKER_PUBLIC_PASS');
  const publicHistory=()=>JSON.parse(sql(`SET request.jwt.claims='{"role":"anon"}';SET ROLE anon;SELECT public.get_public_tournament_table_history_v2('${fixture.tour}','${logical}',20,NULL,NULL);`));
  expect(publicHistory().items[0].result.status).toBe('verified');
  await runPaidCorrectionEdge({sql,service,fixture,hand,scenario:async({invoke,setMaskReceipt,errors})=>{
   setMaskReceipt(true);let commits=0;let intent:CorrectionCommitIntent|undefined;
   h.invoke.mockImplementation(async(_name:string,{body}:{body:Record<string,unknown>})=>{
    if(body.mode==='commit'){commits++;intent=readCorrectionIntent(localStorage,{expected_actor_id:fixture.actor,tournament_id:fixture.tour,hand_id:hand})??undefined;expect(intent).toBeDefined();}
    const response=await invoke(body);return {data:await response.json(),error:response.ok?null:new Error('TEST transport unverified')};
   });
   const beforeRevision=Number(sql(`SELECT source_revision FROM public.tournament_hands WHERE id='${hand}';`));
   const money=()=>sql(`SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m WHERE tournament_id='${fixture.tour}';`),beforeMoney=money();
   const props={tournamentId:fixture.tour,initialHandId:hand,initialTableId:logical,workspaceMode:true};
   const first=render(<MemoryRouter><HandHistoryWorkspace {...props}/></MemoryRouter>);
   fireEvent.click(await screen.findByRole('button',{name:'Xem bản nháp sửa hand'},{timeout:10_000}));
   for(const [rank,suit] of [['2','♣'],['3','♦'],['4','♥']]){
    await act(async()=>{fireEvent.click(screen.getAllByRole('button',{name:'Chọn lá bài'})[0]);});
    await act(async()=>{fireEvent.click(await screen.findByRole('button',{name:'Chọn hạng '+rank}));});
    await act(async()=>{fireEvent.click(await screen.findByRole('button',{name:'Chọn '+rank+suit}));});
    await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
   }
   fireEvent.change(screen.getByRole('textbox',{name:'Lý do sửa — bắt buộc'}),{target:{value:'TEST parent correction recovery'}});
   await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Xem trước tính chip'}));});
   const confirm=await screen.findByRole('button',{name:'Xác nhận sửa hand'},{timeout:10_000});expect(confirm).toBeEnabled();
   await act(async()=>{fireEvent.click(confirm);});
   await waitFor(()=>expect(screen.getByText(/Chưa xác nhận kết quả sửa hand/)).toBeInTheDocument(),{timeout:10_000});
   expect(commits).toBe(1);expect(intent).toBeDefined();expect(readCorrectionIntent(localStorage,intent!)).toEqual(intent);
   expect(screen.getByRole('button',{name:'Xác nhận sửa hand'})).toBeDisabled();expect(money()).toBe(beforeMoney);
   expect(Number(sql(`SELECT source_revision FROM public.tournament_hands WHERE id='${hand}';`))).toBeGreaterThan(beforeRevision);
   expect(JSON.parse(sql(`SELECT community_cards FROM public.tournament_hands WHERE id='${hand}';`))).toEqual(['2c','3d','4h']);
   // A freshly verified chain correction is an explicitly supported public
   // fallback. Verify proof identity, not an incorrect mandatory-pending label.
   expect(publicHistory().items[0].result.status).toBe('verified');
   expect(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}' AND verification_scope='historical_display' AND source_revision=${beforeRevision} AND status='stale';`)).toBe('1');
   expect(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes o CROSS JOIN LATERAL public.get_tournament_settlement_source_hash(o.hand_id) current_source
    WHERE o.hand_id='${hand}' AND o.verification_scope='chain' AND o.status='verified'
     AND o.source_revision=current_source.source_revision AND o.source_chain_hash=current_source.source_chain_hash;`)).toBe('1');
   expect(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes o JOIN public.tournament_hands x ON x.id=o.hand_id AND x.source_revision=o.source_revision
    WHERE o.hand_id='${hand}' AND o.verification_scope='historical_display' AND o.status='verified';`)).toBe('0');
   const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('hand',(SELECT to_jsonb(x) FROM public.tournament_hands x WHERE id='${hand}'),
    'proof',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_settlement_outcomes x WHERE hand_id='${hand}'),
    'queue',(SELECT jsonb_agg(to_jsonb(x) ORDER BY source_revision) FROM public.tracker_historical_display_queue x WHERE hand_id='${hand}'),
    'players',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_players x WHERE hand_id='${hand}'),
    'actions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_actions x WHERE hand_id='${hand}'),
    'entries',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x WHERE tournament_id='${fixture.tour}'),
    'counts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY player_id,entry_number) FROM public.tournament_chip_counts x WHERE tournament_id='${fixture.tour}'),
    'seats',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x WHERE tournament_id='${fixture.tour}'))::text);`);
   const beforeWorker=fingerprint();
   const correctedRevision=sql(`SELECT source_revision FROM public.tournament_hands WHERE id='${hand}';`);
   for(const [deniedEnv,reason] of [[{VINPOKER_NATIVE_CORRECTION_UI:'0',VINPOKER_HISTORY_PARENT_HAND:hand},'owned_parent_ui_gate_required'],
    [{VINPOKER_NATIVE_CORRECTION_UI:'1',VINPOKER_HISTORY_PARENT_HAND:crypto.randomUUID()},'owned_parent_correction_required']] as const){
    let rejection:{stderr?:unknown}|undefined;
    try{execFileSync(process.execPath,['--experimental-transform-types','tests/trackerSettlement/paidHistoryWorker.native.mjs','--verified'],
     {cwd:process.cwd(),encoding:'utf8',timeout:10_000,maxBuffer:1_000_000,stdio:['pipe','pipe','pipe'],env:{...process.env,...deniedEnv}});}
    catch(error){rejection=error as {stderr?:unknown};}
    expect(rejection).toBeDefined();expect(String(rejection?.stderr)).toContain(reason);
    expect(fingerprint()).toBe(beforeWorker);
   }
   const worker=execFileSync(process.execPath,['--experimental-transform-types','tests/trackerSettlement/paidHistoryWorker.native.mjs','--verified'],
    {cwd:process.cwd(),encoding:'utf8',timeout:30_000,maxBuffer:1_000_000,env:{...process.env,VINPOKER_HISTORY_PARENT_HAND:hand}});
   expect(worker).toContain('ACTUAL_PARENT_CORRECTION_SAME_HAND_CURRENT_REVISION_WORKER_PUBLIC_PASS');
   expect(sql(`SELECT source_revision FROM public.tournament_hands WHERE id='${hand}';`)).toBe(correctedRevision);expect(money()).toBe(beforeMoney);
   const published=JSON.parse(sql(`SET request.jwt.claims='{"role":"anon"}';SET ROLE anon;SELECT public.get_public_tournament_table_history_v2('${fixture.tour}','${logical}',20,NULL,NULL);`));
   expect(published.items[0].handId).toBe(hand);expect(published.items[0].result.status).toBe('verified');
   expect(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}' AND verification_scope='historical_display' AND status='verified' AND source_revision=${correctedRevision};`)).toBe('1');
   // Publication may finish while the browser still holds an unknown commit.
   // Resolve the original correction receipt, not the newer publication proof.
   expect(readCorrectionIntent(localStorage,intent!)).toEqual(intent);
   const after=fingerprint();first.unmount();render(<MemoryRouter><HandHistoryWorkspace {...props}/></MemoryRouter>);
   expect(screen.getByText(/Có yêu cầu sửa hand chưa rõ/)).toBeInTheDocument();
   await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Kiểm tra receipt sửa hand'}));});
   await waitFor(()=>expect(readCorrectionIntent(localStorage,intent!)).toBeNull(),{timeout:10_000});
   expect(commits).toBe(1);expect(fingerprint()).toBe(after);expect(money()).toBe(beforeMoney);expect(errors).toEqual([]);
   expect(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${hand}' AND idempotency_key='${intent!.idempotency_key}';`)).toBe('1');
  }});
 // Two real worker processes plus WSL-backed UI/SQL exceeded the former 30s
 // case budget (31.3s observed). Application/read/workflow deadlines unchanged.
 },45_000);
});
