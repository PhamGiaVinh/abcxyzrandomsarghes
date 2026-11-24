import {beforeEach,expect,it,vi} from 'vitest';
import {execFileSync} from 'node:child_process';
import {nextButtonFromBlindLineage} from '@/lib/tournament/deadButton';
const fixture=vi.hoisted(()=>({failedTable:null as string|null,missingHand:false,native:null as Record<string,unknown>|null}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:(table:string)=>{
  const response=()=>fixture.failedTable===table?{data:null,error:{message:'lineage read unavailable',code:'503'}}:{
    data:fixture.native?fixture.native[table]:table==='tournament_hands'?(fixture.missingHand?null:{button_seat:1,status:'completed',is_voided:false,tracker_sb_position:2,tracker_bb_position:3})
      :table==='hand_players'?[1,2,3].map(seat=>({player_id:`p${seat}`,entry_number:1,seat_number:seat}))
      :[{player_id:'p2',entry_number:1,action_type:'post_sb'},{player_id:'p3',entry_number:1,action_type:'post_bb'}],error:null,
  };
  const query={select:()=>query,eq:()=>query,in:()=>query,maybeSingle:()=>Promise.resolve(response()),
    then:(resolve:(value:unknown)=>unknown,reject:(reason:unknown)=>unknown)=>Promise.resolve(response()).then(resolve,reject)};
  return query;
}}}));
import {readBlindLineage,readHandBlindLevel} from '@/lib/tournament/readBlindLineage';
beforeEach(()=>{fixture.failedTable=null;fixture.missingHand=false;fixture.native=null;});
it('reads the frozen BB ante rule and seat positions, preserving legacy snapshots',async()=>{
 const frozen={tracker_level_number:1,tracker_small_blind:100,tracker_big_blind:200,tracker_bba:0};
 fixture.native={tournament_hands:frozen};
 expect(await readHandBlindLevel('hand')).toEqual({level_number:1,small_blind:100,big_blind:200,ante:0});
 fixture.native.tournament_hands={...frozen,tracker_bba:200,tracker_big_blind_ante_only:true,tracker_sb_position:null,tracker_bb_position:7};
 expect(await readHandBlindLevel('hand')).toEqual({level_number:1,small_blind:100,big_blind:200,ante:200,
  big_blind_ante_only:true,small_blind_seat:null,big_blind_seat:7});
});
it('rejects a conflicting frozen ante amount or missing BB seat',async()=>{
 const frozen={tracker_level_number:1,tracker_small_blind:100,tracker_big_blind:200,tracker_bba:0,
  tracker_big_blind_ante_only:true,tracker_sb_position:1,tracker_bb_position:2};
 fixture.native={tournament_hands:frozen};
 await expect(readHandBlindLevel('hand')).rejects.toThrow('tracker_hand_ante_rule_invalid');
 fixture.native.tournament_hands={...frozen,tracker_bba:200,tracker_bb_position:null};
 await expect(readHandBlindLevel('hand')).rejects.toThrow('tracker_hand_blind_positions_invalid');
});
it.skipIf(process.env.VINPOKER_NATIVE_DB_TEST!=='1')('reads actual Hand33 lineage and derives next HU button without changing stored evidence',async()=>{
 const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
 const sql=(input:string)=>execFileSync('wsl',args,{input,encoding:'utf8',timeout:10000}).trim();
 expect(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();")).toBe('vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
 fixture.native=JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';SET LOCAL ROLE authenticated;
 SELECT jsonb_build_object('tournament_hands',(SELECT to_jsonb(x) FROM(SELECT button_seat,status,is_voided,tracker_sb_position,tracker_bb_position FROM public.tournament_hands WHERE id='65e9cd23-c25e-4491-9c46-9b01c79676cf')x),
 'hand_actions',(SELECT jsonb_agg(to_jsonb(x)) FROM(SELECT player_id,entry_number,action_type FROM public.hand_actions WHERE hand_id='65e9cd23-c25e-4491-9c46-9b01c79676cf' AND action_type IN('post_sb','post_bb'))x),
 'hand_players',(SELECT jsonb_agg(to_jsonb(x)) FROM(SELECT player_id,entry_number,seat_number FROM public.hand_players WHERE hand_id='65e9cd23-c25e-4491-9c46-9b01c79676cf')x));ROLLBACK;`));
 const lineage=await readBlindLineage('65e9cd23-c25e-4491-9c46-9b01c79676cf');
 expect(lineage).toEqual({previousDealtSeats:[1,2],previousButtonSeat:1,previousSbPosition:1,previousBbSeat:2});
 if(!lineage)throw new Error('missing native lineage');
 expect(nextButtonFromBlindLineage({maxSeats:9,occupiedSeats:[1,2],...lineage})?.buttonSeat).toBe(2);
});
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
