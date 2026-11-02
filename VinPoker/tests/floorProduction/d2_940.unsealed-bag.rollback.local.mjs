// LOCAL-only two-flight D2 prerequisite: one physical bag remains unsealed,
// so canonical day close must deny without a receipt. Seal it and continue the
// unchanged SUM_STACKS initial-draw fixture; outer transaction rolls back.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

assert.equal(process.env.VINPOKER_D2_940_LOCAL, '1');
const base = readFileSync('tests/floorProduction/d2_913.multiplayer-boundary.rollback.sql', 'utf8');
assert.equal(createHash('sha256').update(base).digest('hex'), '54e8cf94e6ad5cb931a388bba8bfc99a6ab83045c77737b51daea0a183c826b7');
const seal = "   r:=public.multi_day_seal_bag_v1(flight,player,(recorded->>'revision')::integer,gen_random_uuid());ASSERT r->>'sealed'='true',r::text;";
assert.equal(base.split(seal).length, 2, 'seal insertion point drift');
let sql = base.replace(seal, `   IF i<>2 OR j<>8 THEN
${seal}
   END IF;`);
const close = "  state:=public.multi_day_bagging_state_v1(flight);\n  r:=public.multi_day_close_bagging_v1(flight,(state->>'dayVersion')::integer,gen_random_uuid());ASSERT r->>'ok'='true',r::text;";
assert.equal(sql.split(close).length, 2, 'day-close insertion point drift');
sql = sql.replace(close, `  IF i=2 THEN
   state:=public.multi_day_bagging_state_v1(flight);
   denied:=false;
   BEGIN PERFORM public.multi_day_close_bagging_v1(flight,(state->>'dayVersion')::integer,gen_random_uuid());
   EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='multi_day_day_close_bags_unreconciled',SQLERRM;denied:=true; END;
   ASSERT denied,'unsealed physical bag allowed day close';
   PERFORM set_config('role','none',true);
   ASSERT NOT EXISTS(SELECT 1 FROM public.multi_day_close_requests_v1 WHERE flight_tournament_id=flight),'failed close wrote receipt';
   ASSERT NOT EXISTS(SELECT 1 FROM public.day_close WHERE tournament_id=flight AND status='locked'),'failed close locked day';
   PERFORM set_config('role','authenticated',true);
   preview:=public.multi_day_qualification_preview_v1(event);
   ASSERT preview->>'state'<>'READY' AND EXISTS(SELECT 1 FROM jsonb_array_elements(preview->'flights') f
     WHERE f->>'flightId'=flight::text AND jsonb_array_length(f->'eligibleBags')=7),'unsealed bag was eligible';
   r:=public.multi_day_seal_bag_v1(flight,player,(recorded->>'revision')::integer,gen_random_uuid());
   ASSERT r->>'sealed'='true',r::text;
   RAISE NOTICE 'D2_940_UNSEALED_PHYSICAL_BAG_CLOSE_DENIAL_NO_WRITE_THEN_SEAL_PASS';
  END IF;
${close}`);
const ready = " preview:=public.multi_day_qualification_preview_v1(event);ASSERT jsonb_array_length(preview->'flights')=2;";
assert.equal(sql.split(ready).length, 2, 'qualification preview point drift');
sql = sql.replace(ready, `${ready} ASSERT preview->>'state'='READY','sealed flights did not become ready';`);
const output = spawnSync('wsl', ['-d', 'PokerVision-P16-4C-Eval', '--', 'env',
  'PGHOST=127.0.0.1', 'PGPORT=55441', 'PGUSER=postgres', 'PGDATABASE=vinpoker_ranking860_local',
  'psql', '-w', '-X', '-v', 'ON_ERROR_STOP=1'],
  { input: sql, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 180000 });
const log = `${output.stdout ?? ''}${output.stderr ?? ''}`;
writeFileSync('D:/Quy trình/output/reports/d2_940-unsealed-bag-native-local-20261026.txt', log);
assert.equal(output.status, 0, log.slice(-12000));
assert.match(log, /D2_940_UNSEALED_PHYSICAL_BAG_CLOSE_DENIAL_NO_WRITE_THEN_SEAL_PASS/);
assert.match(log, /D2_913_TWO_FLIGHTS_SUM8_CANONICAL_START_PENDING_MOVE_DENIAL_SAME_PLAN_APPLY_REPLAY_ROLLBACK_PASS/);
console.log('D2_940_UNSEALED_BAG_DENIAL_AND_CANONICAL_DRAW_ROLLBACK_PASS');
