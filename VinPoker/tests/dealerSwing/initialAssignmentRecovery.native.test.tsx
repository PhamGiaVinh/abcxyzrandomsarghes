import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import ts from "typescript";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {ManualAssignmentRecovery} from "@/components/cashier/dealer-swing/ManualAssignmentRecovery";
import {initialAssignmentKey,type InitialAssignmentIntent} from "@/lib/dealerInitialAssignmentIntent";

// Actual component -> actual Edge handler -> actual PG17 RPC. Only Auth-user
// discovery and psql transport replace HTTP; no fabricated receipt/status data.
const enabled=process.env.VINPOKER_NATIVE_INITIAL_UI==="1";
const actor="e1800000-0000-4000-8000-000000000001",club="e1800000-0000-4000-8000-000000000002";
function sql(query:string){
  const flags=["-X","-qAt","-v","ON_ERROR_STOP=1","-v","VERBOSITY=verbose"];
  const options={input:query,encoding:"utf8" as const,timeout:15000,stdio:["pipe","pipe","pipe"] as ["pipe","pipe","pipe"]};
  return (process.platform==="win32"?execFileSync("wsl",["-d","PokerVision-P16-4C-Eval","--","env","PGHOST=127.0.0.1","PGPORT=55441","PGUSER=postgres","PGDATABASE=vinpoker_ops_initial102_ui","psql",...flags],options)
    :execFileSync("psql",flags,options)).trim();
}
const signatures:Record<string,string[]>={
  is_club_dealer_control:["_user_id","_club_id"],
  worker_read_initial_assignment_receipt_v1:["p_request_key","p_club_id","p_table_id","p_table_session_id","p_dealer_id"],
  resolve_dealer_initial_assignment_intent_v1:["p_actor_user_id","p_club_id","p_table_id","p_table_session_id","p_dealer_id","p_request_id"],
};
function rpc(name:string,args:Record<string,unknown>,uid:string){
  const fields=signatures[name];if(!fields||fields.length!==Object.keys(args).length||fields.some(k=>!(k in args)))throw new Error("unexpected native read RPC");
  const params=fields.map(field=>{
    const value=args[field];if(typeof value!=="string"||!(field==="p_request_key"?/^open_manual_[a-f0-9-]{36}_[a-f0-9-]{36}$/i:/^[a-f0-9-]{36}$/i).test(value))throw new Error("invalid native read argument");
    return `${field}=>'${value}'::${field==="p_request_key"?"text":"uuid"}`;
  });
  const service=`SET request.jwt.claim.role='service_role';SET request.jwt.claims='{"role":"service_role"}';SET request.headers='{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"${uid}"}';SET ROLE service_role;`;
  return JSON.parse(sql(service+`SELECT coalesce(to_jsonb(public.${name}(${params.join(",")})),'null'::jsonb);`));
}
function transport(uid=actor){
  const source=readFileSync("supabase/functions/assign-dealer/index.ts","utf8").replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,"");
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  let handler:((r:Request)=>Promise<Response>)|undefined;
  const calls:{name:string;args:Record<string,unknown>}[]=[];
  runInNewContext(code,{Request,Response,console:{log(){},warn(){},error(){}},corsHeaders:{},
    authenticateUser:async()=>({uid}),manualDealerIntentHeaders:()=>({}),
    Deno:{env:{get:(key:string)=>({SUPABASE_URL:"https://synthetic.invalid",SUPABASE_SERVICE_ROLE_KEY:"synthetic-service"})[key]},serve:(fn:typeof handler)=>{handler=fn;}},
    createClient:()=>({from:()=>{throw new Error("read-only native test entered a table/write branch");},rpc:async(name:string,args:Record<string,unknown>)=>{
      calls.push({name,args});try{return {data:rpc(name,args,uid),error:null};}catch(e){
        const stderr=e&&typeof e==="object"&&"stderr" in e?String(e.stderr):"";
        const pg=stderr.match(/ERROR:\s+([A-Z0-9]{5}):\s*([^\r\n]+)/);
        return {data:null,error:{code:pg?.[1],message:pg?.[2]??(e instanceof Error?e.message:String(e))}};
      }
    }}),
  });
  if(!handler)throw new Error("Edge handler missing");const serve=handler;
  const invoke=vi.fn(async(body:Record<string,unknown>)=>{
    const response=await serve(new Request("https://synthetic.invalid/functions/v1/assign-dealer",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}));
    const data=await response.json();return response.ok?{data,error:null}:{data:null,error:{message:String(data.error)}};
  });
  return {invoke,calls};
}
function fixture(index:number,kind:"missing"|"committed"|"legacy"):InitialAssignmentIntent {
  const c=JSON.parse(sql(`SELECT jsonb_build_object('table',g.id,'session',s.id,'dealer',d.id) FROM public.game_tables g
   JOIN public.table_sessions s ON s.game_table_id=g.id JOIN public.dealers d ON d.club_id=g.club_id AND d.full_name='Initial102 TEST ${index}'
   WHERE g.club_id='${club}' AND g.table_name='Initial102 TEST ${index}';`));
  const request=kind==="missing"?crypto.randomUUID():sql(kind==="committed"
    ?`SELECT right(request_key,36) FROM floor_private.dealer_initial_assign_receipts WHERE payload->>'table'='${c.table}';`
    :`SELECT right(idempotency_key,36) FROM public.dealer_assignments WHERE table_id='${c.table}' AND idempotency_key LIKE 'open_manual_%';`);
  return {expected_actor_id:actor,expected_club_id:club,table_id:c.table,table_session_id:c.session,force_dealer_id:c.dealer,idempotency_key:request};
}
const state=()=>sql(`SELECT md5(jsonb_build_object('assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_assignments a),
 'attendance',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_attendance a),
 'receipts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.request_key) FROM floor_private.dealer_initial_assign_receipts a),
 'sessions',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.table_sessions a))::text);`);
describe.skipIf(!enabled)("initial assignment actual UI/Edge/native resolution",()=>{
  beforeAll(()=>{
    expect(process.env.PGHOST).toBe("127.0.0.1");expect(process.env.PGPORT).toBe("55441");expect(process.env.PGUSER).toBe("postgres");expect(process.env.PGDATABASE).toBe("vinpoker_ops_initial102_ui");
    for(const k of ["PGHOSTADDR","PGSERVICE","PGSERVICEFILE","PGOPTIONS"])expect(process.env[k]).toBeFalsy();
    expect(sql("SELECT current_database()||'|'||inet_server_port()||'|'||current_setting('server_version_num')::int/10000;")).toBe("vinpoker_ops_initial102_ui|55441|17");
    const dir=sql("SHOW data_directory");expect(dir==="/tmp/vinpoker-sol-local-20261016-0e79a729/data"||process.env.GITHUB_ACTIONS==="true"&&dir==="/var/lib/postgresql/data").toBe(true);
    expect(rpc("is_club_dealer_control",{_user_id:actor,_club_id:club},actor)).toBe(true);
  });
  beforeEach(()=>sessionStorage.clear());afterEach(cleanup);
  it("plain missing holds; only the real closed-session resolver unlocks obsolete intent",async()=>{
    const i=fixture(2,"missing"),before=state(),t=transport(),onSettled=vi.fn();sessionStorage.setItem(initialAssignmentKey(i),i.idempotency_key);
    render(<ManualAssignmentRecovery actorId={actor} clubId={club} revision={0} blocked={false} invoke={t.invoke} onSettled={onSettled}/>);
    expect(t.invoke).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button",{name:"Đối chiếu yêu cầu gán"}));await screen.findByText(/Chưa có kết quả xác nhận/);
    expect(sessionStorage.getItem(initialAssignmentKey(i))).toBe(i.idempotency_key);fireEvent.click(screen.getByRole("button",{name:"Kiểm tra hiệu lực phiên cũ"}));
    await waitFor(()=>expect(onSettled).toHaveBeenCalledWith(i,"obsolete"));expect(sessionStorage.getItem(initialAssignmentKey(i))).toBeNull();expect(state()).toBe(before);
    expect(t.calls.map(c=>c.name)).toEqual(["is_club_dealer_control","worker_read_initial_assignment_receipt_v1","is_club_dealer_control","resolve_dealer_initial_assignment_intent_v1"]);
  });
  it("a real committed receipt wins after closure, without current table cache",async()=>{
    const i=fixture(0,"committed"),before=state(),t=transport(),onSettled=vi.fn();sessionStorage.setItem(initialAssignmentKey(i),i.idempotency_key);
    render(<ManualAssignmentRecovery actorId={actor} clubId={club} revision={0} blocked={false} invoke={t.invoke} onSettled={onSettled}/>);
    fireEvent.click(screen.getByRole("button",{name:"Kiểm tra hiệu lực phiên cũ"}));await waitFor(()=>expect(onSettled).toHaveBeenCalledWith(i,"committed"));
    expect(sessionStorage.getItem(initialAssignmentKey(i))).toBeNull();expect(state()).toBe(before);
  });
  it("a real legacy assignment with no full receipt remains held",async()=>{
    const i=fixture(3,"legacy"),before=state(),t=transport(),onSettled=vi.fn();sessionStorage.setItem(initialAssignmentKey(i),i.idempotency_key);
    render(<ManualAssignmentRecovery actorId={actor} clubId={club} revision={0} blocked={false} invoke={t.invoke} onSettled={onSettled}/>);
    fireEvent.click(screen.getByRole("button",{name:"Kiểm tra hiệu lực phiên cũ"}));await screen.findByText(/Có dấu gán legacy/);
    expect(sessionStorage.getItem(initialAssignmentKey(i))).toBe(i.idempotency_key);expect(onSettled).not.toHaveBeenCalled();expect(state()).toBe(before);
  });
  it("an open occupied session with a missing request is not treated as obsolete",async()=>{
    const i=fixture(1,"missing"),before=state(),t=transport(),onSettled=vi.fn();sessionStorage.setItem(initialAssignmentKey(i),i.idempotency_key);
    render(<ManualAssignmentRecovery actorId={actor} clubId={club} revision={0} blocked={false} invoke={t.invoke} onSettled={onSettled}/>);
    fireEvent.click(screen.getByRole("button",{name:"Kiểm tra hiệu lực phiên cũ"}));await screen.findByText(/Chưa có kết quả xác nhận/);
    expect(sessionStorage.getItem(initialAssignmentKey(i))).toBe(i.idempotency_key);expect(onSettled).not.toHaveBeenCalled();expect(state()).toBe(before);
  });
  it("real database authority rejects an unrelated actor before private receipt access",async()=>{
    const other="e1800000-0000-4000-8000-000000000099",i={...fixture(2,"missing"),expected_actor_id:other},before=state(),t=transport(other),onSettled=vi.fn();
    sessionStorage.setItem(initialAssignmentKey(i),i.idempotency_key);
    render(<ManualAssignmentRecovery actorId={other} clubId={club} revision={0} blocked={false} invoke={t.invoke} onSettled={onSettled}/>);
    fireEvent.click(screen.getByRole("button",{name:"Kiểm tra hiệu lực phiên cũ"}));await screen.findByText("Forbidden — not a dealer controller");
    expect(t.calls.map(c=>c.name)).toEqual(["is_club_dealer_control"]);expect(sessionStorage.getItem(initialAssignmentKey(i))).toBe(i.idempotency_key);
    expect(onSettled).not.toHaveBeenCalled();expect(state()).toBe(before);
  });
  it("real receipt payload conflict is a hold, not permission to discard",async()=>{
    const i={...fixture(0,"committed"),force_dealer_id:fixture(1,"missing").force_dealer_id},before=state(),t=transport(),onSettled=vi.fn();
    sessionStorage.setItem(initialAssignmentKey(i),i.idempotency_key);
    render(<ManualAssignmentRecovery actorId={actor} clubId={club} revision={0} blocked={false} invoke={t.invoke} onSettled={onSettled}/>);
    fireEvent.click(screen.getByRole("button",{name:"Kiểm tra hiệu lực phiên cũ"}));await screen.findByText("IDEMPOTENCY_CONFLICT");
    expect(sessionStorage.getItem(initialAssignmentKey(i))).toBe(i.idempotency_key);expect(onSettled).not.toHaveBeenCalled();expect(state()).toBe(before);
  });
});
