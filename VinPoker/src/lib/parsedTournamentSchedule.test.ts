import {expect,it} from 'vitest';
import {parseTournamentSchedule} from './parsedTournamentSchedule';
const row={name:'TEST',start_time:'2026-10-18T10:00:00+07:00',buy_in:0,starting_stack:20000,game_type:'nlh',venue:null};
it('preserves explicit free entry and a valid empty schedule',()=>{
 expect(parseTournamentSchedule({tournaments:[row]})).toEqual([row]);expect(parseTournamentSchedule({tournaments:[]})).toEqual([]);
});
it.each([null,{}, {tournaments:null},{tournaments:[{...row,buy_in:'1000'}]},
 {tournaments:[{...row,buy_in:-1}]},{tournaments:[{...row,starting_stack:0}]},
 {tournaments:[{...row,starting_stack:Number.MAX_SAFE_INTEGER+1}]},{tournaments:[{...row,game_type:'unknown'}]}])('rejects malformed schedule without defaults: %j',value=>{
 expect(()=>parseTournamentSchedule(value)).toThrow();
});
