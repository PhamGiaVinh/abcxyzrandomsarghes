import type {SupabaseClient,RealtimeChannel} from '@supabase/supabase-js';
type Client=Pick<SupabaseClient,'channel'|'removeChannel'>;
export type PublicTournamentComponent='tables'|'ranking'|'payout'|'visibility'|'clock';
export interface PublicTournamentSignal {reason:'changed'|'verify'|'status';components:PublicTournamentComponent[];revisions:Record<string,string>;online:boolean}
const all:PublicTournamentComponent[]=['tables','ranking','payout','visibility','clock'];
const hubs=new WeakMap<object,Map<string,PublicTournamentRealtime>>();

/** One public channel and one fallback timer per client/tournament in this tab. */
class PublicTournamentRealtime {
  private listeners=new Set<(event:PublicTournamentSignal)=>void>();
  private channel:RealtimeChannel|null=null;
  private timer:ReturnType<typeof setTimeout>|null=null;
  private online=false;
  private failures=0;
  private stopped=false;
  readonly epochs:Partial<Record<PublicTournamentComponent,number>>={};
  constructor(private client:Client,private tournamentId:string,private dispose:()=>void){}
  add(listener:(event:PublicTournamentSignal)=>void){
    this.listeners.add(listener);
    if(!this.channel){
      document.addEventListener('visibilitychange',this.visibility);
      this.channel=this.client.channel(`public:tournament-viewer-v2:${this.tournamentId}`,{config:{private:false}});
      this.channel.on('broadcast',{event:'changed'},message=>{
        if(this.stopped)return;
        const payload=message?.payload as {tournamentId?:unknown;components?:unknown;revisions?:unknown};
        if(payload?.tournamentId!==this.tournamentId)return;
        const requested=payload.components;
        const components=Array.isArray(requested)?all.filter(c=>requested.includes(c)):all;
        if(!components.length)return;
        if(document.visibilityState==='hidden'&&!components.includes('visibility'))return;
        const revisions:Record<string,string>={};
        if(payload.revisions&&typeof payload.revisions==='object')for(const c of components){
          const value=(payload.revisions as Record<string,unknown>)[c];if(typeof value==='string')revisions[c]=value;
        }
        for(const component of components)this.epochs[component]=(this.epochs[component]??0)+1;
        this.emit({reason:'changed',components,revisions,online:this.online});
      }).subscribe(status=>{
        if(this.stopped)return;
        this.online=status==='SUBSCRIBED';
        this.emit({reason:'status',components:all,revisions:{},online:this.online});
        if(this.online){this.failures=0;this.emit({reason:'verify',components:all,revisions:{},online:true});}
        this.schedule();
      });
      this.schedule();
    }
    listener({reason:'status',components:all,revisions:{},online:this.online});
    return()=>{
      this.listeners.delete(listener);if(this.listeners.size)return;
      // React scope effects detach/attach in the same turn. Keep the channel
      // through that handoff, then dispose if the tournament has no consumers.
      void Promise.resolve().then(()=>{
        if(this.listeners.size||this.stopped)return;
        this.stopped=true;this.clearTimer();document.removeEventListener('visibilitychange',this.visibility);
        if(this.channel)void this.client.removeChannel(this.channel);this.channel=null;this.dispose();
      });
    };
  }
  report(success:boolean){this.failures=success?0:Math.min(this.failures+1,4);}
  private emit(event:PublicTournamentSignal){for(const listener of this.listeners)listener(event);}
  private clearTimer(){if(this.timer)clearTimeout(this.timer);this.timer=null;}
  private schedule(){
    this.clearTimer();if(this.stopped||document.visibilityState==='hidden')return;
    const base=this.online?30_000:Math.min(30_000,3_000*2**this.failures);
    const delay=Math.round(base*(.9+Math.random()*.2));
    this.timer=setTimeout(()=>{this.timer=null;this.emit({reason:'verify',components:all,revisions:{},online:this.online});this.schedule();},delay);
  }
  private visibility=()=>{
    this.clearTimer();if(document.visibilityState!=='hidden'){this.emit({reason:'verify',components:all,revisions:{},online:this.online});this.schedule();}
  };
}
export function observePublicTournament(client:Client,tournamentId:string,listener:(event:PublicTournamentSignal)=>void){
  let entries=hubs.get(client);if(!entries){entries=new Map();hubs.set(client,entries);}
  let hub=entries.get(tournamentId);
  if(!hub){hub=new PublicTournamentRealtime(client,tournamentId,()=>entries!.delete(tournamentId));entries.set(tournamentId,hub);}
  return {unsubscribe:hub.add(listener),reportResult:(success:boolean)=>hub!.report(success)};
}
export function reportPublicTournamentRead(client:object,tournamentId:string,success:boolean){hubs.get(client)?.get(tournamentId)?.report(success);}
// Broadcast revisions are untrusted hints. Fence replies by the local request
// epoch; never let a client-sent high revision poison an authoritative floor.
export function publicReadEpoch(client:object,tournamentId:string,component:PublicTournamentComponent){return hubs.get(client)?.get(tournamentId)?.epochs[component]??0;}
export function publicReadEpochIsCurrent(client:object,tournamentId:string,component:PublicTournamentComponent,epoch:number){return publicReadEpoch(client,tournamentId,component)===epoch;}
