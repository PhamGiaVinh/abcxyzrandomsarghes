import {it,expect,vi,afterEach} from 'vitest';
import {observePublicTournament} from './publicTournamentRealtime';
function fixture(){
 let changed:(message:unknown)=>void,status:(value:string)=>void;
 const channel={on:vi.fn((_type,_event,callback)=>{changed=callback;return channel;}),subscribe:vi.fn(callback=>{status=callback;return channel;})};
 const client={channel:vi.fn(()=>channel),removeChannel:vi.fn()};
 return {client:client as never,channel:client.channel,remove:client.removeChannel,changed:(payload:unknown)=>changed({payload}),status:(value:string)=>status(value)};
}
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
it('shares one channel, preserves it across same-turn scope handoff and releases the last observer',async()=>{
 const f=fixture(),a=vi.fn(),b=vi.fn();
 const first=observePublicTournament(f.client,'tour',a),second=observePublicTournament(f.client,'tour',b);
 expect(f.channel).toHaveBeenCalledTimes(1);
 f.changed({tournamentId:'tour',components:['tables'],revisions:{tables:'9'}});
 expect(a).toHaveBeenLastCalledWith({reason:'changed',components:['tables'],revisions:{tables:'9'},online:false});
 first.unsubscribe();second.unsubscribe();const third=observePublicTournament(f.client,'tour',a);
 await Promise.resolve();expect(f.channel).toHaveBeenCalledTimes(1);expect(f.remove).not.toHaveBeenCalled();
 third.unsubscribe();await Promise.resolve();expect(f.remove).toHaveBeenCalledTimes(1);
});
it('uses a healthy 30s check, offline 3s polling and pauses in the background',async()=>{
 vi.useFakeTimers();vi.spyOn(Math,'random').mockReturnValue(.5);
 const visible=vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
 const f=fixture(),listener=vi.fn(),observation=observePublicTournament(f.client,'tour',listener);
 f.status('SUBSCRIBED');listener.mockClear();vi.advanceTimersByTime(29_999);expect(listener).not.toHaveBeenCalled();
 vi.advanceTimersByTime(1);expect(listener).toHaveBeenCalledTimes(1);
 f.status('CHANNEL_ERROR');listener.mockClear();vi.advanceTimersByTime(3_000);expect(listener).toHaveBeenCalledTimes(1);
 visible.mockReturnValue('hidden');document.dispatchEvent(new Event('visibilitychange'));listener.mockClear();
 vi.advanceTimersByTime(60_000);expect(listener).not.toHaveBeenCalled();
 f.changed({tournamentId:'tour',components:['tables']});expect(listener).not.toHaveBeenCalled();
 f.changed({tournamentId:'other',components:['visibility']});expect(listener).not.toHaveBeenCalled();
 f.changed({tournamentId:'tour',components:['visibility']});expect(listener).toHaveBeenCalledTimes(1);
 observation.unsubscribe();await Promise.resolve();
});
it('prioritizes table access on reconnect and cancels deferred metadata after scope disposal',async()=>{
 vi.useFakeTimers();vi.spyOn(Math,'random').mockReturnValue(.5);
 const f=fixture(),listener=vi.fn(),observation=observePublicTournament(f.client,'reconnect-tour',listener);
 f.status('SUBSCRIBED');f.status('CHANNEL_ERROR');listener.mockClear();f.status('SUBSCRIBED');
 const verifications=()=>listener.mock.calls.map(([event])=>event).filter(event=>event.reason==='verify');
 expect(verifications().map(event=>event.components)).toEqual([['tables']]);
 vi.advanceTimersByTime(5249);expect(verifications()).toHaveLength(1);
 vi.advanceTimersByTime(1);expect(verifications().map(event=>event.components)).toEqual([['tables'],['ranking','payout','clock']]);
 f.status('CHANNEL_ERROR');f.status('SUBSCRIBED');observation.unsubscribe();await Promise.resolve();listener.mockClear();
 vi.advanceTimersByTime(30_000);expect(listener).not.toHaveBeenCalled();
});
