import {z} from 'zod';
const uuid=z.string().uuid(),count=z.number().int().nonnegative().safe();
const hash=z.string().regex(/^[a-f0-9]{32}$/);
const identity={tournamentTableId:uuid,tableSessionId:uuid,playerCount:count.positive(),baggedTotal:count};
const table=z.union([
 z.object({...identity,state:z.enum(['open','released']),revision:count,name:z.string().min(1)}),
 z.object({...identity,state:z.literal('blocked'),revision:count.nullable(),name:z.string().nullable()}),
]);
const contextSchema=z.object({flightId:uuid,eventId:uuid,releaseEnabled:z.boolean(),
 state:z.enum(['playing','bagging','locked']),rosterHash:hash.nullable(),dayVersion:count.nullable(),tables:z.array(table)});
export type BaggedFlightContext=z.infer<typeof contextSchema>;
export const baggedReleaseIntentSchema=z.object({...identity,actorId:uuid,eventId:uuid,flightId:uuid,
 revision:count,rosterHash:hash,dayVersion:count,requestId:uuid}).strict();
export type BaggedReleaseIntent=z.infer<typeof baggedReleaseIntentSchema>;

/** Preserve server source identity; malformed/foreign/duplicate rows are errors. */
export function parseBaggedFlightContext(data:unknown,eventId:string,flightId:string):BaggedFlightContext{
 const value=contextSchema.parse(data);
 if(value.eventId!==eventId||value.flightId!==flightId
  ||(value.state==='locked'&&(value.rosterHash===null||value.dayVersion===null))
  ||(value.state!=='locked'&&value.tables.length!==0)
  ||new Set(value.tables.map(row=>row.tableSessionId)).size!==value.tables.length
  ||new Set(value.tables.map(row=>row.tournamentTableId)).size!==value.tables.length)
  throw Error('BAGGED_FLIGHT_CONTEXT_UNVERIFIED');
 return value;
}
export function releaseBaggedFlightArgs(intent:BaggedReleaseIntent){
 return {p_tournament_table_id:intent.tournamentTableId,p_table_session_id:intent.tableSessionId,
  p_expected_revision:intent.revision,p_expected_roster_hash:intent.rosterHash,
  p_expected_day_version:intent.dayVersion,p_request_id:intent.requestId};
}
const receipt=z.object({ok:z.literal(true),closed:z.literal(true),status:z.literal('bagged'),
 tournament_table_id:uuid,table_session_id:uuid,revision:count,releasedPlayers:count.positive(),
 baggedTotal:count,rosterHash:hash,dayVersion:count});
/** A successful transport/ok flag alone cannot clear the retained write intent. */
export function verifiedBaggedReleaseReceipt(data:unknown,intent:BaggedReleaseIntent):boolean{
 const parsed=receipt.safeParse(data);if(!parsed.success)return false;
 const value=parsed.data;
 return value.tournament_table_id===intent.tournamentTableId&&value.table_session_id===intent.tableSessionId
  &&value.revision===intent.revision+1&&value.releasedPlayers===intent.playerCount
  &&value.baggedTotal===intent.baggedTotal&&value.rosterHash===intent.rosterHash&&value.dayVersion===intent.dayVersion;
}
