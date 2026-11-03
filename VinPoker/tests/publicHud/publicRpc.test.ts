import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import {createAnonymousPublicHudClient} from '../../supabase/functions/public-player-hud/publicRpc';
// The browser test environment lacks the Deno/Node timeout static method.
// These unit cases verify transport boundaries; real Edge HTTP covers runtime.
beforeEach(()=>vi.stubGlobal('AbortSignal',{timeout:vi.fn(()=>new AbortController().signal)}));
afterEach(()=>vi.unstubAllGlobals());
it('uses only fixed anonymous credentials and approved prepared readers',async()=>{
 const send=vi.fn().mockResolvedValue(new Response('{"access":"revoked"}',{status:200}));
 const client=createAnonymousPublicHudClient('https://fixture.invalid','fixture-anon',send);
 expect(await client.rpc('get_public_player_hud_summary_v1',{p_player_id:'player'})).toEqual({data:{access:'revoked'},error:null});
 const [url,request]=send.mock.calls[0];expect(url.toString()).toBe('https://fixture.invalid/rest/v1/rpc/get_public_player_hud_summary_v1');
 expect(request.headers).toMatchObject({apikey:'fixture-anon',Authorization:'Bearer fixture-anon','Content-Profile':'public'});
 expect(request.method).toBe('POST');expect(request.redirect).toBe('error');expect(request.signal.aborted).toBe(false);expect(AbortSignal.timeout).toHaveBeenCalledWith(5000);
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
