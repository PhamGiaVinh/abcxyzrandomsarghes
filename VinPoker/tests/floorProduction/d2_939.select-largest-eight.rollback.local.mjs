// LOCAL native counterpart of the pinned SUM_STACKS initial-draw fixture.
// Eight players each bag in both flights; SELECT_LARGEST carries one 20K stack
// per player while retaining both source bags. All writes roll back.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

assert.equal(process.env.VINPOKER_D2_939_LOCAL, '1');
const base = readFileSync('tests/floorProduction/d2_913.multiplayer-boundary.rollback.sql', 'utf8');
assert.equal(createHash('sha256').update(base).digest('hex'), '54e8cf94e6ad5cb931a388bba8bfc99a6ab83045c77737b51daea0a183c826b7');
assert.equal((base.match(/SUM_STACKS/g) ?? []).length, 3);
assert.equal((base.match(/320000/g) ?? []).length, 4);
assert.equal((base.match(/40000/g) ?? []).length, 2);
let sql = base.replaceAll('SUM_STACKS', 'SELECT_LARGEST').replaceAll('320000', '160000').replaceAll('40000', '20000')
  .replaceAll('SUM8', 'SELECT8').replaceAll('STACK320K', 'STACK160K');
const lock = " r:=public.multi_day_lock_qualification_v1(event,bags,preview->>'sourceHash',gen_random_uuid());ASSERT r->>'ok'='true',r::text;";
assert.equal(sql.split(lock).length, 2, 'qualification lock insertion point drift');
sql = sql.replace(lock, ` denied:=false;
 BEGIN PERFORM public.multi_day_lock_qualification_v1(event,bags[1:15],preview->>'sourceHash',gen_random_uuid());
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='multi_day_qualification_quota_mismatch',SQLERRM;denied:=true; END;
 ASSERT denied,'missing selected flight bag was accepted';
 PERFORM set_config('role','none',true);
 ASSERT NOT EXISTS(SELECT 1 FROM public.multi_day_qualification_locks_v1 WHERE event_id=event),'failed lock wrote receipt';
 ASSERT NOT EXISTS(SELECT 1 FROM public.multi_day_final_participations_v1 WHERE event_id=event),'failed lock wrote participation';
 PERFORM set_config('role','authenticated',true);
 RAISE NOTICE 'D2_939_ONE_BAG_SHORT_QUOTA_DENIAL_NO_WRITE_PASS';
${lock}`);
const marker = " ASSERT (SELECT count(*)=8 AND sum(carried_stack)=160000 AND bool_and(carried_stack=20000) FROM public.multi_day_final_participations_v1 WHERE event_id=event);";
assert.equal(sql.split(marker).length, 2, 'qualification assertion drift');
sql = sql.replace(marker, `${marker}
 ASSERT (SELECT count(*)=8 AND bool_and(jsonb_array_length(source_bags)=2)
     AND bool_and((SELECT count(DISTINCT b->>'flightId')=2 FROM jsonb_array_elements(source_bags) b))
   FROM public.multi_day_final_participations_v1 WHERE event_id=event),'source bag provenance lost';
 ASSERT (SELECT count(*)=16 AND count(DISTINCT (b->>'bagId'))=16
   FROM public.multi_day_final_participations_v1 p
   CROSS JOIN LATERAL jsonb_array_elements(p.source_bags) b WHERE p.event_id=event),'bag identity duplicated';
 RAISE NOTICE 'D2_939_SELECT_LARGEST_8QUALIFIERS_2BAGS_EACH_160K_PASS';`);
const output = spawnSync('wsl', ['-d', 'PokerVision-P16-4C-Eval', '--', 'env',
  'PGHOST=127.0.0.1', 'PGPORT=55441', 'PGUSER=postgres', 'PGDATABASE=vinpoker_ranking860_local',
  'psql', '-w', '-X', '-v', 'ON_ERROR_STOP=1'],
  { input: sql, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 180000 });
const log = `${output.stdout ?? ''}${output.stderr ?? ''}`;
writeFileSync('D:/Quy trình/output/reports/d2_939-select-largest-eight-native-local-20261026.txt', log);
assert.equal(output.status, 0, log.slice(-12000));
assert.match(log, /D2_939_SELECT_LARGEST_8QUALIFIERS_2BAGS_EACH_160K_PASS/);
assert.match(log, /D2_939_ONE_BAG_SHORT_QUOTA_DENIAL_NO_WRITE_PASS/);
assert.match(log, /D2_913_PENDING_DENIAL_SAME_PLAN_APPLY5_TOTAL8_STACK160K_REPLAY_PASS/);
assert.match(log, /D2_913_TWO_FLIGHTS_SELECT8_CANONICAL_START_PENDING_MOVE_DENIAL_SAME_PLAN_APPLY_REPLAY_ROLLBACK_PASS/);
console.log('D2_939_SELECT_LARGEST_EIGHT_CANONICAL_DRAW_ROLLBACK_PASS');
