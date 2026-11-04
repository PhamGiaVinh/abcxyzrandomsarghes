import {it,expect,vi} from 'vitest';
import {readPublicHudRequest} from './publicHudTransport';
import {emptyPublicHudCounters} from '../../supabase/functions/_shared/publicHudContribution';
const tournament='10000000-0000-4000-8000-000000000001',player='30000000-0000-4000-8000-000000000001';
const input={tournament_id:tournament,player_id:player,mode:'summary' as const};
const summary=()=>({access:'public',state:'current',tournamentId:tournament,playerId:player,counters:emptyPublicHudCounters()});
it('uses the anonymous prepared RPC and identical counter formatting without a session or Edge request',async()=>{
 const counters=emptyPublicHudCounters();counters.publicHands=counters.handsObserved=1_000_000;counters.numerators[0]=250_000;counters.denominators[0]=1_000_000;
 const send=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>new Response(JSON.stringify({...summary(),counters})));
 const value=await readPublicHudRequest('https://fixture.invalid','public-anon',input,new AbortController().signal,send);
 expect(value).toMatchObject({analytics:{metrics:{vpip:{percentage:25}}}});
 expect(send).toHaveBeenCalledTimes(1);expect(String(send.mock.calls[0][0])).toBe('https://fixture.invalid/rest/v1/rpc/get_public_player_hud_summary_v1');
 expect(send.mock.calls[0][1].headers).toMatchObject({apikey:'public-anon',Authorization:'Bearer public-anon'});
 expect(send.mock.calls[0][1]).toMatchObject({credentials:'omit',cache:'no-store',redirect:'error'});
});
it('uses a publishable key only as apikey, never as a user bearer',async()=>{
 const send=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>new Response(JSON.stringify(summary())));
 await readPublicHudRequest('https://fixture.invalid','sb_publishable_fixture',input,new AbortController().signal,send);
 expect(send.mock.calls[0][1].headers).toMatchObject({apikey:'sb_publishable_fixture'});
 expect(send.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
});
it('passes the frozen access watermark and null-timestamp cursor to separate bounded readers',async()=>{
 const send=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>new Response(JSON.stringify({...summary(),handHistory:[],nextCursor:null})));
 await readPublicHudRequest('https://fixture.invalid','public-anon',{...input,access_snapshot:'1:2:'},new AbortController().signal,send);
 expect(JSON.parse(String(send.mock.calls[0][1].body)).p_access_snapshot).toBe('1:2:');
 await readPublicHudRequest('https://fixture.invalid','public-anon',{...input,mode:'history',cursor:{playedAt:null,handId:player}},new AbortController().signal,send);
 expect(String(send.mock.calls[1][0])).toContain('/get_public_player_hud_history_v1');
 expect(JSON.parse(String(send.mock.calls[1][1].body))).toMatchObject({p_after_time:null,p_after_hand:player});
});
it('rejects mismatched scope or malformed counters and preserves warming/revocation without fallback',async()=>{
 for(const data of [{...summary(),tournamentId:player},{...summary(),counters:{}}]){
  const send=vi.fn(async()=>new Response(JSON.stringify(data)));
  await expect(readPublicHudRequest('https://fixture.invalid','public-anon',input,new AbortController().signal,send)).rejects.toThrow();
  expect(send).toHaveBeenCalledTimes(1);
 }
 for(const data of [{access:'revoked'},{access:'public',state:'warming'}]){
  const send=vi.fn(async()=>new Response(JSON.stringify(data)));
  expect(await readPublicHudRequest('https://fixture.invalid','public-anon',input,new AbortController().signal,send)).toEqual(data);
  expect(send).toHaveBeenCalledTimes(1);
 }
});
it('makes no request for closed or invalid scope',async()=>{
 const send=vi.fn(),controller=new AbortController();controller.abort();
 await expect(readPublicHudRequest('https://fixture.invalid','public-anon',input,controller.signal,send)).rejects.toThrow('aborted');
 await expect(readPublicHudRequest('https://fixture.invalid','public-anon',{...input,player_id:'bad'},new AbortController().signal,send)).rejects.toThrow('PUBLIC_SCOPE_INVALID');
 expect(send).not.toHaveBeenCalled();
});
