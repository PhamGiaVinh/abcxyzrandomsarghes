// Disposable LOCAL DB clone: two independent sessions race the same immutable
// D2 initial-draw plan with different request keys. Does not test two actors.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

assert.equal(process.env.VINPOKER_D2_941_LOCAL, '1');
const database = 'vinpoker_race941_local';
const comment = 'VINPOKER_RACE941_DISPOSABLE_LOCAL_FROM_RANKING860_HEAD_ef6a26948';
const actor = '495e96be-c00b-4e68-b227-593300f3e2bc';
const env = ['-d', 'PokerVision-P16-4C-Eval', '--', 'env', 'PGHOST=127.0.0.1', 'PGPORT=55441', 'PGUSER=postgres', `PGDATABASE=${database}`];
const psql = ['psql', '-w', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'];
function syncSql(sql) {
  const result = spawnSync('wsl', [...env, ...psql], { input: sql, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 180000 });
  return { status: result.status, log: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}
const guard = syncSql(`SELECT jsonb_build_object('db',current_database(),'comment',
 (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()),
 'fixtureCount',(SELECT count(*) FROM public.tournament_events WHERE name='D2 913 two flights boundary TEST'));
`);
assert.equal(guard.status, 0, guard.log);
const state = JSON.parse(guard.log.trim().split(/\r?\n/).at(-1));
assert.deepEqual(state, { db: database, comment, fixtureCount: 0 });

const base = readFileSync('tests/floorProduction/d2_913.multiplayer-boundary.rollback.sql', 'utf8');
assert.equal(createHash('sha256').update(base).digest('hex'), '54e8cf94e6ad5cb931a388bba8bfc99a6ab83045c77737b51daea0a183c826b7');
const marker = " ASSERT jsonb_array_length(plan->'assignments')=5;";
const boundary = base.indexOf(marker);
assert.ok(boundary > 0 && base.indexOf(marker, boundary + 1) < 0, 'fixture boundary drift');
const setupSql = base.slice(0, boundary + marker.length)
  .replaceAll('vinpoker_ranking860_local', database)
  .replaceAll('VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948', comment)
  + `
 PERFORM set_config('race941.fixture',jsonb_build_object('event',event,'final',final,'plan',p,
   'actor',actor,'flightCount',cardinality(flights),'selectedTables',selected)::text,true);
END $$;
SELECT current_setting('race941.fixture')::jsonb;
COMMIT;
`;
const setup = syncSql(setupSql);
writeFileSync('D:/Quy trình/output/reports/d2_941-race-setup-native-local-20261026.txt', setup.log);
assert.equal(setup.status, 0, setup.log.slice(-12000));
const fixture = JSON.parse(setup.log.split(/\r?\n/).find(line => line.startsWith('{') && line.includes('"plan"')));
assert.equal(fixture.actor, actor);
assert.equal(fixture.flightCount, 2);
assert.equal(fixture.selectedTables.length, 3);
for (const id of [fixture.event, fixture.final, fixture.plan]) assert.match(id, /^[a-f0-9-]{36}$/);

function raceSql(request) {
  return `BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='20s';
SELECT set_config('request.jwt.claim.sub','${actor}',true);
SELECT set_config('request.jwt.claims','{"sub":"${actor}","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT pg_sleep(1);
DO $$ DECLARE receipt jsonb; BEGIN
 receipt:=public.multi_day_apply_initial_draw_v1('${fixture.plan}','${request}');
 PERFORM set_config('race941.outcome',jsonb_build_object('kind','applied','request','${request}',
   'seatReceipts',jsonb_array_length(receipt->'seatReceipts'))::text,true);
EXCEPTION WHEN unique_violation THEN
 ASSERT SQLERRM='multi_day_initial_draw_already_applied_use_receipt',SQLERRM;
 PERFORM set_config('race941.outcome',jsonb_build_object('kind','already_applied','request','${request}',
   'message',SQLERRM)::text,true);
END $$;
SELECT current_setting('race941.outcome')::jsonb;
COMMIT;
`;
}
function asyncSql(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn('wsl', [...env, ...psql], { stdio: ['pipe', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', chunk => { log += chunk; });
    child.stderr.on('data', chunk => { log += chunk; });
    child.on('error', reject);
    child.on('close', status => resolve({ status, log }));
    child.stdin.end(sql);
  });
}
const requests = [randomUUID(), randomUUID()];
const raced = await Promise.all(requests.map(request => asyncSql(raceSql(request))));
for (const result of raced) assert.equal(result.status, 0, result.log.slice(-12000));
const outcomes = raced.map(result => JSON.parse(result.log.split(/\r?\n/).find(line => line.startsWith('{') && line.includes('"kind"'))));
assert.deepEqual(outcomes.map(row => row.kind).sort(), ['already_applied', 'applied']);
assert.equal(outcomes.find(row => row.kind === 'applied').seatReceipts, 5);
const facts = syncSql(`SELECT jsonb_build_object(
 'applications',(SELECT count(*) FROM private.multi_day_initial_draw_applications_v1 a WHERE a.plan_id='${fixture.plan}'),
 'entries',(SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${fixture.final}'),
 'entryChips',(SELECT sum(current_stack) FROM public.tournament_entries WHERE tournament_id='${fixture.final}'),
 'seats',(SELECT count(*) FROM public.tournament_seats WHERE tournament_id='${fixture.final}' AND is_active),
 'seatChips',(SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${fixture.final}' AND is_active),
 'finalCash',(SELECT count(*) FROM public.cashier_buyin_movements WHERE tournament_id='${fixture.final}'));
`);
assert.equal(facts.status, 0, facts.log);
const final = JSON.parse(facts.log.trim().split(/\r?\n/).at(-1));
assert.deepEqual(final, { applications: 1, entries: 8, entryChips: 320000, seats: 8, seatChips: 320000, finalCash: 0 });
writeFileSync('D:/Quy trình/output/reports/d2_941-race-native-local-20261026.json', JSON.stringify({ fixture, requests, raced, outcomes, final }, null, 2) + '\n');
console.log('D2_941_SAME_ACTOR_TWO_CONNECTION_APPLY_RACE_PASS', JSON.stringify({ fixture, outcomes, final }));
