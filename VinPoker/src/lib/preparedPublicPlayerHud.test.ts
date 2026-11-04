import {it,expect,vi,beforeEach} from 'vitest';
import {loadPreparedPublicPlayerHud,loadPublicHudHistoryPage} from './preparedPublicPlayerHud';
const invoke=vi.hoisted(()=>vi.fn());
vi.mock('@/integrations/supabase/client',()=>({supabase:{}}));
vi.mock('./publicHudTransport',()=>({readPublicHudRequest:async(_url,_key,body,signal)=>{
 const reply=await invoke('public-player-hud',{body,signal});if(reply.error)throw reply.error;return reply.data;
}}));
const t='10000000-0000-4000-8000-000000000001',p='30000000-0000-4000-8000-000000000001';
const keys=['vpip','pfr','threeBet','foldToThreeBet','fourBet','fiveBet','wtsd','wsd','wwsf','flopCbet','turnCbet','foldToCbet','checkRaise','aggressionFrequency','ats','flopFoldCbet','flopCallCbet','flopRaiseCbet','turnFoldCbet','turnCallCbet','turnRaiseCbet','riverAggression'];
const summary=()=>({access:'public',state:'current',tournamentId:t,playerId:p,name:'TEST',avatarUrl:null,scope:'all-public-tournaments',version:'public-hud-projection-v1',revision:'42',accessSnapshot:'1:2:',accessChanged:false,computedAt:'2026-11-04T00:00:00Z',coverageComplete:true,counters:{publicHands:1_000_000,omittedHands:0},totalWinnings:null,recentResults:[],analytics:{handsObserved:1_000_000,unavailableMetrics:[],metrics:Object.fromEntries(keys.map(k=>[k,{numerator:250_000,denominator:1_000_000,percentage:25,sampleSize:1_000_000,metricVersion:'test'}]))}});
const history=()=>({access:'public',state:'current',tournamentId:t,playerId:p,name:'TEST',handHistory:[],nextCursor:null});
beforeEach(()=>{invoke.mockReset();invoke.mockImplementation((_n,{body})=>Promise.resolve({data:body.mode==='summary'?summary():history(),error:null}));});
it('opens a million-hand aggregate without waiting for tour history',async()=>{
  const value=await loadPreparedPublicPlayerHud(t,p,new AbortController().signal);
  expect(value.lifetimeHands).toBe(1_000_000);expect(value.revision).toBe('42');expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke.mock.calls.map(c=>c[1].body.mode)).toEqual(['summary']);
});
it('returns a frozen value; opening again reads the new revision',async()=>{
  const first=await loadPreparedPublicPlayerHud(t,p,new AbortController().signal);
  invoke.mockImplementation((_n,{body})=>Promise.resolve({data:body.mode==='summary'?{...summary(),revision:'43'}:history(),error:null}));
  const second=await loadPreparedPublicPlayerHud(t,p,new AbortController().signal);
  expect(first.revision).toBe('42');expect(second.revision).toBe('43');expect(invoke).toHaveBeenCalledTimes(2);
});
it('checks reconnect access with one summary read and preserves the opened revision',async()=>{
  const frozen=await loadPreparedPublicPlayerHud(t,p,new AbortController().signal);invoke.mockClear();
  invoke.mockResolvedValue({data:{...summary(),revision:'43'},error:null});
  expect(await loadPreparedPublicPlayerHud(t,p,new AbortController().signal,frozen)).toBe(frozen);
  expect(invoke).toHaveBeenCalledTimes(1);expect(invoke.mock.calls[0][1].body).toMatchObject({mode:'summary',access_snapshot:'1:2:'});
});
it('checks an invalidated scope before history and skips history while warming or revoked',async()=>{
 for(const data of [{access:'public',state:'warming'},{access:'revoked'}]){
  invoke.mockReset();invoke.mockResolvedValue({data,error:null});
  await expect(loadPreparedPublicPlayerHud(t,p,new AbortController().signal)).rejects.toThrow();
  expect(invoke).toHaveBeenCalledTimes(1);expect(invoke.mock.calls[0][1].body.mode).toBe('summary');
 }
 invoke.mockReset();invoke.mockImplementation((_n,{body})=>Promise.resolve({data:body.mode==='summary'?summary():history(),error:null}));
 await loadPreparedPublicPlayerHud(t,p,new AbortController().signal);
 expect(invoke.mock.calls.map(c=>c[1].body.mode)).toEqual(['summary']);
});
it('never reuses another player or tournament snapshot',async()=>{
  const frozen=await loadPreparedPublicPlayerHud(t,p,new AbortController().signal);invoke.mockClear();
  for(const different of [{...frozen,playerId:t},{...frozen,tournamentId:p}])await expect(loadPreparedPublicPlayerHud(t,p,new AbortController().signal,different)).rejects.toThrow('PUBLIC_HUD_SCOPE_UNAVAILABLE');
  expect(invoke).not.toHaveBeenCalled();
});
it('replaces invalidated totals without coupling their revision to history',async()=>{
  const frozen=await loadPreparedPublicPlayerHud(t,p,new AbortController().signal);invoke.mockClear();
  invoke.mockImplementation((_n,{body})=>Promise.resolve({data:body.mode==='summary'?{...summary(),revision:'43',accessChanged:true}:history(),error:null}));
  const updated=await loadPreparedPublicPlayerHud(t,p,new AbortController().signal,frozen);
  expect(updated.revision).toBe('43');expect(invoke.mock.calls.map(c=>c[1].body.mode)).toEqual(['summary']);
});
it('signals known access invalidation before returning replacement totals',async()=>{
  const frozen=await loadPreparedPublicPlayerHud(t,p,new AbortController().signal);
  const invalidated=vi.fn();
  invoke.mockResolvedValue({data:{...summary(),accessChanged:true},error:null});
  const next=loadPreparedPublicPlayerHud(t,p,new AbortController().signal,frozen,invalidated);
  await vi.waitFor(()=>expect(invalidated).toHaveBeenCalledTimes(1));
  expect((await next).accessChanged).toBe(true);
});
it('does not fall back to raw scans for warming, revoked or incompatible snapshots',async()=>{
  for(const data of [{access:'public',state:'warming'},{access:'revoked'},{...summary(),version:'incompatible'}]){
    invoke.mockImplementation((_n,{body})=>Promise.resolve({data:body.mode==='summary'?data:history(),error:null}));
    await expect(loadPreparedPublicPlayerHud(t,p,new AbortController().signal)).rejects.toThrow();
  }
  expect(invoke.mock.calls.every(c=>['summary','history'].includes(c[1].body.mode))).toBe(true);
});
it('aborts sibling work on failure and makes no request after closure',async()=>{
  const controller=new AbortController();controller.abort();
  await expect(loadPreparedPublicPlayerHud(t,p,controller.signal)).rejects.toThrow('aborted');expect(invoke).not.toHaveBeenCalled();
  let signal:AbortSignal;
  invoke.mockImplementation((_n,options)=>{signal=options.signal;return Promise.resolve({data:null,error:Error('failed')});});
  await expect(loadPreparedPublicPlayerHud(t,p,new AbortController().signal)).rejects.toThrow('failed');expect(signal!.aborted).toBe(true);
});
it('keeps history cursors independent from the aggregate and rejects a repeated cursor',async()=>{
  const cursor={playedAt:null,handId:p};invoke.mockResolvedValue({data:{...history(),nextCursor:cursor},error:null});
  await expect(loadPublicHudHistoryPage(t,p,new AbortController().signal,cursor)).rejects.toThrow('PUBLIC_HUD_REPEATED_CURSOR');
  expect(invoke.mock.calls[0][1].body).toMatchObject({mode:'history',cursor});
});
