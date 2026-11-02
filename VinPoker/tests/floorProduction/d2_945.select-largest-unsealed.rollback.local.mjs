// SELECT_LARGEST counterpart of the pinned two-flight D2 fixture. One physical
// bag is unsealed until canonical Close denies; Seal then recovers. All writes
// remain in the outer native transaction and roll back.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

assert.equal(process.env.VINPOKER_D2_945_LOCAL, '1');
const base = readFileSync('tests/floorProduction/d2_913.multiplayer-boundary.rollback.sql', 'utf8');
assert.equal(createHash('sha256').update(base).digest('hex'), '54e8cf94e6ad5cb931a388bba8bfc99a6ab83045c77737b51daea0a183c826b7');
assert.equal((base.match(/SUM_STACKS/g) ?? []).length, 3);
assert.equal((base.match(/320000/g) ?? []).length, 4);
assert.equal((base.match(/40000/g) ?? []).length, 2);
let sql = base.replaceAll('SUM_STACKS', 'SELECT_LARGEST').replaceAll('320000', '160000').replaceAll('40000', '20000')
  .replaceAll('SUM8', 'SELECT8').replaceAll('STACK320K', 'STACK160K');

const seal = "   r:=public.multi_day_seal_bag_v1(flight,player,(recorded->>'revision')::integer,gen_random_uuid());ASSERT r->>'sealed'='true',r::text;";
assert.equal(sql.split(seal).length, 2, 'seal insertion point drift');
sql = sql.replace(seal, `   IF i<>2 OR j<>8 THEN
${seal}
   END IF;`);
const close = "  state:=public.multi_day_bagging_state_v1(flight);\n  r:=public.multi_day_close_bagging_v1(flight,(state->>'dayVersion')::integer,gen_random_uuid());ASSERT r->>'ok'='true',r::text;";
assert.equal(sql.split(close).length, 2, 'day-close insertion point drift');
sql = sql.replace(close, `  IF i=2 THEN
   state:=public.multi_day_bagging_state_v1(flight);
   denied:=false;
   BEGIN PERFORM public.multi_day_close_bagging_v1(flight,(state->>'dayVersion')::integer,gen_random_uuid());
   EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='multi_day_day_close_bags_unreconciled',SQLERRM;denied:=true; END;
   ASSERT denied,'unsealed SELECT_LARGEST physical bag allowed day close';
   PERFORM set_config('role','none',true);
   ASSERT NOT EXISTS(SELECT 1 FROM public.multi_day_close_requests_v1 WHERE flight_tournament_id=flight),'failed close wrote receipt';
   ASSERT NOT EXISTS(SELECT 1 FROM public.day_close WHERE tournament_id=flight AND status='locked'),'failed close locked day';
   PERFORM set_config('role','authenticated',true);
   preview:=public.multi_day_qualification_preview_v1(event);
   ASSERT preview->>'state'<>'READY' AND EXISTS(SELECT 1 FROM jsonb_array_elements(preview->'flights') f
     WHERE f->>'flightId'=flight::text AND jsonb_array_length(f->'eligibleBags')=7),'unsealed bag was eligible';
   r:=public.multi_day_seal_bag_v1(flight,player,(recorded->>'revision')::integer,gen_random_uuid());
   ASSERT r->>'sealed'='true',r::text;
   RAISE NOTICE 'D2_945_SELECT_LARGEST_UNSEALED_CLOSE_DENIED_NO_WRITE_THEN_SEAL_PASS';
  END IF;
${close}`);

const ready = " preview:=public.multi_day_qualification_preview_v1(event);ASSERT jsonb_array_length(preview->'flights')=2;";
assert.equal(sql.split(ready).length, 2, 'qualification preview point drift');
sql = sql.replace(ready, `${ready} ASSERT preview->>'state'='READY','sealed SELECT_LARGEST flights did not become ready';`);
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
 RAISE NOTICE 'D2_945_ONE_BAG_SHORT_QUOTA_DENIAL_NO_WRITE_PASS';
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
 RAISE NOTICE 'D2_945_SELECT_LARGEST_8QUALIFIERS_2BAGS_EACH_160K_PASS';`);

const output = spawnSync('wsl', ['-d', 'PokerVision-P16-4C-Eval', '--', 'env',
  'PGHOST=127.0.0.1', 'PGPORT=55441', 'PGUSER=postgres', 'PGDATABASE=vinpoker_ranking860_local',
  'psql', '-w', '-X', '-v', 'ON_ERROR_STOP=1'],
  { input: sql, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 180000 });
const log = `${output.stdout ?? ''}${output.stderr ?? ''}`;
writeFileSync('D:/Quy trình/output/reports/d2_945-select-largest-unsealed-native-local-20261026.txt', log);
assert.equal(output.status, 0, log.slice(-12000));
assert.match(log, /D2_945_SELECT_LARGEST_UNSEALED_CLOSE_DENIED_NO_WRITE_THEN_SEAL_PASS/);
assert.match(log, /D2_945_ONE_BAG_SHORT_QUOTA_DENIAL_NO_WRITE_PASS/);
assert.match(log, /D2_945_SELECT_LARGEST_8QUALIFIERS_2BAGS_EACH_160K_PASS/);
assert.match(log, /D2_913_TWO_FLIGHTS_SELECT8_CANONICAL_START_PENDING_MOVE_DENIAL_SAME_PLAN_APPLY_REPLAY_ROLLBACK_PASS/);
console.log('D2_945_SELECT_LARGEST_UNSEALED_BAG_CANONICAL_DRAW_ROLLBACK_PASS');
