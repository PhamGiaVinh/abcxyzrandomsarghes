import "@testing-library/jest-dom/vitest";
import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,beforeAll,describe,expect,it,vi} from "vitest";
import {execFileSync} from "node:child_process";
import {createPaidJourneyFixture} from "../cashier/paidJourney.fixture.mjs";
const h=vi.hoisted(()=>{const rpc=vi.fn();return {actor:"",rpc,client:{rpc},success:vi.fn(),error:vi.fn()};});
vi.mock("@/hooks/useAuth",()=>({useAuth:()=>({user:{id:h.actor}})}));
vi.mock("@/integrations/supabase/SupabaseClientContext",()=>({useSupabaseClient:()=>h.client}));
vi.mock("@/lib/featureFlags",()=>({FEATURES:{tvLayoutEditorV1:true}}));
vi.mock("@/components/ProofUploader",()=>({ProofUploader:()=>null}));
vi.mock("sonner",()=>({toast:{success:h.success,error:h.error}}));
import {TvBrandingEditor} from "@/components/cashier/tournament-live/TvBrandingEditor";
const enabled=process.env.VINPOKER_NATIVE_TV_UI==='1',database='vinpoker_ops_cash115_qualified_c';
const prefix=process.platform==='win32'?['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${database}`,'psql']:[];
const sql=(input:string)=>execFileSync(prefix.length?'wsl':'psql',[...prefix,'-w','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],{input,encoding:'utf8',timeout:30_000,stdio:['pipe','pipe','pipe']}).trim();
const quote=(v:unknown)=>`'${(typeof v==='object'?JSON.stringify(v):String(v)).replaceAll("'","''")}'`;
let gateBefore:Record<string,unknown>|undefined;
beforeAll(()=>{globalThis.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};});
afterEach(()=>{cleanup();if(gateBefore){const expected=gateBefore;gateBefore=undefined;
 sql(`UPDATE public.centerpoint_tournament_ops_release SET (enabled,allowed_club_ids,updated_at)=
  (SELECT r.enabled,r.allowed_club_ids,r.updated_at FROM jsonb_populate_record(NULL::public.centerpoint_tournament_ops_release,${quote(expected)}::jsonb) r) WHERE id=true;`);
 expect(JSON.parse(sql('SELECT to_jsonb(r) FROM public.centerpoint_tournament_ops_release r WHERE id=true;'))).toEqual(expected);
}});
describe.skipIf(!enabled)('Actual TV editor → authenticated SQL → anonymous TV (not hosted transport)',()=>{
 it('reconciles a first publish committed before resolved SDK error, without another revision',async()=>{
  for(const [key,value] of Object.entries({PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:database}))expect(process.env[key]).toBe(value);
  for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])expect(process.env[key]).toBeFalsy();
  const f=createPaidJourneyFixture(sql);h.actor=f.actor;let mask=true,commits=0;
  gateBefore=JSON.parse(sql('SELECT to_jsonb(r) FROM public.centerpoint_tournament_ops_release r WHERE id=true;'));
  expect(gateBefore!.enabled).toBe(false);expect(gateBefore!.allowed_club_ids).toEqual([]);
  const token='native-paid-tv-'+crypto.randomUUID();
  // Explicit local pairing fixture only; no pairing UI/Storage/network proof.
  sql(`INSERT INTO public.tv_displays(id,club_id,display_token,assigned_tournament_id,status)
   VALUES(gen_random_uuid(),'${f.club}','${token}','${f.tour}','paired');`);
  const signatures={get_tv_tournament_branding_v1:{p_tournament_id:'uuid'},save_tv_tournament_layout_v1:{p_tournament_id:'uuid',p_expected_revision:'bigint',p_brand_name:'text',p_logo_url:'text',p_bg_url:'text',p_layout:'jsonb'}};
  h.rpc.mockImplementation(async(name:keyof typeof signatures,args:Record<string,unknown>)=>{
   const types=signatures[name];expect(types).toBeDefined();expect(Object.keys(args).sort()).toEqual(Object.keys(types).sort());expect(args.p_tournament_id).toBe(f.tour);
   const params=Object.entries(types).map(([key,type])=>`${key}=>${quote(args[key])}::${type}`).join(',');
   try{
    const data=JSON.parse(sql(`SET request.jwt.claim.sub='${h.actor}';SET request.jwt.claims='{"role":"authenticated","sub":"${h.actor}"}';SET ROLE authenticated;SELECT public.${name}(${params});`));
    if(name==='save_tv_tournament_layout_v1'){commits++;if(mask){mask=false;return {data:null,error:{code:'',message:'TypeError: Failed to fetch'}};}}
    return {data,error:null};
   }catch(error){const stderr=String((error as {stderr?:unknown}).stderr??error),failure=/ERROR:\s+([A-Z0-9]{5}):\s*([^\n]+)/.exec(stderr);
    return {data:null,error:{code:failure?.[1]??'',message:failure?.[2]??stderr}};}
  });
  expect(sql(`SELECT count(*) FROM public.tv_tournament_layouts WHERE tournament_id='${f.tour}';`)).toBe('0');
  const first=render(<TvBrandingEditor tournamentId={f.tour}/>);
  fireEvent.click(screen.getByRole('button',{name:'Edit TV layout'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Publish TV layout'})).toBeEnabled());
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Publish TV layout'}));});
  expect(h.error).toHaveBeenCalledWith(expect.stringContaining('CENTERPOINT_TOURNAMENT_OPS_RELEASE_CLOSED'));
  expect(commits).toBe(0);expect(sql(`SELECT count(*) FROM public.tv_tournament_layouts WHERE tournament_id='${f.tour}';`)).toBe('0');h.error.mockClear();
  sql(`UPDATE public.centerpoint_tournament_ops_release SET enabled=true,allowed_club_ids=ARRAY['${f.club}'::uuid],updated_at=clock_timestamp() WHERE id=true;`);
  fireEvent.change(screen.getByLabelText('Brand name'),{target:{value:'Native TEST broadcast'}});
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Publish TV layout'}));});
  expect(h.success.mock.calls.length,JSON.stringify({notices:h.error.mock.calls,commits})).toBe(1);expect(h.error).not.toHaveBeenCalled();expect(commits).toBe(1);
  expect(h.rpc.mock.calls.filter(([name])=>name==='save_tv_tournament_layout_v1')).toHaveLength(2);
  expect(h.rpc.mock.calls.filter(([name])=>name==='get_tv_tournament_branding_v1')).toHaveLength(2);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(sql(`SELECT count(*)||'|'||min(l.revision)||'|'||(SELECT count(*) FROM public.tv_tournament_layout_versions v WHERE v.layout_id=min(l.id::text)::uuid) FROM public.tv_tournament_layouts l WHERE l.tournament_id='${f.tour}';`)).toBe('1|1|1');
  const publicState=JSON.parse(sql(`SET request.jwt.claims='{"role":"anon"}';SET ROLE anon;SELECT public.get_tv_display_state_v4('${token}',true);`));
  expect(publicState.status).toBe('paired');expect(publicState.tournament.id).toBe(f.tour);expect(publicState.display.club_brand_name).toBe('Native TEST broadcast');
  const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('head',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.tv_tournament_layouts l WHERE tournament_id='${f.tour}'),
   'versions',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM public.tv_tournament_layout_versions v JOIN public.tv_tournament_layouts l ON l.id=v.layout_id WHERE l.tournament_id='${f.tour}'))::text);`);
  const after=fingerprint();first.unmount();h.actor=f.player;h.error.mockClear();h.success.mockClear();h.rpc.mockClear();
  render(<TvBrandingEditor tournamentId={f.tour}/>);fireEvent.click(screen.getByRole('button',{name:'Edit TV layout'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Publish TV layout'})).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Brand name'),{target:{value:'Unauthorized TEST draft'}});
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Publish TV layout'}));});
  expect(h.success).not.toHaveBeenCalled();expect(h.error).toHaveBeenCalledWith(expect.stringContaining('tv_layout_forbidden'));
  expect(commits).toBe(1);expect(fingerprint()).toBe(after);
  expect(h.rpc.mock.calls.filter(([name])=>name==='get_tv_tournament_branding_v1')).toHaveLength(1);
 });
});
