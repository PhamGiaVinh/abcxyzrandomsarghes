import { execFileSync } from "node:child_process";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useManualSwingRecovery } from "@/components/cashier/dealer-swing/useManualSwingRecovery";
import { manualSwingJournalKey, manualSwingReaderArgs, persistManualSwingIntent,
  type DealerManualSwingIntent } from "@/lib/dealerManualSwingIntent";

// Opt-in isolated PG17 integration. Real hook + real functions/receipts, not
// PostgREST/HTTP, browser layout, real rotation, or production auth evidence.
const toast=vi.hoisted(()=>({success:vi.fn(),info:vi.fn(),warning:vi.fn()}));
vi.mock("sonner",()=>({toast}));
const baselineOnQualified=process.env.VINPOKER_NATIVE_SWING_178_BASELINE==='1';
const enabled=process.env.VINPOKER_NATIVE_SWING_UI==="1"||baselineOnQualified;
const integrationEnabled=process.env.VINPOKER_NATIVE_SWING_178_UI==='1';
const fixture=integrationEnabled?JSON.parse(process.env.VINPOKER_SWING178_FIXTURE??'null'):null;
const nativeDatabase=integrationEnabled?'vinpoker_ops_cash115_qualified_c':'vinpoker_ops_swing101_ui';
const id=(n:number)=>`${integrationEnabled?fixture?.prefix:'e1800000'}-0000-4000-8000-${String(n).padStart(12,"0")}`;
function sql(query:string):string {
  const flags=["-X","-qAt","-v","ON_ERROR_STOP=1"];
  const output=process.platform==="win32"
    ?execFileSync("wsl",["-d","PokerVision-P16-4C-Eval","--","env","PGHOST=127.0.0.1","PGPORT=55441",
      "PGUSER=postgres",`PGDATABASE=${nativeDatabase}`,"psql",...flags],{input:query,encoding:"utf8",timeout:15000,stdio:["pipe","pipe","pipe"]})
    :execFileSync("psql",flags,{input:query,encoding:"utf8",timeout:15000,stdio:["pipe","pipe","pipe"]});
  return output.trim();
}
const auth=(actor:string)=>`SET request.jwt.claim.sub='${actor}';SET request.jwt.claim.role='authenticated';SET request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET ROLE authenticated;`;
const fields=["p_actor_user_id","p_club_id","p_table_id","p_table_session_id","p_assignment_id","p_expected_version","p_request_id"];
const functions=new Set(["operator_perform_swing_v2","get_dealer_manual_swing_receipt_v1","cancel_dealer_manual_swing_v1"]);
function invoke(name:string,args:Record<string,unknown>,actualActor=id(1)) {
  if(!functions.has(name)||Object.keys(args).length!==7||fields.some(k=>!(k in args)))throw new Error("unexpected RPC contract");
  const values=fields.map(field=>{
    if(field==="p_expected_version"){
      if(!Number.isInteger(args[field]))throw new Error("invalid expected_version");
      return `${field}=>${args[field]}::integer`;
    }
    const value=args[field];
    if(typeof value!=="string"||!/^[a-f0-9-]{36}$/i.test(value))throw new Error("invalid UUID RPC argument");
    return `${field}=>'${value}'::uuid`;
  });
  return JSON.parse(sql(auth(actualActor)+`SELECT public.${name}(${values.join(",")});`));
}
function assignment() {
  return JSON.parse(sql(`SELECT jsonb_build_object('id',id,'table_id',table_id,'table_session_id',table_session_id,'version',version)
   FROM public.dealer_assignments WHERE table_id='${id(11)}' AND released_at IS NULL;`)) as {id:string;table_id:string;table_session_id:string;version:number};
}
function intent(versionDelta=0):DealerManualSwingIntent {
  const a=assignment();return {actor_user_id:id(1),club_id:id(2),table_id:a.table_id,table_session_id:a.table_session_id,
    assignment_id:a.id,expected_version:a.version+versionDelta,request_id:crypto.randomUUID()};
}
const key=manualSwingJournalKey({actor_user_id:id(1),club_id:id(2)});
const stored=()=>JSON.parse(sessionStorage.getItem(key)!) as DealerManualSwingIntent;
function context(dropOnce?:string,actualActor=id(1)) {
  let dropped=false;
  return {actorId:id(1),clubId:id(2),assignments:[assignment()],onSettled:vi.fn(),
    rpc:vi.fn(async(name:string,args:Record<string,unknown>)=>{
      try {
        const data=invoke(name,args,actualActor);
        if(name===dropOnce&&!dropped){dropped=true;return {data:null,error:{message:"injected response loss after real COMMIT"}};}
        return {data,error:null};
      }catch(e){return {data:null,error:{message:e instanceof Error?e.message:String(e)}};}
    })};
}
function operationalFingerprint(){return sql(`SELECT md5(jsonb_build_object(
 'assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_assignments a),
 'attendance',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_attendance a))::text);`);}
describe.skipIf(!enabled)("manual Swing actual hook/native PostgreSQL receipt integration",()=>{
  beforeAll(()=>{
    expect(process.env.PGHOST).toBe("127.0.0.1");expect(process.env.PGPORT).toBe("55441");
    expect(process.env.PGUSER).toBe("postgres");expect(process.env.PGDATABASE).toBe(nativeDatabase);
    if(baselineOnQualified){expect(integrationEnabled).toBe(true);expect(fixture?.prefix).toMatch(/^[a-f0-9]{8}$/);expect(fixture.actor).toBe(id(1));expect(fixture.club).toBe(id(2));}
    for(const key of ["PGHOSTADDR","PGSERVICE","PGSERVICEFILE","PGOPTIONS"])expect(process.env[key]).toBeFalsy();
    expect(sql("SELECT current_database()||'|'||inet_server_port()||'|'||current_setting('server_version_num')::int/10000;"))
      .toBe(`${nativeDatabase}|55441|17`);
    const dir=sql("SHOW data_directory");
    expect(dir==="/tmp/vinpoker-sol-local-20261016-0e79a729/data"||process.env.GITHUB_ACTIONS==="true"&&dir==="/var/lib/postgresql/data").toBe(true);
    expect(sql(`SELECT md5(replace(pg_get_functiondef('public.operator_perform_swing(uuid,uuid,uuid,integer,uuid)'::regprocedure),chr(13),''));`))
      .toBe(integrationEnabled?"c6adcb202cccc977d0061a681e337740":"a25a91e02d6f2c0399e5aba1086e4acf");
  });
  beforeEach(()=>{sessionStorage.clear();vi.clearAllMocks();});
  afterEach(cleanup);
  it("recovers a lost writer response after real commit and remount without assignment cache",async()=>{
    const ctx=context("operator_perform_swing_v2"),hook=renderHook(()=>useManualSwingRecovery(ctx));
    await act(async()=>hook.result.current.performSwingForTable(ctx.assignments[0].id));
    const i=stored();expect(invoke("get_dealer_manual_swing_receipt_v1",manualSwingReaderArgs(i)).status).toBe("receipt_found");
    expect(ctx.onSettled).not.toHaveBeenCalled();hook.unmount();ctx.assignments=[];ctx.rpc.mockClear();
    const remount=renderHook(()=>useManualSwingRecovery(ctx));
    expect(remount.result.current.pending).toEqual(i);expect(ctx.rpc).not.toHaveBeenCalled();
    await act(async()=>remount.result.current.reconcile());
    expect(sessionStorage.getItem(key)).toBeNull();expect(ctx.onSettled).toHaveBeenCalledOnce();
    expect(ctx.rpc.mock.calls.map(c=>c[0])).toEqual(["get_dealer_manual_swing_receipt_v1"]);
    expect(sql(`SELECT count(*) FROM public.dealer_swing_operator_requests WHERE club_id='${id(2)}' AND request_id='${i.request_id}';`)).toBe("1");
  });
  it("cancels an unsent request, and a delayed real writer replays the tombstone",async()=>{
    const i=intent(),before=operationalFingerprint();persistManualSwingIntent(sessionStorage,i);
    const ctx=context(),hook=renderHook(()=>useManualSwingRecovery(ctx));
    await act(async()=>hook.result.current.cancel());
    expect(sessionStorage.getItem(key)).toBeNull();expect(toast.info).toHaveBeenCalledOnce();expect(toast.success).not.toHaveBeenCalled();
    expect(invoke("operator_perform_swing_v2",manualSwingReaderArgs(i)).outcome).toBe("cancelled");
    expect(operationalFingerprint()).toBe(before);
  });
  it("a stale writer with no receipt can be cancelled without a local discard",async()=>{
    const i=intent(100),before=operationalFingerprint();persistManualSwingIntent(sessionStorage,i);
    const ctx=context(),hook=renderHook(()=>useManualSwingRecovery(ctx));
    await act(async()=>hook.result.current.retry());
    expect(sessionStorage.getItem(key)).not.toBeNull();expect(hook.result.current.error).toContain("SWING_VERSION_CONFLICT");
    expect(invoke("get_dealer_manual_swing_receipt_v1",manualSwingReaderArgs(i)).status).toBe("receipt_not_found");
    await act(async()=>hook.result.current.cancel());
    expect(sessionStorage.getItem(key)).toBeNull();expect(operationalFingerprint()).toBe(before);
    expect(invoke("operator_perform_swing_v2",manualSwingReaderArgs(i)).outcome).toBe("cancelled");
  });
  it("recovers a lost cancel response from the real stored tombstone after remount",async()=>{
    const i=intent(),before=operationalFingerprint();persistManualSwingIntent(sessionStorage,i);
    const ctx=context("cancel_dealer_manual_swing_v1"),hook=renderHook(()=>useManualSwingRecovery(ctx));
    await act(async()=>hook.result.current.cancel());expect(stored()).toEqual(i);hook.unmount();ctx.rpc.mockClear();
    const remount=renderHook(()=>useManualSwingRecovery(ctx));await act(async()=>remount.result.current.reconcile());
    expect(sessionStorage.getItem(key)).toBeNull();expect(toast.info).toHaveBeenCalledOnce();
    expect(ctx.rpc.mock.calls.map(c=>c[0])).toEqual(["get_dealer_manual_swing_receipt_v1"]);expect(operationalFingerprint()).toBe(before);
  });
  it("server rejects the wrong actual actor, and only the original actor can resolve its journal",async()=>{
    const before=operationalFingerprint(),ctx=context(undefined,id(99));
    const hook=renderHook(({value})=>useManualSwingRecovery(value),{initialProps:{value:ctx}});
    await act(async()=>hook.result.current.performSwingForTable(ctx.assignments[0].id));
    const i=stored();expect(hook.result.current.error).toContain("SWING_OPERATOR_FORBIDDEN");
    expect(invoke("get_dealer_manual_swing_receipt_v1",manualSwingReaderArgs(i)).status).toBe("receipt_not_found");
    await act(async()=>hook.result.current.cancel());expect(stored()).toEqual(i);expect(operationalFingerprint()).toBe(before);
    hook.rerender({value:context()});await act(async()=>hook.result.current.cancel());
    expect(sessionStorage.getItem(key)).toBeNull();expect(operationalFingerprint()).toBe(before);
  });
});

describe.skipIf(!integrationEnabled||baselineOnQualified)('qualified178/179 actual UI hook → PG commit → retired assignment recovery',()=>{
 beforeAll(()=>{
  expect(enabled).toBe(false);expect(fixture).not.toBeNull();expect(fixture.prefix).toMatch(/^[a-f0-9]{8}$/);
  expect(fixture.actor).toBe(id(1));expect(fixture.club).toBe(id(2));expect(fixture.table).toBe(id(11));expect(fixture.session).toBe(id(21));
  for(const value of [fixture.assignment.id,fixture.schedule,fixture.incoming])expect(value).toMatch(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
  for(const [key,value] of Object.entries({PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:nativeDatabase}))expect(process.env[key]).toBe(value);
  for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])expect(process.env[key]).toBeFalsy();
  expect(sql("SELECT current_database()||'|'||inet_server_port()||'|'||current_setting('server_version_num')::int/10000;")).toBe(`${nativeDatabase}|55441|17`);
  expect(sql('SHOW data_directory;')).toBe('/tmp/vinpoker-sol-local-20261016-0e79a729/data');
  expect(sql(`SELECT name FROM public.clubs WHERE id='${id(2)}' AND owner_id='${id(1)}';`)).toBe('Operational TEST');
  expect(sql(`SELECT md5(replace(pg_get_functiondef('public.operator_perform_swing(uuid,uuid,uuid,integer,uuid)'::regprocedure),chr(13),''));`)).toBe('c6adcb202cccc977d0061a681e337740');
  expect(sql(`SELECT md5(replace(pg_get_functiondef('public.operator_plan_next_dealer_v1(uuid,uuid,integer,uuid,uuid)'::regprocedure),chr(13),''));`)).toBe('2f5bc9c0aeba16b74839b0d9318b6d3c');
  expect(sql(`SELECT auto_swing_enabled FROM public.club_settings WHERE club_id='${id(2)}';`)).toBe('f');
 });
 afterEach(cleanup);
 it('recovers exact v2 receipt after COMMIT loss, canonical close and cache-free remount without another write',async()=>{
  sessionStorage.clear();vi.clearAllMocks();
  const facts=()=>sql(`SELECT jsonb_agg(jsonb_build_object('id',id,'in',check_in_time,'out',check_out_time,'worked',total_worked_minutes_today,'ot',overtime_minutes) ORDER BY id)
   FROM public.dealer_attendance WHERE id IN('${id(41)}','${id(44)}');`);
  const financial=()=>sql(`SELECT md5(jsonb_build_array((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
   (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bank_ledger x),(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x))::text);`);
  const beforeFacts=facts(),beforeMoney=financial();
  const ctx=context('operator_perform_swing_v2'),hook=renderHook(()=>useManualSwingRecovery(ctx));
  await act(async()=>hook.result.current.performSwingForTable(ctx.assignments[0].id));
  const retained=stored();expect(retained.assignment_id).toBe(fixture.assignment.id);expect(hook.result.current.pending).toEqual(retained);
  const receipt=invoke('get_dealer_manual_swing_receipt_v1',manualSwingReaderArgs(retained));
  expect(receipt.status).toBe('receipt_found');expect(receipt.response.rotation_schedule_id).toBe(fixture.schedule);expect(receipt.response.rotation_completion).toBe('executed');
  expect(ctx.onSettled).not.toHaveBeenCalled();expect(toast.success).not.toHaveBeenCalled();hook.unmount();
  const closed=JSON.parse(sql(`BEGIN;${auth(id(1))}SELECT public.operator_close_club_table_v2('${fixture.session}',1,'${crypto.randomUUID()}');COMMIT;`));expect(closed.closed).toBe(true);
  ctx.assignments=[];ctx.rpc.mockClear();const remount=renderHook(()=>useManualSwingRecovery(ctx));
  expect(remount.result.current.pending).toEqual(retained);expect(ctx.rpc).not.toHaveBeenCalled();
  await act(async()=>remount.result.current.reconcile());
  expect(ctx.rpc.mock.calls.map(c=>c[0])).toEqual(['get_dealer_manual_swing_receipt_v1']);
  expect(ctx.rpc.mock.calls[0][1]).toEqual(manualSwingReaderArgs(retained));expect(sessionStorage.getItem(key)).toBeNull();
  expect(toast.success).toHaveBeenCalledOnce();expect(ctx.onSettled).toHaveBeenCalledOnce();
  expect(sql(`SELECT count(*) FROM public.dealer_assignments WHERE table_session_id='${fixture.session}';`)).toBe('2');
  expect(sql(`SELECT count(*) FROM public.dealer_assignments WHERE table_session_id='${fixture.session}' AND released_at IS NULL;`)).toBe('0');
  expect(sql(`SELECT count(*) FROM public.dealer_swing_operator_requests WHERE club_id='${id(2)}' AND request_id='${retained.request_id}';`)).toBe('1');
  expect(sql(`SELECT status FROM public.dealer_rotation_schedule WHERE id='${fixture.schedule}';`)).toBe('executed');
  expect(facts()).toBe(beforeFacts);expect(financial()).toBe(beforeMoney);
 });
});
