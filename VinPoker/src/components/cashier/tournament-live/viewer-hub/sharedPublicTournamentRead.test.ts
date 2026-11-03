import {it,expect,vi} from 'vitest';
import {sharePublicTournamentRead} from './sharedPublicTournamentRead';
it('coalesces identical reads while one caller can cancel without aborting another',async()=>{
 const client={},a=new AbortController(),b=new AbortController();let finish!:(value:number)=>void,underlying!:AbortSignal;
 const read=vi.fn((signal:AbortSignal)=>{underlying=signal;return new Promise<number>(resolve=>{finish=resolve;});});
 const one=sharePublicTournamentRead(client,'scope',a.signal,read),two=sharePublicTournamentRead(client,'scope',b.signal,read);
 await Promise.resolve();expect(read).toHaveBeenCalledTimes(1);
 a.abort();await expect(one).rejects.toThrow('Aborted');expect(underlying.aborted).toBe(false);
 finish(42);expect(await two).toBe(42);
});
it('cancels abandoned requests, isolates scope keys and never caches a settled response',async()=>{
 const client={},a=new AbortController();let underlying!:AbortSignal;
 const pending=sharePublicTournamentRead(client,'old',a.signal,signal=>{underlying=signal;return new Promise(()=>{});});
 await Promise.resolve();a.abort();await expect(pending).rejects.toThrow();expect(underlying.aborted).toBe(true);
 const read=vi.fn(async()=>7);
 expect(await sharePublicTournamentRead(client,'new',new AbortController().signal,read)).toBe(7);
 expect(await sharePublicTournamentRead(client,'new',new AbortController().signal,read)).toBe(7);
 expect(read).toHaveBeenCalledTimes(2);
});
