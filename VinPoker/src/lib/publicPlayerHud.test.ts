import {beforeEach,expect,it,vi} from 'vitest';
import {loadPublicPlayerHud,combinePublicHudAnalytics} from './publicPlayerHud';
const {invoke,manifest}=vi.hoisted(()=>({invoke:vi.fn(),manifest:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:(name:string,options:{body:{mode?:string}})=>options.body.mode==='manifest'?manifest(name,options):invoke(name,options)}}}));
const T='12ea401a-9790-4c3f-8aed-818cd1d5eddd',P='24fe3ccd-fbe8-4311-9a83-cf12e596c5a1';
const keys=['vpip','pfr','threeBet','flopCbet','turnCbet','foldToCbet','wtsd','wsd','aggressionFrequency','ats','flopFoldCbet','flopCallCbet','flopRaiseCbet','turnFoldCbet','turnCallCbet','turnRaiseCbet','riverAggression'];
const cursor=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function page(mode='all-public-tournaments',n=1,total=50,next:string|null=null){return {tournamentId:T,playerId:P,name:'TEST',avatarUrl:null,sampledTournamentHands:total,truncated:next!==null,scope:mode,asOf:'2026-01-01T00:00:00.000Z',nextCursor:next,handHistory:[],totalWinnings:100,recentResults:[],analytics:{handsObserved:total,unavailableMetrics:[],metrics:Object.fromEntries(keys.map(key=>[key,{numerator:n,denominator:total,percentage:total?n/total*100:null,sampleSize:total,metricVersion:'test'}]))}};}
beforeEach(()=>{invoke.mockReset();manifest.mockReset();manifest.mockResolvedValue({error:null,data:{tournamentId:T,playerId:P,asOf:'2026-01-01T00:00:00.000Z',digest:'a'.repeat(64)}});});
it('aggregates 20000 hands across all pages without applying the old 50/500 hand cap',async()=>{
 let batch=0;const progress=vi.fn();
 invoke.mockImplementation((_name:string,{body}:{body:{mode?:string;after?:string;as_of?:string}})=>{
  if(!body.mode)return Promise.resolve({data:page('current-tournament',49,50),error:null});
  if(batch>0){expect(body.after).toBe(cursor(batch));expect(body.as_of).toBe('2026-01-01T00:00:00.000Z');}
  batch++;return Promise.resolve({data:page('all-public-tournaments',17,50,batch<400?cursor(batch):null),error:null});
 });
 const result=await loadPublicPlayerHud(T,P,new AbortController().signal,progress);
 expect(invoke).toHaveBeenCalledTimes(401);expect(result.lifetimeHands).toBe(20000);expect(result.analytics.handsObserved).toBe(20000);
 expect(result.analytics.metrics.vpip).toMatchObject({numerator:6800,denominator:20000,percentage:34});
 expect(progress).toHaveBeenLastCalledWith(20000);expect(result.sampledTournamentHands).toBe(50);
});
it('weights opportunity counts rather than averaging page percentages and preserves unavailable proof',()=>{
 const a=page('all-public-tournaments',1,1).analytics,b=page('all-public-tournaments',0,99).analytics;
 b.unavailableMetrics=['wsd'];
 const r=combinePublicHudAnalytics([a,b]);
 expect(r.metrics.vpip.percentage).toBe(1);expect(r.metrics.wsd.percentage).toBeNull();
 expect(r.unavailableMetrics).toContain('wsd');
});
it('does not present a partial lifetime sample as complete when any page fails',async()=>{
 invoke.mockResolvedValueOnce({data:page('current-tournament'),error:null}).mockResolvedValueOnce({data:page('all-public-tournaments',1,50,cursor(1)),error:null}).mockResolvedValueOnce({data:null,error:new Error('read failed')});
 await expect(loadPublicPlayerHud(T,P,new AbortController().signal)).rejects.toThrow('read failed');
});
it('rejects repeated cursors and keeps current-tournament replay separate from lifetime pages',async()=>{
 const current=page('current-tournament');current.handHistory=[];
 invoke.mockResolvedValueOnce({data:current,error:null}).mockResolvedValue({data:page('all-public-tournaments',1,50,cursor(1)),error:null});
 await expect(loadPublicPlayerHud(T,P,new AbortController().signal)).rejects.toThrow('PUBLIC_HUD_PAGE_MISMATCH');
});
it('aborts the traversal when the HUD is closed',async()=>{
 const controller=new AbortController();invoke.mockResolvedValue({data:page('current-tournament'),error:null});controller.abort();
 await expect(loadPublicPlayerHud(T,P,controller.signal)).rejects.toThrow('aborted');expect(invoke).toHaveBeenCalledTimes(1);
});

it('rejects the whole lifetime result when an earlier hand changes during the scan',async()=>{
 invoke.mockResolvedValueOnce({data:page('current-tournament'),error:null}).mockResolvedValueOnce({data:page(),error:null});
 manifest.mockResolvedValueOnce({error:null,data:{tournamentId:T,playerId:P,asOf:'2026-01-01T00:00:00.000Z',digest:'a'.repeat(64)}}).mockResolvedValueOnce({error:null,data:{tournamentId:T,playerId:P,asOf:'2026-01-01T00:00:00.000Z',digest:'b'.repeat(64)}});
 await expect(loadPublicPlayerHud(T,P,new AbortController().signal)).rejects.toThrow('PUBLIC_HUD_HISTORY_CHANGED');
});
