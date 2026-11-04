import {afterEach,expect,it,vi} from 'vitest';
import {readPublicTableRequest} from './publicTableTransport';
const read=(send:typeof fetch,signal=new AbortController().signal,key='fixed-anon')=>readPublicTableRequest('https://fixture.invalid',key,'tour','table',signal,send);
afterEach(()=>vi.useRealTimers());
it('uses fixed public credentials, exact scope, no cache/session and never falls back',async()=>{
 const send=vi.fn().mockResolvedValue(new Response('{"access":"revoked"}'));
 expect((await read(send)).data).toEqual({access:'revoked'});
 const [url,init]=send.mock.calls[0];expect(String(url)).toBe('https://fixture.invalid/functions/v1/public-player-hud');
 expect(init.headers).toEqual({apikey:'fixed-anon',Authorization:'Bearer fixed-anon','Content-Type':'application/json'});
 expect(JSON.parse(init.body)).toEqual({mode:'current_table',tournament_id:'tour',table_id:'table'});
 expect(init).toMatchObject({cache:'no-store',credentials:'omit',redirect:'error'});expect(send).toHaveBeenCalledTimes(1);
});
it('supports publishable public keys without installing a user JWT',async()=>{
 const send=vi.fn().mockResolvedValue(new Response('{"access":"revoked"}'));await read(send,undefined,'sb_publishable_fixture');
 expect(send.mock.calls[0][1].headers.Authorization).toBeUndefined();
});
it.each([400,403,500,503])('keeps HTTP %s as an error and withholds response body',async status=>{
 const send=vi.fn().mockResolvedValue(new Response('private diagnostic',{status}));
 await expect(read(send)).rejects.toMatchObject({message:'PUBLIC_TABLE_UNAVAILABLE',publicTableHttpStatus:status});expect(send).toHaveBeenCalledTimes(1);
});
it('does not send cancelled scope reads and isolates sibling cancellation',async()=>{
 const a=new AbortController();a.abort();const send=vi.fn();await expect(read(send,a.signal)).rejects.toMatchObject({name:'AbortError'});expect(send).not.toHaveBeenCalled();
 const b=new AbortController(),c=new AbortController();
 const held=vi.fn((_url:unknown,init:RequestInit)=>new Promise<Response>((_resolve,reject)=>{init.signal!.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});})) as unknown as typeof fetch;
 const first=read(held,b.signal),second=read(held,c.signal);b.abort();await expect(first).rejects.toMatchObject({name:'AbortError',publicTableCallerCancelled:true});expect(c.signal.aborted).toBe(false);
 c.abort();await expect(second).rejects.toMatchObject({name:'AbortError'});
});
it('keeps the five-second deadline through response JSON consumption',async()=>{
 vi.useFakeTimers();const caller=new AbortController();
 const send=vi.fn(async(_url:unknown,init:RequestInit)=>({ok:true,json:()=>new Promise((_resolve,reject)=>init.signal!.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}))} as Response));
 const pending=read(send as typeof fetch,caller.signal),rejection=expect(pending).rejects.toMatchObject({name:'TimeoutError',message:'PUBLIC_TABLE_DEADLINE'});
 await vi.advanceTimersByTimeAsync(5000);await rejection;expect(caller.signal.aborted).toBe(false);expect(vi.getTimerCount()).toBe(0);
});
it('sanitizes malformed successful bodies without retry or stale fallback',async()=>{
 const send=vi.fn().mockResolvedValue(new Response('private invalid JSON'));await expect(read(send)).rejects.toThrow('PUBLIC_TABLE_UNAVAILABLE');expect(send).toHaveBeenCalledTimes(1);
});
it('does not relabel a known HTTP failure as intentional after its caller aborts',async()=>{
 const caller=new AbortController(),send=vi.fn(async()=>{caller.abort();return new Response('private',{status:503});});
 const result=await read(send,caller.signal).catch(error=>error);
 expect(result).toMatchObject({message:'PUBLIC_TABLE_UNAVAILABLE',publicTableHttpStatus:503});expect(result.publicTableCallerCancelled).toBeUndefined();
});
