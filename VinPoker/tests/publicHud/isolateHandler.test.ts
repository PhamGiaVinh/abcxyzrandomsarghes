import {it,expect,vi} from 'vitest';
it('keeps the actual Edge handler response intact and enables shutdown telemetry only by explicit opt-in',async()=>{
 vi.useFakeTimers();
 const tour='10000000-0000-4000-8000-000000000001',table='50000000-0000-4000-8000-000000000001';
 try{for(const enabled of [false,true]){
  vi.resetModules();let handler:(req:Request)=>Promise<Response>;let shutdown:((event:unknown)=>void)|undefined;
  const log=vi.spyOn(console,'log').mockImplementation(()=>{});
  vi.stubGlobal('Deno',{env:{get:(key:string)=>key==='SUPABASE_URL'?'https://fixture.invalid':key==='SUPABASE_ANON_KEY'?'fixed-anon':key==='PUBLIC_HUD_ISOLATE_DIAGNOSTICS'&&enabled?'isolated-hud-runtime-diagnostics-v1':undefined},serve:(fn:typeof handler)=>{handler=fn;}});
  vi.stubGlobal('addEventListener',vi.fn((name:string,fn:(event:unknown)=>void)=>{if(name==='beforeunload')shutdown=fn;}));
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({access:'public',state:'waiting',tableId:table}))));
  await import('../../supabase/functions/public-player-hud/index');
  const pending=handler!(new Request('https://fixture.invalid/functions/v1/public-player-hud',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'current_table',tournament_id:tour,table_id:table})}));
  await vi.advanceTimersByTimeAsync(50);const response=await pending;
  expect(response.status).toBe(200);expect(await response.json()).toMatchObject({access:'public',tableId:table});
  expect(!!shutdown).toBe(enabled);
  shutdown?.({detail:{reason:'EarlyDrop'}});
  if(enabled){const entry=log.mock.calls.find(args=>String(args[0]).startsWith('PUBLIC_HUD_ISOLATE_DIAGNOSTIC '));expect(entry).toBeDefined();expect(JSON.parse(String(entry![0]).split('PUBLIC_HUD_ISOLATE_DIAGNOSTIC ')[1])).toMatchObject({reason:'EarlyDrop',received:1,completed:1,active:0});}
  else expect(log).not.toHaveBeenCalled();
  log.mockRestore();vi.unstubAllGlobals();
 }}finally{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();}
});
