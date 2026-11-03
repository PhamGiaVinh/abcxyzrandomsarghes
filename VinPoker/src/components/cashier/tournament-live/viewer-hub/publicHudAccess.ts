import type {SupabaseClient,RealtimeChannel} from '@supabase/supabase-js';
type Client=Pick<SupabaseClient,'channel'|'removeChannel'>;
interface Entry {channel:RealtimeChannel;listeners:Set<()=>void>;online:boolean;fallback:boolean}
const entries=new WeakMap<object,Entry>();
/** Lifetime counters can include any public tour. Revocation is global, contains
 * no player/tour data, and is separate from ordinary metric-update broadcasts. */
export function observePublicHudAccess(client:Client,revalidate:()=>void){
  let entry=entries.get(client);
  if(!entry){
    const channel=client.channel('public:player-hud-access-v1',{config:{private:false}});
    entry={channel,listeners:new Set(),online:false,fallback:false};entries.set(client,entry);
    const owned=entry;
    channel.on('broadcast',{event:'revoked'},message=>{
      if(message.payload?.scope!=='all-public-player-hud'||typeof message.payload?.revision!=='string')return;
      for(const listener of owned.listeners)listener();
    });
    owned.listeners.add(revalidate);
    channel.subscribe(status=>{
      if(entries.get(client)!==owned)return;
      owned.online=status==='SUBSCRIBED';
      if(owned.online||(!owned.fallback&&['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status))){
        owned.fallback=true;for(const listener of owned.listeners)listener();
      }
    });
  }else{
    entry.listeners.add(revalidate);
    if(entry.online||entry.fallback)void Promise.resolve().then(()=>{if(entry!.listeners.has(revalidate))revalidate();});
  }
  const owned=entry;
  return()=>{
    owned.listeners.delete(revalidate);
    void Promise.resolve().then(()=>{if(owned.listeners.size||entries.get(client)!==owned)return;entries.delete(client);void client.removeChannel(owned.channel);});
  };
}
