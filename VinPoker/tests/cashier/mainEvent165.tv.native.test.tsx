import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {afterEach,it,expect} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {mapDisplayStateToTvData,type TvDisplayStatePayload} from '@/lib/tv/mapDisplayState';
import {mapTvDataToClock} from '@/lib/tv/mapClockData';
import {VinPokerTournamentClock} from '@/components/tournament-clock/VinPokerTournamentClock';
const sql=(input:string)=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env',
 'PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c',
 'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:30000}).trim();
afterEach(cleanup);
it.skipIf(process.env.VINPOKER_NATIVE_MAIN_EVENT_TV !== '1')('renders actual anonymous PG payload event GTD outside the flight prize pool',()=>{
 assert.equal(process.env.VINPOKER_NATIVE_MAIN_EVENT_TV,'1');
 assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),
  'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
 assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');"),'f');
 const token='fixture-only-main-event165-render-'+randomUUID();
 const payload=JSON.parse(sql(`BEGIN;SET LOCAL statement_timeout='10s';
 INSERT INTO public.tv_displays(id,club_id,display_token,assigned_tournament_id,status)
 SELECT gen_random_uuid(),t.club_id,'${token}',t.id,'paired' FROM public.tournaments t
 JOIN public.tournament_events e ON e.id=t.event_id AND e.club_id=t.club_id
 WHERE e.id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d' AND e.name='Main Event browser local TEST 164' AND t.flight_label='A';
 SET LOCAL ROLE anon;SELECT public.get_tv_display_state_v4('${token}',false);ROLLBACK;`)) as TvDisplayStatePayload;
 assert.equal(payload.status,'paired');
 const data=mapDisplayStateToTvData(payload,600)!;
 assert.equal(data.mainEventGuarantee,2500000);
 const clock=mapTvDataToClock(data);
 assert.notEqual(clock.prizePool,'2.500.000');
 render(<VinPokerTournamentClock data={clock}/>);
 expect(screen.getByRole('heading',{name:'Main Event browser local TEST 164 · Flight A'})).toBeInTheDocument();
 expect(screen.getByText('Main Event GTD (all flights): 2.500.000')).toBeInTheDocument();
 expect(screen.getByText('Prize Pool').nextElementSibling).not.toHaveTextContent('2.500.000');
 console.log('MAIN_EVENT165_ANON_PG_MAPPER_ACTUAL_CLOCK_RENDER_PASS_NOT_BROWSER');
},30000);
it.skipIf(process.env.VINPOKER_NATIVE_MAIN_EVENT_TV !== '1')('keeps actual anonymous zero-remaining projection at zero despite a busted historical entry',()=>{
 assert.equal(process.env.VINPOKER_NATIVE_MAIN_EVENT_TV,'1');
 assert.equal(sql('SELECT current_database();'),'vinpoker_ops_cash115_qualified_c');
 const token='fixture-only-main-event165-zero-'+randomUUID();
 const payload=JSON.parse(sql(`BEGIN;SET LOCAL statement_timeout='10s';
 INSERT INTO public.tv_displays(id,club_id,display_token,assigned_tournament_id,status)
 SELECT gen_random_uuid(),t.club_id,'${token}',t.id,'paired' FROM public.tournaments t
 WHERE t.id='58a903d2-2bba-4e95-aa0f-df2edfc1b05e' AND t.name='Cash identity local TEST';
 SET LOCAL ROLE anon;SELECT public.get_tv_display_state_v4('${token}',false);ROLLBACK;`)) as TvDisplayStatePayload;
 assert.equal(payload.status,'paired');
 const data=mapDisplayStateToTvData(payload,0)!;
 assert.equal(data.totalEntries,1);assert.equal(data.playersRemaining,0);assert.equal(data.totalChips,0);
 const clock=mapTvDataToClock(data);
 assert.equal(clock.players,0);assert.equal(clock.entries,1);
 render(<VinPokerTournamentClock data={clock}/>);
 expect(screen.getByText('Players').nextElementSibling).toHaveTextContent('0');
 console.log('TV165_ACTUAL_ANON_ZERO_REMAINING_NOT_HISTORICAL_ENTRIES_PASS_NOT_BROWSER');
},30000);
