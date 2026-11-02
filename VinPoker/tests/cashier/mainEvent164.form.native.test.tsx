import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';

// Actual source form -> installed SDK -> existing loopback API -> PG commit.
// Auth context is modeled, not hosted Auth. This is not browser/pixel evidence.
const state=vi.hoisted(()=>({client:null as SupabaseClient|null,rpc:vi.fn(),created:vi.fn()}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'675fe35e-60a8-4452-bb90-e79486d54da6'}})}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:{multiDayTournaments:true,tournamentServiceFee:true,blindTemplates:false}}));
vi.mock('@/components/FomoPrice',()=>({FomoPrice:()=>null}));
vi.mock('@/components/LiveStateEditor',()=>({LiveStateEditor:()=>null}));
vi.mock('@/components/cashier/tournament-live/BlindEditorPanel',()=>({BlindEditorPanel:()=>null}));
vi.mock('@/components/cashier/tournament-live/BlindDraftBuilder',()=>({BlindDraftBuilder:()=>null}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:(name:string,args:Record<string,unknown>)=>state.rpc(name,args)}}));
import {NewTournamentDialog} from '@/components/floor/TournamentManagerShared';
import {tournamentCreateJournalKey} from '@/lib/tournamentCreate';

const sql=(input:string)=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env',
 'PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c',
 'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:30000}).trim();
afterEach(()=>{cleanup();localStorage.clear();});
it.skipIf(process.env.VINPOKER_NATIVE_MAIN_EVENT !== '1')('commits the actual Main Event form shared fee, metadata and one event GTD over HTTP',async()=>{
 assert.equal(process.env.VINPOKER_NATIVE_MAIN_EVENT,'1');
 assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),
  'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
 assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');"),'f');
 const manifest=await (await fetch('http://127.0.0.1:54329/__local/manifest')).json();
 assert.equal(manifest.club,'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760');
 assert.equal(manifest.actor,'675fe35e-60a8-4452-bb90-e79486d54da6');
 const client=createClient('http://127.0.0.1:54329','LOCAL_TEST_ONLY',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 state.client=client;
 const login=await client.auth.signInWithPassword({email:manifest.email,password:'LOCAL_TEST_ONLY'});
 assert.equal(login.error,null);assert.equal(login.data.user?.id,manifest.actor);
 state.rpc.mockImplementation((name,args)=>client.rpc(name,args));
 try{
  render(<NewTournamentDialog clubs={[]} defaultClubId={manifest.club} multiClub={false} lockMode='multi' onCreated={state.created}/>);
  fireEvent.click(screen.getByRole('button',{name:'Create Multi-day'}));
  fireEvent.change(screen.getByPlaceholderText('Main Event'),{target:{value:'Main Event browser local TEST 164'}});
  const dates=screen.getByRole('dialog').querySelectorAll('input[type="datetime-local"]');
  fireEvent.change(dates[0],{target:{value:'2026-10-21T12:00'}});
  fireEvent.change(dates[1],{target:{value:'2026-10-22T12:00'}});
  const change=(label:string,value:string)=>fireEvent.change(screen.getByText(label).nextElementSibling!,{target:{value}});
  change('Flight count (A–K)','2');change('ITM % per flight','15');
  change('Buy-in (VND)','100000');change('Rake / phí giải (VND)','10000');change('Phí dịch vụ (VND)','5000');
  change('mainEventCreate.guaranteeLabel','2500000');change('Location','TEST room A');change('Description','Two TEST flights and a final');
  expect(screen.getByText(/115.000/)).toBeInTheDocument();
  const create=screen.getByRole('button',{name:'Create'});
  act(()=>{fireEvent.click(create);fireEvent.click(create);});
  await waitFor(()=>expect(state.created).toHaveBeenCalledOnce(),{timeout:20000});
  assert.equal(state.rpc.mock.calls.length,1);
  const [name,request]=state.rpc.mock.calls[0];
  assert.equal(name,'create_tournament_event_with_flights_v2');
  assert.match(request.p_request_id,/^[a-f0-9-]{36}$/i);
  const result=JSON.parse(sql(`SELECT result FROM public.table_operation_receipts WHERE actor_id='${manifest.actor}'
   AND operation_type='create_tournament_event_with_flights_v2' AND request_id='${request.p_request_id}';`));
  assert.equal(result.ok,true);assert.match(result.event_id,/^[a-f0-9-]{36}$/i);
  const facts=JSON.parse(sql(`SELECT jsonb_build_object('gtd',e.guarantee_amount,
   'children',(SELECT count(*) FROM public.tournaments t WHERE t.event_id=e.id),
   'matching',(SELECT count(*) FROM public.tournaments t WHERE t.event_id=e.id AND t.buy_in=100000 AND t.rake_amount=10000
    AND t.service_fee_amount=5000 AND t.location='TEST room A' AND t.description='Two TEST flights and a final' AND t.guarantee_amount IS NULL),
   'registrations',(SELECT count(*) FROM public.tournament_registrations r JOIN public.tournaments t ON t.id=r.tournament_id WHERE t.event_id=e.id))
   FROM public.tournament_events e WHERE e.id='${result.event_id}';`));
  assert.deepEqual(facts,{gtd:2500000,children:3,matching:3,registrations:0});
  assert.equal(localStorage.getItem(tournamentCreateJournalKey(manifest.actor,manifest.club,'multi')),null);
  console.log('MAIN_EVENT164_ACTUAL_FORM_SDK_HTTP_PG_COMMIT_PASS_NOT_BROWSER',JSON.stringify({event:result.event_id,final:result.final_tournament_id,request:request.p_request_id,facts}));
 }finally{await client.auth.signOut();}
},30000);
