export interface ParsedScheduleTournament {
 name:string;start_time:string;buy_in:number;starting_stack:number;
 game_type:'nlh'|'plo'|'mixed';venue?:string|null;
}

/** Validate the OCR response boundary. Missing values are not free buy-ins or default stacks. */
export function parseTournamentSchedule(value:unknown):ParsedScheduleTournament[] {
 if(!value||typeof value!=='object'||!('tournaments' in value)||!Array.isArray(value.tournaments))
  throw new Error('SCHEDULE_RESPONSE_INVALID');
 return value.tournaments.map((row:unknown)=>{
  if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('SCHEDULE_ROW_INVALID');
  const r=row as Record<string,unknown>;
  if(typeof r.name!=='string'||typeof r.start_time!=='string')throw new Error('SCHEDULE_NAME_DATE_INVALID');
  if(typeof r.buy_in!=='number'||!Number.isSafeInteger(r.buy_in)||r.buy_in<0)throw new Error('SCHEDULE_BUY_IN_INVALID');
  if(typeof r.starting_stack!=='number'||!Number.isSafeInteger(r.starting_stack)||r.starting_stack<=0)throw new Error('SCHEDULE_STACK_INVALID');
  if(r.game_type!=='nlh'&&r.game_type!=='plo'&&r.game_type!=='mixed')throw new Error('SCHEDULE_GAME_TYPE_INVALID');
  let venue:string|null|undefined;
  if(typeof r.venue==='string')venue=r.venue;
  else if(r.venue===null)venue=null;
  else if(r.venue===undefined)venue=undefined;
  else throw new Error('SCHEDULE_VENUE_INVALID');
  return {name:r.name,start_time:r.start_time,buy_in:r.buy_in,starting_stack:r.starting_stack,game_type:r.game_type,venue};
 });
}
