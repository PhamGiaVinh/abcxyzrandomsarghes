import "@testing-library/jest-dom/vitest";
import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,beforeAll,describe,expect,it,vi} from "vitest";
import {execFileSync} from "node:child_process";
import {createPaidJourneyFixture} from "../cashier/paidJourney.fixture.mjs";
const h=vi.hoisted(()=>{const rpc=vi.fn();return {actor:"",rpc,client:{rpc},success:vi.fn(),error:vi.fn()};});
vi.mock("@/hooks/useAuth",()=>({useAuth:()=>({user:{id:h.actor}})}));
vi.mock("@/integrations/supabase/SupabaseClientContext",()=>({useSupabaseClient:()=>h.client}));
vi.mock("@/lib/featureFlags",()=>({FEATURES:{tvLayoutEditorV1:true}}));
vi.mock("@/components/ProofUploader",()=>({ProofUploadWorkspace:()=>null}));
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
  const ownerSql=`SET request.jwt.claim.sub='${f.actor}';SET request.jwt.claims='{"role":"authenticated","sub":"${f.actor}"}';SET ROLE authenticated;`;
  const assetPath=`${f.actor}/tv/branding-logo/v1/${crypto.randomUUID()}.png`;
  const assetUrl=`https://orlesggcjamwuknxwcpk.supabase.co/storage/v1/object/public/backing-proofs/${assetPath}`;
  gateBefore=JSON.parse(sql('SELECT to_jsonb(r) FROM public.centerpoint_tournament_ops_release r WHERE id=true;'));
  expect(gateBefore!.enabled).toBe(false);expect(Array.isArray(gateBefore!.allowed_club_ids)).toBe(true);
  // Metadata-only Storage seam: no blob bytes or hosted upload are modeled.
  sql(`INSERT INTO storage.buckets(id,name,public) VALUES('backing-proofs','backing-proofs',true) ON CONFLICT(id) DO NOTHING;`);
  expect(sql(`SELECT name||'|'||public FROM storage.buckets WHERE id='backing-proofs';`)).toBe('backing-proofs|true');
  const denied=(statement:string)=>{try{sql(statement);throw new Error('expected_storage_denial');}catch(error){expect(String((error as {stderr?:unknown}).stderr??error)).toMatch(/42501/);}};
  denied(ownerSql+`INSERT INTO storage.objects(bucket_id,name) VALUES('backing-proofs','${assetPath}');`);
  expect(sql(`SELECT count(*) FROM storage.objects WHERE bucket_id='backing-proofs' AND name='${assetPath}';`)).toBe('0');
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
  expect(JSON.parse(sql(ownerSql+`SELECT public.get_tv_tournament_branding_v1('${f.tour}');`)).revision).toBe(0);
  const first=render(<TvBrandingEditor tournamentId={f.tour}/>);
  fireEvent.click(screen.getByRole('button',{name:'Edit TV layout'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Publish TV layout'})).toBeEnabled());
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Publish TV layout'}));});
  expect(h.error).toHaveBeenCalledWith(expect.stringContaining('CENTERPOINT_TOURNAMENT_OPS_RELEASE_CLOSED'));
  expect(commits).toBe(0);expect(sql(`SELECT count(*) FROM public.tv_tournament_layouts WHERE tournament_id='${f.tour}';`)).toBe('0');h.error.mockClear();
  sql(`UPDATE public.centerpoint_tournament_ops_release SET enabled=true,allowed_club_ids=ARRAY['${f.club}'::uuid],updated_at=clock_timestamp() WHERE id=true;`);
  sql(ownerSql+`INSERT INTO storage.objects(bucket_id,name) VALUES('backing-proofs','${assetPath}');`);
  const outsiderPath=`${f.player}/tv/branding-logo/v1/${crypto.randomUUID()}.png`;
  denied(`SET request.jwt.claim.sub='${f.player}';SET request.jwt.claims='{"role":"authenticated","sub":"${f.player}"}';SET ROLE authenticated;INSERT INTO storage.objects(bucket_id,name) VALUES('backing-proofs','${outsiderPath}');`);
  expect(sql(`SELECT count(*) FROM storage.objects WHERE bucket_id='backing-proofs' AND name='${outsiderPath}';`)).toBe('0');
  const assetBefore=sql(`SELECT to_jsonb(o) FROM storage.objects o WHERE bucket_id='backing-proofs' AND name='${assetPath}';`);
  expect(sql(ownerSql+`WITH changed AS (UPDATE storage.objects SET name=name||'.changed' WHERE bucket_id='backing-proofs' AND name='${assetPath}' RETURNING 1) SELECT count(*) FROM changed;`)).toBe('0');
  // Current Storage has an additional statement-level delete guard. Keep it;
  // this denial is not evidence of an actual Storage API DELETE/RLS journey.
  denied(ownerSql+`DELETE FROM storage.objects WHERE bucket_id='backing-proofs' AND name='${assetPath}';`);
  expect(sql(`SELECT to_jsonb(o) FROM storage.objects o WHERE bucket_id='backing-proofs' AND name='${assetPath}';`)).toBe(assetBefore);
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
  cleanup();h.actor=f.actor;h.error.mockClear();h.success.mockClear();h.rpc.mockClear();
  render(<TvBrandingEditor tournamentId={f.tour}/>);fireEvent.click(screen.getByRole('button',{name:'Edit TV layout'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Publish TV layout'})).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Brand name'),{target:{value:'Stale local draft TEST'}});
  const canonical=JSON.parse(sql(`SELECT public.get_tv_tournament_branding_v1('${f.tour}');`));
  // Deterministic second-writer interleaving, not two concurrent browser tabs.
  const second=await h.rpc('save_tv_tournament_layout_v1',{p_tournament_id:f.tour,p_expected_revision:canonical.revision,
   p_brand_name:'Other tab TEST publish',p_logo_url:canonical.logo_url??'',p_bg_url:canonical.background_url??'',p_layout:canonical.layout});
  expect(second.error).toBeNull();expect(second.data.revision).toBe(2);const newer=fingerprint();
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Publish TV layout'}));});
  expect(h.error).toHaveBeenCalledWith('Another operator published a new layout. Reopen the editor before saving.');
  expect(h.success).not.toHaveBeenCalled();expect(commits).toBe(2);expect(fingerprint()).toBe(newer);
  expect(screen.getByLabelText('Brand name')).toHaveValue('Stale local draft TEST');
  expect(JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_array(v.revision,v.brand_name) ORDER BY v.revision) FROM public.tv_tournament_layout_versions v
   JOIN public.tv_tournament_layouts l ON l.id=v.layout_id WHERE l.tournament_id='${f.tour}';`))).toEqual([[1,'Native TEST broadcast'],[2,'Other tab TEST publish']]);
  const currentPublic=JSON.parse(sql(`SET request.jwt.claims='{"role":"anon"}';SET ROLE anon;SELECT public.get_tv_display_state_v4('${token}',true);`));
  expect(currentPublic.display.club_brand_name).toBe('Other tab TEST publish');
  cleanup();h.error.mockClear();h.success.mockClear();
  const owner=`SET request.jwt.claim.sub='${f.actor}';SET request.jwt.claims='{"role":"authenticated","sub":"${f.actor}"}';SET ROLE authenticated;`;
  const created=JSON.parse(sql(owner+`SELECT public.create_tournament_with_levels_v1('${f.club}',${quote({name:'TV flight B TEST',start_time:new Date(Date.now()+3_600_000).toISOString(),buy_in:50000,rake_amount:0,service_fee_amount:0,starting_stack:40000,game_type:'nlh',minutes_per_level:30,late_reg_close_level:6})}::jsonb,
   '[{"level_number":1,"small_blind":500,"big_blind":1000,"ante":100,"duration_minutes":30,"is_break":false}]'::jsonb,gen_random_uuid(),'${f.actor}');`));
  expect(created.ok).toBe(true);const flight=created.tournament_id,physical=crypto.randomUUID(),player=crypto.randomUUID(),event=crypto.randomUUID(),secondToken='native-paid-flight-b-'+crypto.randomUUID();
  sql(`INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
   VALUES('${physical}','${f.club}','TV flight B inventory TEST',99,'tournament','inactive','available');INSERT INTO auth.users(id) VALUES('${player}');`);
  expect(JSON.parse(sql(owner+`SELECT public.floor_open_tournament_table_v3('${flight}','${physical}','manual',gen_random_uuid());`)).ok).toBe(true);
  const registered=JSON.parse(sql(`SET request.jwt.claims='{"role":"service_role"}';SET request.jwt.claim.role='service_role';SET ROLE service_role;SELECT public.cashier_create_app_registration_v1('${flight}','${player}');`));
  expect(registered.ok).toBe(true);
  const paid=JSON.parse(sql(owner+`SELECT public.resolve_cashier_cash_buyin_intent_v1(${quote({actor_id:f.actor,club_id:f.club,tournament_id:flight,registration_id:registered.registration_id,amount:50000,request_id:crypto.randomUUID()})}::jsonb,'record');`));
  expect(paid.status).toBe('recorded');expect(paid.result.seating_state).toBe('seated');
  // Explicit local event association/pairing fixtures, not management UI proof.
  sql(`INSERT INTO public.tournament_events(id,club_id,name) VALUES('${event}','${f.club}','Native shared TV event TEST');
   UPDATE public.tournaments SET event_id='${event}' WHERE id IN ('${f.tour}','${flight}');
   INSERT INTO public.tv_displays(id,club_id,display_token,assigned_tournament_id,status) VALUES(gen_random_uuid(),'${f.club}','${secondToken}','${flight}','paired');`);
  const operational=()=>sql(`SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournaments t WHERE id IN ('${f.tour}','${flight}');`),beforeBranding=operational();
  render(<TvBrandingEditor tournamentId={f.tour}/>);fireEvent.click(screen.getByRole('button',{name:'Edit TV layout'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Publish TV layout'})).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Brand name'),{target:{value:'Shared event TEST brand'}});
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Publish TV layout'}));});
  expect(h.error).not.toHaveBeenCalled();expect(h.success).toHaveBeenCalledOnce();expect(commits).toBe(3);expect(operational()).toBe(beforeBranding);
  expect(sql(`SELECT count(*)||'|'||min(revision) FROM public.tv_tournament_layouts WHERE event_id='${event}' AND tournament_id IS NULL;`)).toBe('1|1');
  expect(fingerprint()).toBe(newer); // Original tournament-scoped history stays intact.
  for(const [displayToken,tournament,stack,bigBlind] of [[token,f.tour,20000,200],[secondToken,flight,40000,1000]] as const){
   const state=JSON.parse(sql(`SET request.jwt.claims='{"role":"anon"}';SET ROLE anon;SELECT public.get_tv_display_state_v4('${displayToken}',true);`));
   expect(state.display.club_brand_name).toBe('Shared event TEST brand');expect(state.tournament.id).toBe(tournament);
   expect(state.clock.tournament_id).toBe(tournament);expect(state.participation_counts.live_entry_stack).toBe(stack);expect(state.levels[0].big_blind).toBe(bigBlind);
  }
  const shared=JSON.parse(sql(ownerSql+`SELECT public.get_tv_tournament_branding_v1('${f.tour}');`));
  const publishAsset=(url:string,revision:number)=>sql(ownerSql+`SELECT public.save_tv_tournament_layout_v1('${f.tour}',${revision},'Shared event TEST brand',${quote(url)},'',${quote(shared.layout)}::jsonb);`);
  expect(JSON.parse(publishAsset(assetUrl,1)).revision).toBe(2);
  expect(sql(`SELECT v.logo_url FROM public.tv_tournament_layout_versions v JOIN public.tv_tournament_layouts l ON l.id=v.layout_id WHERE l.event_id='${event}' AND v.revision=2;`)).toBe(assetUrl);
  const retained=sql(`SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM public.tv_tournament_layout_versions v JOIN public.tv_tournament_layouts l ON l.id=v.layout_id WHERE l.event_id='${event}';`);
  try{publishAsset(assetUrl.replace(/[^/]+$/,crypto.randomUUID()+'.png'),2);throw new Error('expected_missing_asset');}
  catch(error){expect(String((error as {stderr?:unknown}).stderr??error)).toContain('tv_layout_asset_missing');}
  expect(sql(`SELECT revision FROM public.tv_tournament_layouts WHERE event_id='${event}';`)).toBe('2');
  expect(sql(`SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM public.tv_tournament_layout_versions v JOIN public.tv_tournament_layouts l ON l.id=v.layout_id WHERE l.event_id='${event}';`)).toBe(retained);
  // Recovery is a compensating publish with CAS, never UPDATE of history.
  const version=(revision:number)=>JSON.parse(sql(`SELECT to_jsonb(v) FROM public.tv_tournament_layout_versions v
    JOIN public.tv_tournament_layouts l ON l.id=v.layout_id WHERE l.event_id='${event}' AND v.revision=${revision};`));
  const original1=version(1),original2=version(2),recoveryOps=operational();
  const restore=(snapshot:Record<string,unknown>,expected:number)=>JSON.parse(sql(ownerSql+`SELECT public.save_tv_tournament_layout_v1(
    '${f.tour}',${expected},${quote(snapshot.brand_name??'')},${quote(snapshot.logo_url??'')},${quote(snapshot.background_url??'')},${quote(snapshot.layout)}::jsonb);`));
  expect(restore(original1,2).revision).toBe(3);
  expect(restore(original2,3).revision).toBe(4);
  expect(version(1)).toEqual(original1);expect(version(2)).toEqual(original2);
  expect(operational()).toBe(recoveryOps);
  expect(sql(`SELECT to_jsonb(o) FROM storage.objects o WHERE bucket_id='backing-proofs' AND name='${assetPath}';`)).toBe(assetBefore);
  for(const displayToken of [token,secondToken]){
    const restored=JSON.parse(sql(`SET request.jwt.claims='{"role":"anon"}';SET ROLE anon;SELECT public.get_tv_display_state_v4('${displayToken}',true);`));
    expect(restored.display.club_brand_name).toBe(original2.brand_name);
    expect(restored.display.club_logo_url).toBe(assetUrl);
  }
  cleanup();h.error.mockClear();h.success.mockClear();mask=true;
  const oldVersions=sql(`SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM public.tv_tournament_layout_versions v JOIN public.tv_tournament_layouts l ON l.id=v.layout_id WHERE l.event_id='${event}';`);
  const beforeResetCommits=commits;
  render(<TvBrandingEditor tournamentId={f.tour}/>);fireEvent.click(screen.getByRole('button',{name:'Edit TV layout'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Publish TV layout'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'Reset draft to defaults'}));
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Publish TV layout'}));});
  expect(h.success).toHaveBeenCalledOnce();expect(h.error).not.toHaveBeenCalled();expect(commits).toBe(beforeResetCommits+1);
  const reset=JSON.parse(sql(ownerSql+`SELECT public.get_tv_tournament_branding_v1('${f.tour}');`));
  expect(reset.revision).toBe(5);expect(reset.configured_brand_name).toBeNull();expect(reset.brand_name).toBe('Cash identity local TEST');
  expect(sql(`SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM public.tv_tournament_layout_versions v JOIN public.tv_tournament_layouts l ON l.id=v.layout_id WHERE l.event_id='${event}' AND v.revision<=4;`)).toBe(oldVersions);
  expect(operational()).toBe(recoveryOps);expect(sql(`SELECT to_jsonb(o) FROM storage.objects o WHERE bucket_id='backing-proofs' AND name='${assetPath}';`)).toBe(assetBefore);
  expect(reset.fallback_brand_name).toBe('Cash identity local TEST');
  cleanup();h.error.mockClear();h.success.mockClear();
  render(<TvBrandingEditor tournamentId={f.tour}/>);fireEvent.click(screen.getByRole('button',{name:'Edit TV layout'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Publish TV layout'})).toBeEnabled());
  expect(screen.getByLabelText('Brand name')).toHaveValue('');
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Publish TV layout'}));});
  expect(h.success).toHaveBeenCalledOnce();expect(h.error).not.toHaveBeenCalled();
  expect(h.rpc.mock.calls.filter(([name])=>name==='save_tv_tournament_layout_v1').at(-1)?.[1].p_brand_name).toBe('');
  expect(sql(`SELECT revision||'|'||(brand_name IS NULL) FROM public.tv_tournament_layouts WHERE event_id='${event}';`)).toBe('6|true');
  expect(operational()).toBe(recoveryOps);
  console.log('TV_FIRST_PUBLISH_ANON_FLIGHTS_COMPENSATING_METADATA_RESTORE_IMMUTABLE_HISTORY_PASS',JSON.stringify({club:f.club,tour:f.tour,event,revision:6,storageBytesVerified:false,resetLostResponseVerified:true,inheritedNamePreservedAfterReload:true}));
 });
});
