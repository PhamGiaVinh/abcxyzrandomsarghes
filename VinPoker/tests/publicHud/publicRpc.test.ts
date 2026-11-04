import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import {createAnonymousPublicHudClient} from '../../supabase/functions/public-player-hud/publicRpc';
beforeEach(()=>vi.useFakeTimers());
afterEach(()=>vi.useRealTimers());
it('uses only fixed anonymous credentials and approved prepared readers',async()=>{
 const send=vi.fn().mockResolvedValue(new Response('{"access":"revoked"}',{status:200}));
 const client=createAnonymousPublicHudClient('https://fixture.invalid','fixture-anon',send);
 expect(await client.rpc('get_public_player_hud_summary_v1',{p_player_id:'player'})).toEqual({data:{access:'revoked'},error:null});
 const [url,request]=send.mock.calls[0];expect(url.toString()).toBe('https://fixture.invalid/rest/v1/rpc/get_public_player_hud_summary_v1');
 expect(request.headers).toMatchObject({apikey:'fixture-anon',Authorization:'Bearer fixture-anon','Content-Profile':'public'});
 expect(request.method).toBe('POST');expect(request.redirect).toBe('error');expect(request.signal.aborted).toBe(false);expect(vi.getTimerCount()).toBe(0);
 expect(await client.rpc('claim_public_hud_jobs_v1',{})).toEqual({data:null,error:{code:'PUBLIC_RPC_NOT_ALLOWED'}});expect(send).toHaveBeenCalledTimes(1);
});
it('fails closed without exposing database messages or retrying',async()=>{
 const send=vi.fn().mockResolvedValue(new Response('{"code":"42501","message":"private diagnostic"}',{status:403}));
 const client=createAnonymousPublicHudClient('https://fixture.invalid','fixture-anon',send);
 expect(await client.rpc('get_public_player_hud_history_v1',{})).toEqual({data:null,error:{code:'42501'}});
 send.mockRejectedValue(new Error('private transport diagnostic'));
 expect(await client.rpc('get_public_player_hud_summary_v1',{})).toEqual({data:null,error:{code:'PUBLIC_RPC_TRANSPORT'}});expect(send).toHaveBeenCalledTimes(2);
});
it('rejects credential-bearing or non-origin endpoint configuration',()=>{
 for(const url of ['https://secret@fixture.invalid','https://fixture.invalid/private','file:///tmp/fixture','https://fixture.invalid/?key=value'])expect(()=>createAnonymousPublicHudClient(url,'fixture-anon')).toThrow('PUBLIC_RPC_CONFIGURATION');
});
it('isolates caller cancellation and keeps the independent timeout',async()=>{
 const requests:Array<{signal:AbortSignal;resolve:(value:Response)=>void}>=[];
 const send=vi.fn((_url:unknown,init:RequestInit)=>new Promise<Response>((resolve,reject)=>{
  const signal=init.signal!;requests.push({signal,resolve});
  signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});
 })) as unknown as typeof fetch;
 const a=new AbortController(),b=new AbortController();
 const first=createAnonymousPublicHudClient('https://fixture.invalid','fixture-anon',send,a.signal).rpc('get_public_player_hud_summary_v1',{});
 const second=createAnonymousPublicHudClient('https://fixture.invalid','fixture-anon',send,b.signal).rpc('get_public_player_hud_summary_v1',{});
 a.abort();expect((await first).error).toEqual({code:'PUBLIC_RPC_TRANSPORT'});expect(requests[1].signal.aborted).toBe(false);
 requests[1].resolve(new Response('{"access":"public"}'));expect((await second).error).toBeNull();
 const third=createAnonymousPublicHudClient('https://fixture.invalid','fixture-anon',send,b.signal).rpc('get_public_player_hud_summary_v1',{});
 vi.advanceTimersByTime(4999);expect(requests[2].signal.aborted).toBe(false);
 vi.advanceTimersByTime(1);expect((await third).error).toEqual({code:'PUBLIC_RPC_TRANSPORT'});expect(b.signal.aborted).toBe(false);expect(vi.getTimerCount()).toBe(0);
});
it('holds the deadline through body consumption and detaches completed callers',async()=>{
 const caller=new AbortController(),remove=vi.spyOn(caller.signal,'removeEventListener');
 let signal:AbortSignal;
 const send=vi.fn(async(_url:unknown,init:RequestInit)=>{
  signal=init.signal!;
  return {ok:true,json:()=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}))} as Response;
 }) as unknown as typeof fetch;
 const pending=createAnonymousPublicHudClient('https://fixture.invalid','fixture-anon',send,caller.signal).rpc('get_public_player_hud_summary_v1',{});
 await Promise.resolve();vi.advanceTimersByTime(5000);
 expect((await pending).error).toEqual({code:'PUBLIC_RPC_TRANSPORT'});
 expect(vi.getTimerCount()).toBe(0);expect(remove).toHaveBeenCalledWith('abort',expect.any(Function));
});
