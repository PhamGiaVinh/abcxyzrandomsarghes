import {webcrypto} from 'node:crypto';
import { describe,it,expect,vi } from 'vitest';
import { readPublicPlayerHud,readPublicPlayerHudManifest } from '../../supabase/functions/public-player-hud/handler';
const T='12ea401a-9790-4c3f-8aed-818cd1d5eddd',P='24fe3ccd-fbe8-4311-9a83-cf12e596c5a1';
function client(options:{access?:string;count?:number;prize?:number;changed?:boolean;hands?:boolean;proof?:'verified'|'missing'|'malformed';external?:number;badEnding?:boolean;tour?:string;publicOther?:boolean;handCount?:number}={}) {
  const calls:any[]=[];let handReads=0;
  const h={tournament_id:options.tour??T,id:'hand',status:'completed',is_voided:false,source_revision:1,button_seat:1,community_cards:options.proof?['AS','KD','QC','JS','2D']:[],hand_time:'2026-11-03',hand_number:1,tournament_table_id:T,table_session_id:T};
  const rpc=vi.fn(async(name:string,args:{p_tournament_id?:string})=>name==='get_public_tournament_settlement'
    ? {data:options.proof==='missing'?{status:'pending'}:{schemaVersion:options.proof==='malformed'?'bad':'settlement-outcome-v1',status:'verified',players:[{playerId:P,startingStack:100,netDelta:75,externalDelta:options.external??0,endingStack:options.badEnding?999:175+(options.external??0)}],pots:[{winnerIds:[P]}],handRanks:[{playerId:P},{playerId:'opponent'}]},error:null}
    : {data:{ok:true,access:args.p_tournament_id!==T&&options.publicOther===false?'revoked':options.access??'public',tournamentId:args.p_tournament_id??T,sections:{ranking:{items:[{playerId:P,name:'TEST'}]}}},error:null});
  const from=vi.fn((table:string)=>{
    calls.push({table,ops:[]});const entry=calls.at(-1);
    let reply:any={data:[],error:null};
    if(table==='tournament_hands'){handReads++;reply.data=options.hands?Array.from({length:options.handCount??1},(_,i)=>({...h,id:options.handCount?`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`:h.id,source_revision:options.changed&&handReads>1?2:1})):[];}
    if(table==='hand_players') reply.data=[{hand_id:'hand',player_id:P,seat_number:1,starting_stack:100},{hand_id:'hand',player_id:'opponent',seat_number:2,starting_stack:100}];
    if(table==='hand_actions' && options.proof) reply.data=[{hand_id:'hand',player_id:P,street:'preflop',action_type:'post_sb',action_amount:50,action_order:1},{hand_id:'hand',player_id:'opponent',street:'preflop',action_type:'post_bb',action_amount:100,action_order:2},{hand_id:'hand',player_id:P,street:'preflop',action_type:'all_in',action_amount:50,action_order:3}];
    if(table==='player_results') reply={data:[{tournament_name:'TEST',event_date:'2026-11-03',position:1,total_entries:9,prize:options.prize??100}],count:options.count??1,error:null};
    const q:any={then:(resolve:any,reject:any)=>Promise.resolve(reply).then(resolve,reject)};
    for(const method of ['select','eq','or','order','limit','in','range','lte','gt'])q[method]=(...args:any[])=>{entry.ops.push([method,...args]);return q;};
    return q;
  });return {rpc,from,calls};
}
describe('public HUD scoped reader',()=>{
  it('denies revoked tournaments before reading any hand or history',async()=>{
    const c=client({access:'revoked'});await expect(readPublicPlayerHud(c,T,P)).rejects.toThrow('PUBLIC_SCOPE_UNAVAILABLE');expect(c.from).not.toHaveBeenCalled();
  });
  it('rejects player identity from another tournament',async()=>{
    await expect(readPublicPlayerHud(client(),T,'5102e1ae-5535-412e-abb8-2d2c4db21171')).rejects.toThrow('PUBLIC_PLAYER_NOT_FOUND');
  });
  it('returns unknown percentages for a valid player with no completed hands',async()=>{
    const c=client();const result=await readPublicPlayerHud(c,T,P);
    expect(result.analytics.handsObserved).toBe(0);expect(result.analytics.metrics.vpip.percentage).toBeNull();
    expect(c.calls.find(x=>x.table==='tournament_hands').ops).toContainEqual(['eq','status','completed']);
    expect(c.calls.find(x=>x.table==='tournament_hands').ops).toContainEqual(['eq','participation.player_id',P]);
    expect(result.handHistory).toEqual([]);
    expect(JSON.stringify(c.calls)).not.toMatch(/hole_cards|service_role|profiles|payment/);
  });
  it('does not mistake a capped result set for complete winnings',async()=>{
    expect((await readPublicPlayerHud(client({count:1001}),T,P)).totalWinnings).toBeNull();
    expect((await readPublicPlayerHud(client({count:1}),T,P)).totalWinnings).toBe(100);
  });
  it('fails closed after a concurrent hand revision change',async()=>{
    await expect(readPublicPlayerHud(client({hands:true,changed:true}),T,P)).rejects.toThrow('PUBLIC_SAMPLE_CHANGED');
  });
  it('rejects malformed scope before queries',async()=>{
    const c=client();await expect(readPublicPlayerHud(c,'bad',P)).rejects.toThrow('PUBLIC_SCOPE_INVALID');expect(c.rpc).not.toHaveBeenCalled();
  });
  it('uses verified public showdown proof and never invents it from stacks',async()=>{
    const result=await readPublicPlayerHud(client({hands:true,proof:'verified'}),T,P);
    expect(result.analytics.metrics.wsd).toMatchObject({numerator:1,denominator:1,percentage:100});
    expect(result.analytics.metrics.wtsd.percentage).toBe(100);
    expect(result.handHistory).toEqual([expect.objectContaining({handId:'hand',tableId:T,tableSessionId:T,handNumber:1,endingStack:175,netDelta:75})]);
  });
  it.each(['missing','malformed'] as const)('keeps W$SD unknown with %s proof',async proof=>{
    const result=await readPublicPlayerHud(client({hands:true,proof}),T,P);
    expect(result.analytics.metrics.wsd.percentage).toBeNull();
    expect(result.handHistory[0]).toMatchObject({endingStack:null,netDelta:null});
  });
});

it('includes verified external adjustments and rejects inconsistent ending stack',async()=>{
  expect((await readPublicPlayerHud(client({hands:true,proof:'verified',external:50}),T,P)).handHistory[0]).toMatchObject({endingStack:225,netDelta:75});
  expect((await readPublicPlayerHud(client({hands:true,proof:'verified',badEnding:true}),T,P)).handHistory[0]).toMatchObject({endingStack:null,netDelta:null});
});

it('authorizes each other source tournament for lifetime metrics and keeps replay in the current tour',async()=>{
 const other='5102e1ae-5535-412e-abb8-2d2c4db21171';
 const c=client({hands:true,proof:'verified',tour:other});
 const r=await readPublicPlayerHud(c,T,P,{mode:'lifetime'});
 expect(r.scope).toBe('all-public-tournaments');expect(r.analytics.handsObserved).toBe(1);expect(r.handHistory).toEqual([]);
 expect(c.rpc).toHaveBeenCalledWith('get_public_tournament_viewer_snapshot_v2',expect.objectContaining({p_tournament_id:other}));
 const denied=client({hands:true,proof:'verified',tour:other,publicOther:false});
 const hidden=await readPublicPlayerHud(denied,T,P,{mode:'lifetime'});
 expect(hidden.analytics.handsObserved).toBe(0);expect(hidden.sampledTournamentHands).toBe(0);
 expect(denied.calls.some(x=>x.table==='hand_actions')).toBe(false);
});
it('continues past full excluded pages instead of treating them as the end of history',async()=>{
 const c=client({hands:true,tour:'5102e1ae-5535-412e-abb8-2d2c4db21171',publicOther:false,handCount:51});
 const r=await readPublicPlayerHud(c,T,P,{mode:'lifetime',after:'00000000-0000-4000-8000-000000000001',asOf:'2026-01-01T00:00:00.000Z'});
 expect(r.sampledTournamentHands).toBe(0);expect(r.nextCursor).toBe('00000000-0000-4000-8000-000000000050');
 expect(c.calls.find(x=>x.table==='tournament_hands').ops).toContainEqual(['gt','id','00000000-0000-4000-8000-000000000001']);
 expect(c.calls.find(x=>x.table==='tournament_hands').ops).toContainEqual(['lte','created_at','2026-01-01T00:00:00.000Z']);
});

it('manifest detects a previously counted hand edit, void or completion and excludes private facts',async()=>{
 vi.stubGlobal('crypto',webcrypto);
 const asOf='2026-01-01T00:00:00.000Z';
 const stable=await readPublicPlayerHudManifest(client({hands:true}),T,P,asOf);
 const changing=client({hands:true,changed:true});
 await readPublicPlayerHudManifest(changing,T,P,asOf);
 const edited=await readPublicPlayerHudManifest(changing,T,P,asOf);
 expect(edited.digest).not.toBe(stable.digest);
 const empty=await readPublicPlayerHudManifest(client(),T,P,asOf);
 const privateOnly=await readPublicPlayerHudManifest(client({hands:true,tour:'5102e1ae-5535-412e-abb8-2d2c4db21171',publicOther:false}),T,P,asOf);
 expect(privateOnly.digest).toBe(empty.digest);
 vi.unstubAllGlobals();
});
