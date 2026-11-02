import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {afterEach,it,expect,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
const state=vi.hoisted(()=>({client:null as SupabaseClient|null}));
vi.mock('@/integrations/supabase/SupabaseClientContext',()=>({useSupabaseClient:()=>state.client,useSupabaseBackendScope:()=>null}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'675fe35e-60a8-4452-bb90-e79486d54da6'},session:null})}));
vi.mock('@/components/floor/MultiDayInitialDrawPanel',()=>({MultiDayInitialDrawWorkspace:()=>null}));
import {MultiDayFloorEventWorkspace} from '@/components/floor/MultiDayFloorEventPanel';
import {rulesJournalKey} from '@/ops/floor/multiDayRulesIntent';
const event='dbb49f8d-7d47-4c2c-afd9-f57062c9971d',actor='675fe35e-60a8-4452-bb90-e79486d54da6';
const sql=(input:string)=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441',
 'PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:30000}).trim();
afterEach(cleanup);
it.skipIf(process.env.VINPOKER_NATIVE_MAIN_EVENT_RULES !== '1')('locks rules on the browser-created Main Event, retains lost response and reconciles after remount',async()=>{
 assert.equal(process.env.VINPOKER_NATIVE_MAIN_EVENT_RULES,'1');
 assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),
  'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
 assert.equal(sql(`SELECT count(*) FROM public.multi_day_qualification_rules_v1 WHERE event_id='${event}';`),'0','fresh-only test: do not erase a prior commit to rerun');
 const gates=sql("SELECT jsonb_build_array((SELECT to_jsonb(g) FROM public.multi_day_package_release_v1 g WHERE id),(SELECT to_jsonb(g) FROM public.centerpoint_tournament_ops_release g WHERE id));");
 const client=createClient('http://127.0.0.1:54329','LOCAL_TEST_ONLY',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 state.client=client;
 const login=await client.auth.signInWithPassword({email:'native-owner@test.invalid',password:'LOCAL_TEST_ONLY'});
 assert.equal(login.error,null);assert.equal(login.data.user?.id,actor);
 const mount=()=>render(<MultiDayFloorEventWorkspace actorId={actor} sessionEpoch={1} eventId={event} surface='design'/>);
 try{
  mount();await waitFor(()=>expect(screen.getByRole('button',{name:'Lock rules',exact:true})).toBeInTheDocument(),{timeout:15000});
  fireEvent.change(screen.getByLabelText('Bag selection policy'),{target:{value:'SELECT_LARGEST'}});
  fireEvent.change(screen.getByLabelText('Minimum cash multiplier'),{target:{value:'1'}});
  fireEvent.change(screen.getByLabelText('Day2 % per flight'),{target:{value:'100'}});
  const button=screen.getByRole('button',{name:'Lock rules',exact:true});
  await act(async()=>{fireEvent.click(button);fireEvent.click(button);});
  await waitFor(()=>expect(screen.getByText(/Rules outcome is not yet reconciled/)).toBeInTheDocument(),{timeout:15000});
  await waitFor(()=>expect(screen.getByRole('button',{name:'Retry retained rules request'})).toBeEnabled(),{timeout:15000});
  assert.equal(sql(`SELECT count(*) FROM public.multi_day_qualification_rules_v1 WHERE event_id='${event}';`),'1');
  assert.ok(sessionStorage.getItem(rulesJournalKey(actor,event)));
  cleanup();mount();
  await waitFor(()=>expect(screen.getByRole('button',{name:'Retry retained rules request'})).toBeEnabled(),{timeout:15000});
  fireEvent.click(screen.getByRole('button',{name:'Retry retained rules request'}));
  await waitFor(()=>expect(screen.queryByText(/Rules outcome is not yet reconciled/)).not.toBeInTheDocument(),{timeout:15000});
  await waitFor(()=>expect(screen.getByRole('button',{name:'Refresh source'})).toBeEnabled(),{timeout:15000});
  assert.equal(sessionStorage.getItem(rulesJournalKey(actor,event)),null);
  assert.equal(sql("SELECT jsonb_build_array((SELECT to_jsonb(g) FROM public.multi_day_package_release_v1 g WHERE id),(SELECT to_jsonb(g) FROM public.centerpoint_tournament_ops_release g WHERE id));"),gates);
  const rule=JSON.parse(sql(`SELECT jsonb_build_object('policy',policy,'itm',itm_percent,'day2',day2_percent,'minCash',min_cash_x) FROM public.multi_day_qualification_rules_v1 WHERE event_id='${event}';`));
  assert.deepEqual(rule,{policy:'SELECT_LARGEST',itm:15,day2:100,minCash:1});
  console.log('MAIN_EVENT167_LINKED_SOURCE_FORM_SDK_HTTP_RULES_COMMIT_LOSS_REMOUNT_REPLAY_PASS_NOT_BROWSER');
 }finally{cleanup();await client.auth.signOut();}
},45000);
