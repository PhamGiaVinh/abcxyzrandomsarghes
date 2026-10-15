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
const enabled=process.env.VINPOKER_NATIVE_SWING_UI==="1";
const id=(n:number)=>`e1800000-0000-4000-8000-${String(n).padStart(12,"0")}`;
function sql(query:string):string {
  const flags=["-X","-qAt","-v","ON_ERROR_STOP=1"];
  const output=process.platform==="win32"
    ?execFileSync("wsl",["-d","PokerVision-P16-4C-Eval","--","env","PGHOST=127.0.0.1","PGPORT=55441",
      "PGUSER=postgres","PGDATABASE=vinpoker_ops_swing101_ui","psql",...flags],{input:query,encoding:"utf8",timeout:15000,stdio:["pipe","pipe","pipe"]})
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
    expect(process.env.PGUSER).toBe("postgres");expect(process.env.PGDATABASE).toBe("vinpoker_ops_swing101_ui");
    for(const key of ["PGHOSTADDR","PGSERVICE","PGSERVICEFILE","PGOPTIONS"])expect(process.env[key]).toBeFalsy();
    expect(sql("SELECT current_database()||'|'||inet_server_port()||'|'||current_setting('server_version_num')::int/10000;"))
      .toBe("vinpoker_ops_swing101_ui|55441|17");
    const dir=sql("SHOW data_directory");
    expect(dir==="/tmp/vinpoker-sol-local-20261016-0e79a729/data"||process.env.GITHUB_ACTIONS==="true"&&dir==="/var/lib/postgresql/data").toBe(true);
    expect(sql(`SELECT md5(replace(pg_get_functiondef('public.operator_perform_swing(uuid,uuid,uuid,integer,uuid)'::regprocedure),chr(13),''));`))
      .toBe("a25a91e02d6f2c0399e5aba1086e4acf");
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
