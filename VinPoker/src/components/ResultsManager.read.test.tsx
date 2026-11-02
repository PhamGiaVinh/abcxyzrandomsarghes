import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const {read,scope}=vi.hoisted(()=>({read:vi.fn(),scope:{actor:'existing-test-player',nativeFrom:null as null|((table:string)=>unknown)}}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:(table:string)=>scope.nativeFrom?scope.nativeFrom(table):({select:()=>({eq:()=>({order:read})})})}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:scope.actor}})}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('./ProofUploader',()=>({ProofUploader:()=>null}));
import {ResultsManager} from './ResultsManager';
afterEach(cleanup);beforeEach(()=>read.mockReset());
describe('ResultsManager read failure recovery',()=>{
 const valid={id:'result-read-fixture',tournament_name:'Existing result fixture',event_date:'2026-10-28',buy_in:200000,prize:100000,venue:null,position:8,total_entries:15,proof_url:null,verified_by_admin:true};
 it.each([null,{...valid,prize:null},{...valid,buy_in:'200000'},{...valid,tournament_name:{label:'broken'}}])('rejects an unreadable row instead of crashing or displaying invented amounts: %j',async(row)=>{
  read.mockResolvedValueOnce({data:[row],error:null}).mockResolvedValueOnce({data:[valid],error:null});
  render(<ResultsManager/>);await waitFor(()=>expect(screen.getByRole('alert')).toBeTruthy());expect(screen.queryByText('results.empty')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Thử tải lại'}));await waitFor(()=>expect(screen.getByText(valid.tournament_name)).toBeTruthy());
  expect(screen.getByText('-100.000')).toBeTruthy();expect(screen.queryByRole('alert')).toBeNull();
 });
 it.each([{data:null,error:{message:'transport unavailable'}},{data:null,error:null}])('does not report an unreadable result list as empty: %j',async(response)=>{
  read.mockResolvedValueOnce(response).mockResolvedValueOnce({data:[],error:null});render(<ResultsManager/>);
  await waitFor(()=>expect(screen.getByRole('alert')).toBeTruthy());expect(screen.queryByText('results.empty')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Thử tải lại'}));await waitFor(()=>expect(screen.getByText('results.empty')).toBeTruthy());expect(read).toHaveBeenCalledTimes(2);
 });
 it('shows loading rather than an empty history until the read settles',async()=>{
  let finish!:(value:unknown)=>void;read.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));render(<ResultsManager/>);
  expect(screen.queryByText('results.empty')).toBeNull();expect(screen.getByRole('status').textContent).toContain('Đang tải');
  await act(async()=>finish({data:[],error:null}));expect(screen.getByText('results.empty')).toBeTruthy();
 });
 it('catches rejected reads and allows an explicit retry',async()=>{
  read.mockRejectedValueOnce(new Error('network failure')).mockResolvedValueOnce({data:[],error:null});render(<ResultsManager/>);
  await waitFor(()=>expect(screen.getByRole('alert')).toBeTruthy());fireEvent.click(screen.getByRole('button',{name:'Thử tải lại'}));
  await waitFor(()=>expect(screen.getByText('results.empty')).toBeTruthy());
 });
});

// Actual SDK and guarded native reads; fetch/Auth remain modeled, no browser claim.
describe.skipIf(process.env.VINPOKER_RESULTS1221_NATIVE!=='1')('ResultsManager native SDK recovery',()=>{
 it('recovers a failed read to existing native rows without a writer',async()=>{
  const {execFileSync}=await import('node:child_process');
  const {createClient}=await import('@supabase/supabase-js');
  const {writeFileSync,existsSync}=await import('node:fs');
  const output=process.env.VINPOKER_RESULTS1223_NATIVE==='1'?'D:/Quy trình/output/reports/results1223-native-sdk-recovery-local-20261028.json':'D:/Quy trình/output/reports/results1221-native-sdk-recovery-local-20261028.json';
  expect(existsSync(output)).toBe(false);
  const guard=`DO $$ BEGIN ASSERT current_database()='vinpoker_ranking860_local'; ASSERT host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441; ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data'; ASSERT (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948'; ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink')); END $$;`;
  const sql=(statement:string)=>JSON.parse(execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:'BEGIN READ ONLY;'+guard+statement+';ROLLBACK;',encoding:'utf8',timeout:20000}));
  const fingerprint=()=>sql("SELECT to_jsonb(md5(coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text FROM public.player_results x),'')))");
  const before=fingerprint();
  const actor=sql("SELECT to_jsonb(player_id::text) FROM public.player_results WHERE verified_by_admin=true ORDER BY player_id LIMIT 1");
  expect(actor).toMatch(/^[a-f0-9-]{36}$/);scope.actor=actor;
  const auth=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
  const query=`SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY event_date DESC),'[]') FROM public.player_results x WHERE player_id='${actor}'::uuid`;
  const oracle=sql(auth+query);expect(oracle.length).toBeGreaterThan(0);let requests=0,faults=0,failing=true;
  const client=createClient('http://127.0.0.1:54329','LOCAL_TEST_ONLY',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init)=>{
   const url=new URL(String(input));expect(init?.method??'GET').toBe('GET');expect(url.pathname).toBe('/rest/v1/player_results');expect(url.searchParams.get('player_id')).toBe('eq.'+actor);expect(url.searchParams.get('select')).toBe('*');expect(url.searchParams.get('order')).toBe('event_date.desc');requests++;
   if(failing){faults++;return new Response(JSON.stringify({message:'LOCAL1221_READ_FAILURE'}),{status:503,headers:{'Content-Type':'application/json'}});}
   return new Response(JSON.stringify(sql(auth+query)),{status:200,headers:{'Content-Type':'application/json'}});
  }}});
  scope.nativeFrom=table=>client.from(table);
  try{
   render(<ResultsManager/>);await waitFor(()=>expect(screen.getByRole('alert')).toBeTruthy(),{timeout:15000});expect(screen.queryByText('results.empty')).toBeNull();failing=false;
   fireEvent.click(screen.getByRole('button',{name:'Thử tải lại'}));await waitFor(()=>expect(screen.getAllByText(oracle[0].tournament_name).length).toBeGreaterThan(0));
   expect(screen.queryByRole('alert')).toBeNull();expect(requests).toBe(faults+1);expect(faults).toBeGreaterThan(0);const after=fingerprint();expect(after).toBe(before);
   writeFileSync(output,JSON.stringify({kind:'ACTUAL_COMPONENT_SDK_NATIVE_READ_MODELED_FETCH_NOT_BROWSER_OR_MANAGED_AUTH',actor,nativeRows:oracle.length,requests,faults,before,after,unchanged:true,writers:0},null,2));
  }finally{scope.nativeFrom=null;scope.actor='existing-test-player';}
 },30000);
});
