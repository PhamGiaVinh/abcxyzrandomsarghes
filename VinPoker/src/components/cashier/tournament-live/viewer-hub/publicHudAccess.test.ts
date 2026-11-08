import {it,expect,vi} from 'vitest';
import {observePublicHudAccess} from './publicHudAccess';
it('waits for a confirmed subscription, revalidates every tour context and rechecks after reconnect',async()=>{
 let status!:(value:string)=>void,changed!:(value:unknown)=>void;
 const channel={on:vi.fn((_type,_event,callback)=>{changed=callback;return channel;}),subscribe:vi.fn(callback=>{status=callback;return channel;})};
 const client={channel:vi.fn(()=>channel),removeChannel:vi.fn()};
 const tourA=vi.fn(),tourB=vi.fn();
 const a=observePublicHudAccess(client as never,tourA),b=observePublicHudAccess(client as never,tourB);
 expect(client.channel).toHaveBeenCalledTimes(1);expect(tourA).not.toHaveBeenCalled();
 status('SUBSCRIBED');expect(tourA).toHaveBeenCalledTimes(1);expect(tourB).toHaveBeenCalledTimes(1);
 changed({payload:{scope:'all-public-player-hud',revision:'withdrawal-in-any-tour'}});
 expect(tourA).toHaveBeenCalledTimes(2);expect(tourB).toHaveBeenCalledTimes(2);
 status('CHANNEL_ERROR');status('SUBSCRIBED');expect(tourA).toHaveBeenCalledTimes(3);
 a();b();await Promise.resolve();expect(client.removeChannel).toHaveBeenCalledTimes(1);
});
