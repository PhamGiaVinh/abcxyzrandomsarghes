import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import ts from 'typescript';
import type {DealerAssignment} from '@/hooks/useDealerSwing';
import type {TournamentWithTables} from '@/types/tournament';
import {deriveTableSwingView} from './swingTableView';
import {findDealerTableTournament} from '@/lib/dealerTableInventory';

const table={id:'physical-a',table_type:'tournament',table_session_id:'session-new'};
const assignment={table_id:'physical-a',table_session_id:'session-new',
 assigned_at:'2026-10-15T00:00:00Z',swing_due_at:'2026-10-15T00:30:00Z'} as DealerAssignment;
function tournament(link:Record<string,unknown>){
 return {id:'tour-a',swing_duration_minutes:37,warn_at_minutes:7,
  tournament_tables:[link]} as unknown as TournamentWithTables;
}
it('resolves canonical tournament config for the exact active table session',()=>{
 const tour=tournament({id:'logical-a',table_id:null,game_table_id:table.id,
  table_session_id:'session-new',status:'active'});
 const view=deriveTableSwingView(table,assignment,undefined,[tour],[],Date.parse('2026-10-15T00:10:00Z'));
 expect(view.tableTournament).toBe(tour);
 expect(view.swingDurationMs).toBe(37*60_000);
 expect(view.swingDueMs).toBe(Date.parse(assignment.swing_due_at!));
});
it('rejects a prior session even when its legacy physical ID matches',()=>{
 const old=tournament({id:'logical-old',table_id:table.id,game_table_id:table.id,
  table_session_id:'session-old',status:'closed'});
 const view=deriveTableSwingView(table,assignment,undefined,[old],[],Date.now());
 expect(view.tableTournament).toBeUndefined();
});
it('rejects conflicting aliases, cross-club links, duplicate matches and stale assignments',()=>{
 const link={id:'logical-a',table_id:null,game_table_id:table.id,table_session_id:'session-new',status:'active'};
 const tour={...tournament(link),club_id:'club-a'};
 const scoped={...table,club_id:'club-a'};
 expect(findDealerTableTournament(scoped,'session-old',[tour])).toBeUndefined();
 expect(findDealerTableTournament({...scoped,club_id:'club-b'},'session-new',[tour])).toBeUndefined();
 expect(findDealerTableTournament(scoped,'session-new',[tour,tour])).toBeUndefined();
 expect(findDealerTableTournament(scoped,'session-new',[
  {...tour,tournament_tables:[{...tour.tournament_tables[0],table_id:'physical-other'}]},
 ])).toBeUndefined();
 expect(findDealerTableTournament({...scoped,availability_status:'repair_required'},'session-new',[tour])).toBeUndefined();
});
it('keeps legacy metadata only when no session is being inferred',()=>{
 const legacy=tournament({table_id:table.id});
 expect(findDealerTableTournament({id:table.id},null,[legacy])).toBe(legacy);
 expect(findDealerTableTournament(table,'session-new',[legacy])).toBeUndefined();
});
it('keeps the server due time authoritative when config is missing or ambiguous',()=>{
 const tour=tournament({id:'logical-a',table_id:null,game_table_id:table.id,
  table_session_id:'session-new',status:'active'});
 const beforeDue=Date.parse('2026-10-15T00:29:00Z');
 for(const candidates of [[],[tour,tour]]){
  const view=deriveTableSwingView(table,assignment,undefined,candidates,[],beforeDue);
  expect(view.tableTournament).toBeUndefined();
  expect(view.swingDueMs).toBe(Date.parse(assignment.swing_due_at!));
  expect(view.actualDueMs).toBe(Date.parse(assignment.swing_due_at!));
  expect(view.isPastDue).toBe(false);
  expect(view.canSwing).toBe(false);
  expect(view.remainingMinutes).toBe(1);
 }
});
it('actual timeline does not warn early when server due differs from duration fallback',()=>{
 const source=readFileSync(resolve(process.cwd(),'src/components/cashier/DealerSwingTab.tsx'),'utf8');
 const start=source.indexOf('function resolveTableSwingTiming(');
 const end=source.indexOf('/* ==============================================================',start);
 if(start<0||end<=start)throw Error('Actual timeline seam missing');
 const js=ts.transpileModule(source.slice(start,end),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},
 }).outputText;
 const timeline=new Function('findDealerTableTournament',`${js};return resolveTableSwingTiming;`)(findDealerTableTournament);
 const delayed={...assignment,swing_due_at:'2026-10-15T00:45:00Z'};
 const now=Date.parse('2026-10-15T00:31:00Z');
 const result=timeline(delayed,table,[],[],now);
 const card=deriveTableSwingView(table,delayed,undefined,[],[],now);
 expect(result.actualDueAt).toBe(delayed.swing_due_at.replace('Z','.000Z'));
 expect(result.minutesLeft).toBe(14);
 expect(result.actualMinutesLeft).toBe(14);
 expect(result.showNextDealerSoon).toBe(false);
 expect(result.isOverdue).toBe(false);
 expect(card.remainingMinutes).toBe(result.minutesLeft);
});
