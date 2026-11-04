import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import {createPublicHudReadBatcher} from '../../supabase/functions/public-player-hud/readBatch';
const tour='10000000-0000-4000-8000-000000000001',player='30000000-0000-4000-8000-000000000001';
const summary='get_public_player_hud_summary_v1',history='get_public_player_hud_history_v1';
const args={p_tournament_id:tour,p_player_id:player};
const response=()=>new Response('{"access":"public","nested":{"value":1}}');
const reader=(send:typeof fetch)=>createPublicHudReadBatcher('https://fixture.invalid','fixed-anon',send);
beforeEach(()=>vi.useFakeTimers());afterEach(()=>vi.useRealTimers());
it('shares only pre-query requests, clones results and never reuses completed reads',async()=>{
 const send=vi.fn(async()=>response()),observe=vi.fn(),batch=reader(send);
 const first=batch.forRequest(new AbortController().signal,observe).rpc(summary,args);
 const second=batch.forRequest(new AbortController().signal,observe).rpc(summary,{...args,p_access_snapshot:null});
 expect(send).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(5);
 const [a,b]=await Promise.all([first,second]);expect(send).toHaveBeenCalledTimes(1);
 (a.data as {nested:{value:number}}).nested.value=9;expect(b.data).toMatchObject({nested:{value:1}});
 expect(observe.mock.calls.map(c=>c[0].groupSize)).toEqual([2,2]);
 const third=batch.forRequest(new AbortController().signal).rpc(summary,args);await vi.advanceTimersByTimeAsync(5);await third;
 expect(send).toHaveBeenCalledTimes(2);expect(vi.getTimerCount()).toBe(0);
});
it('does not attach a later arrival to a snapshot started before withdrawal',async()=>{
 let hidden=false,release:((v:Response)=>void)|undefined;
 const send=vi.fn(async()=>{const access=hidden?'revoked':'public';if(!hidden)return new Promise<Response>(resolve=>{release=resolve;});return new Response(JSON.stringify({access}));});
 const batch=reader(send),old=batch.forRequest(new AbortController().signal).rpc(summary,args);
 await vi.advanceTimersByTimeAsync(5);expect(send).toHaveBeenCalledTimes(1);hidden=true;
 const late=batch.forRequest(new AbortController().signal).rpc(summary,args);
 await vi.advanceTimersByTimeAsync(5);expect((await late).data).toEqual({access:'revoked'});expect(send).toHaveBeenCalledTimes(2);
 release!(new Response('{"access":"public"}'));expect((await old).data).toEqual({access:'public'});expect(vi.getTimerCount()).toBe(0);
});
it('separates scope, reader, access snapshot and both history cursor fields',async()=>{
 const send=vi.fn(async()=>response()),batch=reader(send),client=batch.forRequest(new AbortController().signal);
 const calls=[client.rpc(summary,args),client.rpc(summary,{...args,p_player_id:tour}),client.rpc(summary,{...args,p_tournament_id:player}),
 client.rpc(summary,{...args,p_access_snapshot:'1:2:'}),client.rpc(summary,{...args,p_access_snapshot:'2:3:'}),client.rpc(history,args),
 client.rpc(history,{...args,p_after_hand:player,p_after_time:null}),client.rpc(history,{...args,p_after_hand:tour,p_after_time:null}),
 client.rpc(history,{...args,p_after_hand:player,p_after_time:'2026-11-04T00:00:00Z'})];
 await vi.advanceTimersByTimeAsync(5);await Promise.all(calls);expect(send).toHaveBeenCalledTimes(9);expect(vi.getTimerCount()).toBe(0);
});
it('isolates first-subscriber abort and cancels transport only after last abort',async()=>{
 let underlying:AbortSignal|undefined;
 const send=vi.fn(async(_url:unknown,init?:RequestInit)=>{underlying=init!.signal!;return new Promise<Response>((_resolve,reject)=>underlying!.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));});
 const batch=reader(send),a=new AbortController(),b=new AbortController();
 const first=batch.forRequest(a.signal).rpc(summary,args),second=batch.forRequest(b.signal).rpc(summary,args);
 await vi.advanceTimersByTimeAsync(5);a.abort();expect((await first).error).toEqual({code:'PUBLIC_RPC_TRANSPORT'});expect(underlying?.aborted).toBe(false);
 b.abort();expect((await second).error).toEqual({code:'PUBLIC_RPC_TRANSPORT'});expect(underlying?.aborted).toBe(true);await Promise.resolve();expect(vi.getTimerCount()).toBe(0);
 const cancelled=new AbortController();cancelled.abort();await batch.forRequest(cancelled.signal).rpc(summary,args);await vi.advanceTimersByTimeAsync(5);expect(send).toHaveBeenCalledTimes(1);
});
it('removes an empty pending group so another arrival receives a new read',async()=>{
 const send=vi.fn(async()=>response()),batch=reader(send),a=new AbortController();
 const first=batch.forRequest(a.signal).rpc(summary,args);a.abort();await first;
 const next=batch.forRequest(new AbortController().signal).rpc(summary,args);await vi.advanceTimersByTimeAsync(5);expect((await next).error).toBeNull();expect(send).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
});
it('keeps each five-second invocation deadline independent of another waiter',async()=>{
 let release:((v:Response)=>void)|undefined;
 const send=vi.fn(async()=>new Promise<Response>(resolve=>{release=resolve;})),batch=reader(send),observe=vi.fn();
 const first=batch.forRequest(new AbortController().signal,observe).rpc(summary,args);
 await vi.advanceTimersByTimeAsync(2);const second=batch.forRequest(new AbortController().signal,observe).rpc(summary,args);
 await vi.advanceTimersByTimeAsync(4998);expect((await first).error).toEqual({code:'PUBLIC_RPC_TRANSPORT'});expect(observe.mock.lastCall?.[0].outcome).toBe('deadline');
 release!(response());expect((await second).error).toBeNull();expect(observe.mock.lastCall?.[0].outcome).toBe('ok');expect(vi.getTimerCount()).toBe(0);
});
it('bypasses queue bounds with fresh reads instead of dropping or reusing results',async()=>{
 const send=vi.fn(async()=>response()),batch=reader(send),client=batch.forRequest(new AbortController().signal);
 const same=Array.from({length:257},()=>client.rpc(summary,args));expect(send).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(5);await Promise.all(same);expect(send).toHaveBeenCalledTimes(2);
 send.mockClear();const distinct=Array.from({length:129},(_,i)=>client.rpc(summary,{...args,p_player_id:`30000000-0000-4000-8000-${(i+1).toString(16).padStart(12,'0')}`}));
 expect(send).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(5);await Promise.all(distinct);expect(send).toHaveBeenCalledTimes(129);expect(vi.getTimerCount()).toBe(0);
});
it('propagates malformed/throwing transport without retry or private diagnostics',async()=>{
 const send=vi.fn(async()=>new Response('private invalid JSON')),batch=reader(send),observe=vi.fn(()=>{throw Error('observer');});
 const a=batch.forRequest(new AbortController().signal,observe).rpc(summary,args),b=batch.forRequest(new AbortController().signal).rpc(summary,args);
 await vi.advanceTimersByTimeAsync(5);expect(await a).toEqual({data:null,error:{code:'PUBLIC_RPC_TRANSPORT'}});expect(await b).toEqual({data:null,error:{code:'PUBLIC_RPC_TRANSPORT'}});expect(send).toHaveBeenCalledTimes(1);
 expect(observe.mock.calls[0][0]).toMatchObject({outcome:'transport',groupSize:2});expect(JSON.stringify(observe.mock.calls)).not.toMatch(/private|fixture|player|fixed-anon/);expect(vi.getTimerCount()).toBe(0);
});
it('bounds total queued waiters and key bytes while preserving fresh saturation reads',async()=>{
 const send=vi.fn(async()=>response()),batch=reader(send),client=batch.forRequest(new AbortController().signal);
 const calls=Array.from({length:2049},(_,i)=>client.rpc(summary,{...args,p_access_snapshot:`${Math.floor(i/256)+1}:20:`}));
 expect(send).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(5);await Promise.all(calls);expect(send).toHaveBeenCalledTimes(9);expect(vi.getTimerCount()).toBe(0);
 send.mockClear();const large='1:2:'+'1,'.repeat(4090)+'1';
 const bytes=Array.from({length:35},(_,i)=>client.rpc(summary,{...args,p_player_id:`30000000-0000-4000-8000-${(i+1).toString(16).padStart(12,'0')}`,p_access_snapshot:large}));
 expect(send.mock.calls.length).toBeGreaterThan(0);expect(send.mock.calls.length).toBeLessThan(35);
 await vi.advanceTimersByTimeAsync(5);await Promise.all(bytes);expect(send).toHaveBeenCalledTimes(35);expect(vi.getTimerCount()).toBe(0);
});
