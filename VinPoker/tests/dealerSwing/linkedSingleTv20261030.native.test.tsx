import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {afterEach, expect, it} from 'vitest';
import {cleanup, render, screen} from '@testing-library/react';
import {mapDisplayStateToTvData, type TvDisplayStatePayload} from '@/lib/tv/mapDisplayState';
import {mapTvDataToClock} from '@/lib/tv/mapClockData';
import {VinPokerTournamentClock} from '@/components/tournament-clock/VinPokerTournamentClock';

afterEach(cleanup);

it.skipIf(process.env.VINPOKER_LINKED_SINGLE_TV_NATIVE !== '1')('renders the linked single tour from actual anonymous PostgreSQL without retaining a TV fixture', () => {
  const directory = 'D:/Quy trình/output/reports/';
  const journal = JSON.parse(readFileSync(directory + 'linked-single-journey-20261030.json', 'utf8'));
  assert.equal(journal.db, 'vinpoker_worker_integrated_20261030');
  assert.equal(journal.phase, 'FOUR_PLAYERS_REMAIN_AWAIT_REST_CYCLES_AND_FLOOR_CONSOLIDATION');
  const tour = '3d559e7f-43c7-4bb3-998a-dc0df4c217e7';
  assert.equal(journal.fixture.tour, tour);
  const sql = (input: string) => execFileSync('wsl', ['-d', 'PokerVision-P16-4C-Eval', '--', 'env',
    'PGHOST=127.0.0.1', 'PGPORT=55441', 'PGUSER=postgres', 'PGDATABASE=' + journal.db,
    'psql', '-w', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
    input, encoding: 'utf8', timeout: 30000, maxBuffer: 2_000_000,
  }).trim();
  assert.equal(sql("SELECT host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory')||'|'||shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),
    '127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data|VINPOKER_WORKER_INTEGRATED_20261030_OWNED_LOCAL_TEST');
  assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink');"), '0');
  const fingerprint = () => sql("SELECT md5(coalesce(jsonb_agg(to_jsonb(d) ORDER BY id)::text,'[]')) FROM public.tv_displays d;");
  const before = fingerprint();
  const token = 'linked-single-local-tv-' + randomUUID();
  const payload = JSON.parse(sql(`BEGIN;
    SET LOCAL statement_timeout='10s';
    INSERT INTO public.tv_displays(id,club_id,display_token,assigned_tournament_id,status)
    SELECT gen_random_uuid(),club_id,'${token}',id,'paired' FROM public.tournaments
    WHERE id='${tour}' AND name='Linked single full operation TEST 20261030';
    SET LOCAL ROLE anon;
    SELECT public.get_tv_display_state_v4('${token}',false);
    ROLLBACK;`)) as TvDisplayStatePayload;
  assert.equal(fingerprint(), before);
  assert.equal(payload.status, 'paired');
  const data = mapDisplayStateToTvData(payload, 600)!;
  assert.ok(data);
  expect(data.playersRemaining).toBe(4);
  expect(data.totalEntries).toBe(9);
  expect(data.reEntries).toBe(1);
  expect(data.totalChips).toBe(180000);
  const clock = mapTvDataToClock(data);
  expect(clock.players).toBe(4);
  expect(clock.entries).toBe(9);
  expect(clock.totalChips).toBe('180.000');
  expect(clock.prizePool).toBe('900.000');
  expect(clock.payouts).toEqual([{rank: '1st', amount: '680.000'}, {rank: '2nd', amount: '220.000'}]);
  render(<VinPokerTournamentClock data={clock}/>);
  expect(screen.getByRole('heading', {name: 'Linked single full operation TEST 20261030'})).toBeInTheDocument();
  expect(screen.getByText('900.000')).toBeInTheDocument();
  writeFileSync(directory + 'linked-single-tv-native-component-20261030.json', JSON.stringify({
    phase: 'LINKED_SINGLE_ANON_NATIVE_TV_SOURCE_MAPPERS_AND_ACTUAL_CLOCK_COMPONENT_PASS',
    at: new Date().toISOString(), database: journal.db, tour, payload, clock,
    tvRowsExactlyRestored: true,
    limitations: ['Component render, not browser pixels or physical TV', 'Temporary local TV capability rolled back'],
    fullGoalComplete: false,
  }, null, 2));
}, 30000);
