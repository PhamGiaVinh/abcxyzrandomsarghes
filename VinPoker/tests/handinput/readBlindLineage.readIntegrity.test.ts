import {beforeEach,expect,it,vi} from 'vitest';
const fixture=vi.hoisted(()=>({failedTable:null as string|null,missingHand:false}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:(table:string)=>{
  const response=()=>fixture.failedTable===table?{data:null,error:{message:'lineage read unavailable',code:'503'}}:{
    data:table==='tournament_hands'?(fixture.missingHand?null:{button_seat:1,status:'completed',is_voided:false,tracker_sb_position:2,tracker_bb_position:3})
      :table==='hand_players'?[1,2,3].map(seat=>({player_id:`p${seat}`,entry_number:1,seat_number:seat}))
      :[{player_id:'p2',entry_number:1,action_type:'post_sb'},{player_id:'p3',entry_number:1,action_type:'post_bb'}],error:null,
  };
  const query={select:()=>query,eq:()=>query,in:()=>query,maybeSingle:()=>Promise.resolve(response()),
    then:(resolve:(value:unknown)=>unknown,reject:(reason:unknown)=>unknown)=>Promise.resolve(response()).then(resolve,reject)};
  return query;
}}}));
import {readBlindLineage} from '@/lib/tournament/readBlindLineage';
beforeEach(()=>{fixture.failedTable=null;fixture.missingHand=false;});
it('returns verified stored lineage when all three reads succeed',async()=>{
  await expect(readBlindLineage('hand-test')).resolves.toEqual({previousDealtSeats:[1,2,3],previousButtonSeat:1,previousSbPosition:2,previousBbSeat:3});
});
it('distinguishes a genuinely absent hand from a failed read',async()=>{
  fixture.missingHand=true;await expect(readBlindLineage('hand-test')).resolves.toBeNull();
});
it.each(['tournament_hands','hand_actions','hand_players'])('does not treat %s read failure as missing history',async(table)=>{
  fixture.failedTable=table;
  await expect(readBlindLineage('hand-test')).rejects.toMatchObject({message:'lineage read unavailable'});
});
