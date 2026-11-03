import { describe,it,expect,vi } from 'vitest';
import { readPublicPlayerHud } from '../../supabase/functions/public-player-hud/handler';
const T='12ea401a-9790-4c3f-8aed-818cd1d5eddd',P='24fe3ccd-fbe8-4311-9a83-cf12e596c5a1';
function client(options:{access?:string;count?:number;prize?:number;changed?:boolean;hands?:boolean;proof?:'verified'|'missing'|'malformed'}={}) {
  const calls:any[]=[];let handReads=0;
  const h={id:'hand',status:'completed',is_voided:false,source_revision:1,button_seat:1,community_cards:options.proof?['AS','KD','QC','JS','2D']:[],hand_time:'2026-11-03'};
  const rpc=vi.fn(async(name:string)=>name==='get_public_tournament_settlement'
    ? {data:options.proof==='missing'?{status:'pending'}:{schemaVersion:options.proof==='malformed'?'bad':'settlement-outcome-v1',status:'verified',pots:[{winnerIds:[P]}],handRanks:[{playerId:P},{playerId:'opponent'}]},error:null}
    : {data:{ok:true,access:options.access??'public',tournamentId:T,sections:{ranking:{items:[{playerId:P,name:'TEST'}]}}},error:null});
  const from=vi.fn((table:string)=>{
    calls.push({table,ops:[]});const entry=calls.at(-1);
    let reply:any={data:[],error:null};
    if(table==='tournament_hands'){handReads++;reply.data=options.hands?[{...h,source_revision:options.changed&&handReads>1?2:1}]:[];}
    if(table==='hand_players') reply.data=[{hand_id:'hand',player_id:P,seat_number:1,starting_stack:100},{hand_id:'hand',player_id:'opponent',seat_number:2,starting_stack:100}];
    if(table==='hand_actions' && options.proof) reply.data=[{hand_id:'hand',player_id:P,street:'preflop',action_type:'post_sb',action_amount:50,action_order:1},{hand_id:'hand',player_id:'opponent',street:'preflop',action_type:'post_bb',action_amount:100,action_order:2},{hand_id:'hand',player_id:P,street:'preflop',action_type:'all_in',action_amount:50,action_order:3}];
    if(table==='player_results') reply={data:[{tournament_name:'TEST',event_date:'2026-11-03',position:1,total_entries:9,prize:options.prize??100}],count:options.count??1,error:null};
    const q:any={then:(resolve:any,reject:any)=>Promise.resolve(reply).then(resolve,reject)};
    for(const method of ['select','eq','or','order','limit','in','range'])q[method]=(...args:any[])=>{entry.ops.push([method,...args]);return q;};
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
  });
  it.each(['missing','malformed'] as const)('keeps W$SD unknown with %s proof',async proof=>{
    const result=await readPublicPlayerHud(client({hands:true,proof}),T,P);
    expect(result.analytics.metrics.wsd.percentage).toBeNull();
  });
});
