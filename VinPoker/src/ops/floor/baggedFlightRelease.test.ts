import {describe,expect,it} from 'vitest';
import {parseBaggedFlightContext,releaseBaggedFlightArgs,verifiedBaggedReleaseReceipt} from './baggedFlightRelease';
const flight='fdf91018-09f3-4cdc-b76a-f688eb216cee',event='dbb49f8d-7d47-4c2c-afd9-f57062c9971d';
const table={tournamentTableId:'8ce69933-b2d0-4dfe-962e-86709c6222ac',tableSessionId:'c3f4dcfe-6dd1-4ef4-8cec-e0a9cf613e55',
 revision:10,name:'Paid journey TEST 1',playerCount:8,baggedTotal:160000,state:'open'};
const context={flightId:flight,eventId:event,releaseEnabled:true,state:'locked',rosterHash:'9b83697a48dba8fac105ffbf058147a1',dayVersion:1,tables:[table]};
const intent={actorId:'675fe35e-60a8-4452-bb90-e79486d54da6',eventId:event,flightId:flight,
 ...table,rosterHash:context.rosterHash,dayVersion:1,requestId:'17900000-0000-4000-8000-000000000001'};
describe('bagged Flight Floor read/write boundary',()=>{
 it('accepts the exact server source/session context, not a guessed physical table',()=>{
  expect(parseBaggedFlightContext(context,event,flight).tables[0]).toEqual(table);
 });
 it.each([null,{...context,eventId:flight},{...context,flightId:event},{...context,dayVersion:null},
  {...context,tables:[table,table]},{...context,tables:[{...table,revision:null}]},
  {...context,tables:[{...table,playerCount:0}]},{...context,tables:[{...table,baggedTotal:-1}]}])('rejects unverified context %j',value=>{
  expect(()=>parseBaggedFlightContext(value,event,flight)).toThrow();
 });
 it('retains an explicit blocked row with unknown revision instead of hiding it',()=>{
  expect(parseBaggedFlightContext({...context,tables:[{...table,state:'blocked',revision:null,name:null}]},event,flight).tables[0].state).toBe('blocked');
 });
 it('sends only canonical intent fields; never submits chip counts, actor or physical-table IDs',()=>{
  expect(releaseBaggedFlightArgs(intent)).toEqual({p_tournament_table_id:table.tournamentTableId,p_table_session_id:table.tableSessionId,
   p_expected_revision:10,p_expected_roster_hash:context.rosterHash,p_expected_day_version:1,p_request_id:intent.requestId});
 });
 const receipt={ok:true,closed:true,status:'bagged',tournament_table_id:table.tournamentTableId,
  table_session_id:table.tableSessionId,revision:11,releasedPlayers:8,baggedTotal:160000,rosterHash:context.rosterHash,dayVersion:1};
 it('accepts only a receipt for the retained exact intent',()=>expect(verifiedBaggedReleaseReceipt(receipt,intent)).toBe(true));
 it.each([null,{...receipt,status:'closed'},{...receipt,table_session_id:event},{...receipt,revision:10},
  {...receipt,releasedPlayers:7},{...receipt,baggedTotal:0},{...receipt,rosterHash:'wrong'}])('keeps unknown result pending %j',value=>{
  expect(verifiedBaggedReleaseReceipt(value,intent)).toBe(false);
 });
});
