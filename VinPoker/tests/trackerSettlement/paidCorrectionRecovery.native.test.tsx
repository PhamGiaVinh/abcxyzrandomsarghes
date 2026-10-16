import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { useState, type ComponentProps } from "react";
import { execFileSync } from "node:child_process";
import { webcrypto } from "node:crypto";
import { createPaidCompletedHandFixture } from "../cashier/paidJourney.fixture.mjs";
import { runPaidCorrectionEdge } from "./paidCorrectionEdge.native.mjs";
import { useCorrectionCommitRecovery } from "@/components/cashier/tournament-live/useCorrectionCommitRecovery";
import { ResettlePreview } from "@/components/cashier/tournament-live/HandHistoryWorkspace";
import { HandEditPanel, type HandEditPanelProps } from "@/components/cashier/tournament-live/HandEditPanel";
import { buildServerSettlementEdit, runClientResettle } from "@/components/cashier/tournament-live/resettleApply";
import { readCorrectionIntent, type CorrectionCommitIntent } from "@/lib/tracker-poker/correctionCommitIntent";
const h=vi.hoisted(()=>({actor:"",invoke:vi.fn()}));
vi.mock("@/hooks/useAuth",()=>({useAuth:()=>({user:{id:h.actor}})}));
vi.mock("@/integrations/supabase/SupabaseClientContext",()=>({useSupabaseClient:()=>({functions:{invoke:h.invoke}})}));
vi.mock("@/lib/featureFlags",()=>({FEATURES:{trackerAtomicResettle:true},isTrackerAtomicResettleAvailable:()=>true}));
const enabled=process.env.VINPOKER_NATIVE_CORRECTION_UI==='1',database='vinpoker_ops_cash115_qualified_c';
const prefix=process.platform==='win32'?['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${database}`,'psql']:[];
const sql=(input:string)=>execFileSync(prefix.length?'wsl':'psql',[...prefix,'-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:30000,stdio:['pipe','pipe','pipe']}).trim();
let testRole:string|undefined;
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
});
