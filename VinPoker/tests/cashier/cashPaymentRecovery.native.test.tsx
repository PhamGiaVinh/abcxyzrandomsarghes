import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import type {CashPaymentIntent} from '@/lib/cashPaymentIntent';
const h=vi.hoisted(()=>({adapterRequest:undefined as unknown as <T>(run:()=>Promise<T>,signal?:AbortSignal)=>Promise<T>&{abortSignal(next:AbortSignal):Promise<T>},actor:'',club:'',tour:'',registration:'',reference:'',beforeRecord:false,dropRecord:false,dropCancel:false,
  errors:[] as string[],calls:[] as Array<{name:string;args:Record<string,unknown>;data:unknown}>,
  rpc:undefined as unknown as (name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:unknown}>,
  read:undefined as unknown as (table:string,columns:string,filters:string[],single:boolean,limit:number)=>Promise<{data:unknown;error:unknown}>}));
const enabled=process.env.VINPOKER_NATIVE_CASH_UI==='1';
const quote=(v:unknown)=>v===null?'NULL':`'${String(v).replaceAll("'","''")}'`;
function sql(query:string){const flags=['-w','-X','-qAt','-v','ON_ERROR_STOP=1'];return(process.platform==='win32'
 ?execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash112_ui','psql',...flags],{input:query,encoding:'utf8',timeout:15000,stdio:['pipe','pipe','pipe']})
 :execFileSync('psql',flags,{input:query,encoding:'utf8',timeout:15000,stdio:['pipe','pipe','pipe']})).trim();}
const auth=()=>`SET request.jwt.claim.sub='${h.actor}';SET request.jwt.claim.role='authenticated';SET request.jwt.claims='{"role":"authenticated","sub":"${h.actor}"}';SET ROLE authenticated;`;
const rpcTypes:Record<string,Record<string,string>>={
 resolve_cashier_cash_buyin_intent_v1:{p_intent:'jsonb',p_action:'text'},
 cashier_tour_worklist_v1:{p_club_id:'uuid',p_tournament_id:'uuid',p_query:'text',p_bucket:'text',p_page:'integer',p_limit:'integer'},
 cashier_tour_issues_v1:{p_club_id:'uuid',p_tournament_id:'uuid'},cashier_shift_summary_v1:{p_shift_id:'uuid'},
};
vi.mock('@/integrations/supabase/SupabaseClientContext',()=>{
 // Model the abortable SDK read shape while keeping the real SQL seam. An
 // aborted scope cannot launch a deferred read or deliver a stale response.
 const request=<T,>(run:()=>Promise<T>,initialSignal?:AbortSignal)=>{
  let signal=initialSignal;
  const check=()=>{if(signal?.aborted)throw new DOMException('Read aborted','AbortError');};
  const result=Promise.resolve().then(()=>{check();return run();}).then(value=>{check();return value;});
  return Object.assign(result,{abortSignal(next:AbortSignal){signal=next;return result;}});
 };
 h.adapterRequest=request;
 const client={rpc:(name:string,args:Record<string,unknown>)=>request(()=>h.rpc(name,args)),from:(table:string)=>{
  let columns='',filters:string[]=[],signal:AbortSignal|undefined;const query={select:(s:string)=>{columns=s;return query;},
   eq:(k:string,v:unknown)=>{if(!/^[a-z_]+$/.test(k))throw Error('bad column');filters.push(`${k}=${quote(v)}`);return query;},
   is:(k:string,v:unknown)=>{if(!/^[a-z_]+$/.test(k)||v!==null)throw Error('bad is');filters.push(`${k} IS NULL`);return query;},
   not:(k:string,op:string,v:unknown)=>{if(!/^[a-z_]+$/.test(k)||op!=='is'||v!==null)throw Error('bad not');filters.push(`${k} IS NOT NULL`);return query;},
   order:()=>query,abortSignal:(next:AbortSignal)=>{signal=next;return query;},
   limit:(n:number)=>request(()=>h.read(table,columns,filters,false,n),signal),
   maybeSingle:()=>request(()=>h.read(table,columns,filters,true,2),signal)};return query;
 }};return {useSupabaseClient:()=>client};
});
const session={access_token:'TEST-only-native-cash-session'};
vi.mock('@/ops/auth/OpsAuthProvider',()=>({useOpsAuth:()=>({user:{id:h.actor},session,loading:false})}));
vi.mock('@/ops/auth/OpsCapabilityProvider',()=>({useOpsCapabilities:()=>({loading:false,scopeError:null,isSuperAdmin:false,cashierClubIds:[h.club],clubs:[{id:h.club,name:'Native Cash TEST'}]})}));
vi.mock('@/ops/workspace/OpsWorkspaceProvider',()=>({useOpsWorkspace:()=>({selectedClubId:h.club})}));
vi.mock('@/lib/featureFlags',async original=>({...await original<typeof import('@/lib/featureFlags')>(),OPS_TOUR_CASHIER_ENABLED:true}));
vi.mock('@/components/tournament/seat/SeatReceiptDialog',()=>({SeatReceiptDialog:()=>null}));
import TourCashierWorkbench from '@/pages/ops/TourCashierWorkbench';
describe('native cashier abortable transport seam',()=>{
 it('does not launch a read for an already aborted scope',async()=>{
  const controller=new AbortController();controller.abort();const run=vi.fn().mockResolvedValue({data:'stale'});
  await expect(h.adapterRequest(run,controller.signal)).rejects.toMatchObject({name:'AbortError'});expect(run).not.toHaveBeenCalled();
 });
 it('rejects a response arriving after the read scope was aborted',async()=>{
  const controller=new AbortController();let release!:(value:unknown)=>void;
  const result=h.adapterRequest(()=>new Promise(resolve=>{release=resolve;}),controller.signal);
  await Promise.resolve();controller.abort();release({data:'stale'});
  await expect(result).rejects.toMatchObject({name:'AbortError'});
 });
 it('executes one uncancelled request for multiple observers',async()=>{
  const run=vi.fn().mockResolvedValue({data:'one result'}),result=h.adapterRequest(run);
  await expect(Promise.all([result,result])).resolves.toEqual([{data:'one result'},{data:'one result'}]);expect(run).toHaveBeenCalledOnce();
 });
});
const journal=()=>JSON.parse(localStorage.getItem(`vp:cash-payment:v1:${h.actor}:${h.club}`)!);
const money=()=>JSON.parse(sql(`SELECT jsonb_build_object('ids',coalesce(jsonb_agg(id ORDER BY id),'[]'),'amount',coalesce(sum(amount),0)) FROM public.cashier_buyin_movements WHERE registration_id='${h.registration}';`));
async function pay(amount=10000){fireEvent.click(await screen.findByRole('button',{name:new RegExp(h.reference)}));fireEvent.change(screen.getByRole('textbox',{name:'Nhận tiền mặt (VND)'}),{target:{value:String(amount)}});await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Ghi nhận tiền mặt'}));});}
describe.skipIf(!enabled)('Cashier rendered UI with actual112 PostgreSQL receipts (not HTTP/browser)',()=>{
 beforeAll(()=>{
  expect(process.env.PGHOST).toBe('127.0.0.1');expect(process.env.PGPORT).toBe('55441');expect(process.env.PGUSER).toBe('postgres');expect(process.env.PGDATABASE).toBe('vinpoker_ops_cash112_ui');
  for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])expect(process.env[key]).toBeFalsy();
  expect(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('server_version_num')::int/10000;")).toBe('vinpoker_ops_cash112_ui|127.0.0.1|55441|17');
  const dir=sql('SHOW data_directory');expect(dir==='/tmp/vinpoker-sol-local-20261016-0e79a729/data'||process.env.GITHUB_ACTIONS==='true'&&dir==='/var/lib/postgresql/data').toBe(true);
  expect(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');")).toBe('f');
  // Local-only transport sink: preserve the notification insert/trigger, never
  // contact real recipients. This is NOT verification of pg_net or push delivery.
  sql(`CREATE SCHEMA IF NOT EXISTS net;
   CREATE TABLE IF NOT EXISTS net.cash_ui_http_sink(id bigserial PRIMARY KEY,url text,body jsonb,headers jsonb);
   REVOKE ALL ON SCHEMA net FROM PUBLIC,anon,authenticated,service_role;
   CREATE OR REPLACE FUNCTION net.http_post(url text,body jsonb DEFAULT '{}'::jsonb,params jsonb DEFAULT '{}'::jsonb,headers jsonb DEFAULT '{}'::jsonb,timeout_milliseconds integer DEFAULT 1000)
   RETURNS bigint LANGUAGE sql AS 'INSERT INTO net.cash_ui_http_sink(url,body,headers) VALUES($1,$2,$4) RETURNING id';`);
 });
 beforeEach(()=>{
  h.calls=[];h.errors=[];h.beforeRecord=false;h.dropRecord=false;h.dropCancel=false;localStorage.clear();sessionStorage.clear();
  const table='cash_ui_'+crypto.randomUUID().replaceAll('-','');sql(`CREATE TABLE public.${table}(intent jsonb);REVOKE ALL ON public.${table} FROM PUBLIC,anon,authenticated,service_role;`);
  const source=readFileSync('tests/cashier/cashPaymentIdentity.pg17.sql','utf8').replace(/CREATE FUNCTION pg_temp.fail_cash_receipt[\s\S]*?FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_cash_receipt\(\);/,'');
  const marker=' -- CASH112_CONCURRENCY_FIXTURE_READY';expect(source.split(marker)).toHaveLength(2);
  sql(source.replace(marker,` PERFORM set_config('role','none',true);INSERT INTO public.${table}(intent) VALUES(jsonb_build_object('actor_id',owner_id,'club_id',club,'tournament_id',tour,'registration_id',registration));RETURN;\n`+marker).replace(/ROLLBACK;\s*$/,'COMMIT;'));
  const fixture=JSON.parse(sql(`SELECT intent FROM public.${table};`));h.actor=fixture.actor_id;h.club=fixture.club_id;h.tour=fixture.tournament_id;h.registration=fixture.registration_id;
  h.reference=sql(`SELECT reference_code FROM public.tournament_registrations WHERE id='${h.registration}';`);
  sessionStorage.setItem(`cashier-tour:${h.club}`,h.tour);
  const tails=new Map<string,Promise<unknown>>();Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(name:string,cb:()=>unknown)=>{const next=(tails.get(name)??Promise.resolve()).catch(()=>{}).then(cb);tails.set(name,next);return next;}}});
  h.read=async(table,columns,filters,single,limit)=>{
   try{if(!['tournaments','cashier_till_shifts','cashier_refund_requests'].includes(table)||!/^\w+(,\w+)*$/.test(columns)||!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('unexpected read contract');
    const rows=JSON.parse(sql(auth()+`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (SELECT ${columns} FROM public.${table} WHERE ${filters.join(' AND ')||'true'} LIMIT ${limit}) x;`));
    if(single&&rows.length>1)throw Error('multiple maybeSingle rows');return {data:single?rows[0]??null:rows,error:null};
   }catch(e){h.errors.push(String(e));return {data:null,error:{message:String(e)}};}
  };
  h.rpc=async(name,args)=>{
   try{const types=rpcTypes[name];if(!types||Object.keys(args).some(k=>!types[k]))throw Error('unexpected RPC '+name);
    if(name==='resolve_cashier_cash_buyin_intent_v1'&&args.p_action==='record'&&h.beforeRecord){h.calls.push({name,args,data:null});return {data:null,error:{message:'injected pre-request transport failure'}};}
    const values=Object.entries(args).map(([k,v])=>`${k}=>${quote(types[k]==='jsonb'?JSON.stringify(v):v)}::${types[k]}`);
    const data=JSON.parse(sql(auth()+`SELECT public.${name}(${values.join(',')});`));h.calls.push({name,args,data});
    if(name==='resolve_cashier_cash_buyin_intent_v1'&&(args.p_action==='record'&&h.dropRecord||args.p_action==='cancel'&&h.dropCancel))return {data:null,error:{message:'injected response loss AFTER real COMMIT'}};
    return {data,error:null};
   }catch(e){h.errors.push(String(e));return {data:null,error:{message:String(e)}};}
  };
 });
 afterEach(()=>{cleanup();expect(h.errors).toEqual([]);});
 it('recovers a lost committed partial payment after remount with one immutable movement',async()=>{
  h.dropRecord=true;const view=render(<MemoryRouter><TourCashierWorkbench/></MemoryRouter>);await pay();
  await screen.findByText(/Chưa xác minh được khoản thu trước/);const intent=journal().intent as CashPaymentIntent,committed=money();
  expect(committed.amount).toBe(10000);expect(committed.ids).toHaveLength(1);expect(journal().state).toBe('pending');
  await waitFor(()=>expect(screen.getByRole('button',{name:'Kiểm tra khoản thu trước'})).toBeEnabled());view.unmount();render(<MemoryRouter><TourCashierWorkbench/></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button',{name:'Kiểm tra khoản thu trước'}));
  await screen.findByText(/Đã xác minh khoản thu 10.000 VND/);expect(journal().state).toBe('settled');expect(money()).toEqual(committed);
  const attempts=h.calls.filter(c=>c.name==='resolve_cashier_cash_buyin_intent_v1');expect(attempts.map(c=>c.args.p_action)).toEqual(['record','read']);for(const call of attempts)expect(call.args.p_intent).toEqual(intent);
 });
 it('cancels a never-received request and fences both legacy and exact delayed writers',async()=>{
  h.beforeRecord=true;render(<MemoryRouter><TourCashierWorkbench/></MemoryRouter>);await pay();await screen.findByText(/Chưa xác minh được khoản thu trước/);const intent=journal().intent as CashPaymentIntent;
  await waitFor(()=>expect(screen.getByRole('button',{name:'Đóng yêu cầu chưa ghi nhận'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Đóng yêu cầu chưa ghi nhận'}));
  await screen.findByText(/Đã đóng yêu cầu chưa ghi nhận/);expect(money()).toEqual({ids:[],amount:0});expect(journal().state).toBe('settled');
  const legacy=JSON.parse(sql(auth()+`SELECT public.cashier_record_cash_buyin_v1('${h.registration}',10000,'${intent.request_id}');`));expect(legacy.error).toBe('cash_intent_cancelled');
  h.beforeRecord=false;const late=await h.rpc('resolve_cashier_cash_buyin_intent_v1',{p_intent:intent,p_action:'record'});expect((late.data as {status:string}).status).toBe('cancelled');expect(money()).toEqual({ids:[],amount:0});
 });
 it('recovers a lost cancellation receipt by reading, not by issuing a new payment',async()=>{
  h.beforeRecord=true;h.dropCancel=true;const view=render(<MemoryRouter><TourCashierWorkbench/></MemoryRouter>);await pay();await screen.findByText(/Chưa xác minh được khoản thu trước/);
  await waitFor(()=>expect(screen.getByRole('button',{name:'Đóng yêu cầu chưa ghi nhận'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Đóng yêu cầu chưa ghi nhận'}));
  await screen.findByText(/Chưa xác minh được khoản thu trước/);await waitFor(()=>expect(screen.getByRole('button',{name:'Kiểm tra khoản thu trước'})).toBeEnabled());expect(journal().state).toBe('pending');
  view.unmount();render(<MemoryRouter><TourCashierWorkbench/></MemoryRouter>);fireEvent.click(await screen.findByRole('button',{name:'Kiểm tra khoản thu trước'}));await screen.findByText(/Đã đóng yêu cầu chưa ghi nhận/);
  expect(money()).toEqual({ids:[],amount:0});expect(journal().state).toBe('settled');
  expect(h.calls.filter(c=>c.name==='resolve_cashier_cash_buyin_intent_v1').map(c=>c.args.p_action)).toEqual(['record','cancel','read']);
 });
 it('keeps a fully paid registration waiting when there is no operational table',async()=>{
  render(<MemoryRouter><TourCashierWorkbench/></MemoryRouter>);await pay(100000);await screen.findByText(/Đã xác minh khoản thu 100.000 VND/);
  expect(money().amount).toBe(100000);expect(money().ids).toHaveLength(1);expect(journal().state).toBe('settled');
  const call=h.calls.find(c=>c.name==='resolve_cashier_cash_buyin_intent_v1')!;
  expect(call.data).toMatchObject({ok:true,status:'recorded',result:{ok:true,payment_state:'paid',seating_state:'waiting'}});
  expect(sql(`SELECT cashier_paid_at IS NOT NULL FROM public.tournament_registrations WHERE id='${h.registration}';`)).toBe('t');
  expect(sql(`SELECT count(*) FROM public.tournament_seats WHERE tournament_id='${h.tour}' AND is_active;`)).toBe('0');
  const tables=sql(`INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
    SELECT gen_random_uuid(),'${h.club}','Paid journey TEST '||n,n,'tournament','inactive','available' FROM generate_series(1,2) n RETURNING id;`).split('\n').filter(Boolean);
  for(const table of tables){const opened=JSON.parse(sql(auth()+`SELECT public.floor_open_tournament_table_v3('${h.tour}','${table}','manual',gen_random_uuid());`));expect(opened.ok).toBe(true);}
  // Exact-target internal seating core, not the global scheduler/Edge dispatcher.
  const seat=()=>JSON.parse(sql(`SET request.jwt.claim.sub='${h.actor}';SET request.jwt.claim.role='authenticated';SET request.jwt.claims='{"sub":"${h.actor}","role":"authenticated"}';SELECT public.cashier_try_seat_paid_v1('${h.registration}','${h.actor}');`));
  const seated=seat();expect(seated).toMatchObject({ok:true,payment_state:'paid',seating_state:'seated'});
  const identity=()=>sql(`SELECT jsonb_agg(jsonb_build_object('entry',e.id,'seat',s.id,'receipt',r.id,'session',s.table_session_id,'chips',s.chip_count) ORDER BY e.id)
   FROM public.tournament_entries e JOIN public.tournament_seats s ON s.entry_id=e.id AND s.is_active
   JOIN public.tournament_tables t ON t.id=s.tournament_table_id AND t.table_session_id=s.table_session_id
   JOIN public.table_sessions x ON x.id=s.table_session_id AND x.game_table_id=t.game_table_id AND x.closed_at IS NULL
   JOIN public.seat_draw_receipts r ON r.registration_id=e.registration_id AND r.entry_id=e.id AND r.seat_id=s.id
   WHERE e.registration_id='${h.registration}';`);
  const current=identity(),rows=JSON.parse(current);expect(rows).toHaveLength(1);expect(rows[0].chips).toBe(20000);
  const ticket=JSON.parse(sql(auth()+`SELECT public.get_floor_seat_ticket_v1('${h.tour}','${seated.entry_id}','${seated.receipt_code}');`));
  expect(ticket.ok).toBe(true);
  expect(seat()).toMatchObject({ok:true,already_confirmed:true});expect(identity()).toBe(current);
  expect(money().amount).toBe(100000);expect(money().ids).toHaveLength(1);
  fireEvent.click(screen.getByRole('button',{name:/Đã tự hoàn tất/}));
  fireEvent.click(await screen.findByRole('button',{name:new RegExp(h.reference)}));
  await screen.findByText(/Đã cấp phiếu · bàn/);
  expect(screen.queryByRole('button',{name:'Ghi nhận tiền mặt'})).not.toBeInTheDocument();
 });
});
