// Local-only native D2 stale-source probe. Reuses the pinned two-flight fixture;
// the canonical seed correction and every tournament write are rolled back.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

assert.equal(process.env.VINPOKER_D2_938_LOCAL, '1');
const base = readFileSync('tests/floorProduction/d2_913.multiplayer-boundary.rollback.sql', 'utf8');
assert.equal(createHash('sha256').update(base).digest('hex'), '54e8cf94e6ad5cb931a388bba8bfc99a6ab83045c77737b51daea0a183c826b7');
const marker = " PERFORM set_config('role','none',true);\n protected_before_start:=pg_temp.d2_789_fingerprint();";
assert.equal(base.split(marker).length, 2, 'fixture insertion point drift');
const probe = `
 -- The fourth qualifier is still unseated. A canonical owner seed correction
 -- changes the roster source hash after Plan, so Apply must reject atomically.
 PERFORM set_config('role','none',true);
 protected_before_start:=pg_temp.d2_789_fingerprint();
 PERFORM set_config('role','authenticated',true);
 BEGIN
  r:=public.multi_day_correct_final_seed_v1(event,players[4],41000,0,
    'Correct carry stack before D2 seating','D2-938-local-evidence',gen_random_uuid());
  ASSERT r->>'state'='REVISED_PRE_SEAT' AND (r->>'seedRevision')::integer=1,r::text;
  snap:=public.multi_day_final_roster_v1(event);
  ASSERT snap->>'sourceHash' IS DISTINCT FROM plan->>'sourceHash','source hash did not change';
  ASSERT EXISTS(SELECT 1 FROM jsonb_array_elements(snap->'players') x
    WHERE x->>'playerId'=players[4]::text AND (x->>'stack')::bigint=41000 AND (x->>'seedRevision')::integer=1);
  denied:=false;
  BEGIN PERFORM public.multi_day_apply_initial_draw_v1(p,gen_random_uuid());
  EXCEPTION WHEN serialization_failure THEN
    ASSERT SQLERRM='multi_day_initial_draw_source_stale',SQLERRM;denied:=true;
  END;
  ASSERT denied,'stale source applied D2 draw';
  PERFORM set_config('role','none',true);
  ASSERT (SELECT count(*)=3 FROM public.tournament_entries WHERE tournament_id=final),'partial entry write';
  ASSERT (SELECT count(*)=3 FROM public.tournament_seats WHERE tournament_id=final AND is_active),'partial seat write';
  ASSERT NOT EXISTS(SELECT 1 FROM private.multi_day_initial_draw_applications_v1 WHERE plan_id=p),'application after denial';
  RAISE EXCEPTION 'D2_938_SOURCE_STALE_CHECKED' USING ERRCODE='ZX938';
 EXCEPTION WHEN SQLSTATE 'ZX938' THEN ASSERT SQLERRM='D2_938_SOURCE_STALE_CHECKED'; END;
 PERFORM set_config('role','none',true);
 ASSERT protected_before_start=pg_temp.d2_789_fingerprint(),'seed correction probe leaked data';
 PERFORM set_config('role','authenticated',true);
 snap:=public.multi_day_final_roster_v1(event);
 ASSERT snap->>'sourceHash'=plan->>'sourceHash','source hash not restored after probe';
 RAISE NOTICE 'D2_938_CANONICAL_SEED_REVISION_SOURCE_STALE_NO_PARTIAL_WRITE_PASS';
`;
const sql = base.replace(marker, probe + marker);
const output = spawnSync('wsl', ['-d', 'PokerVision-P16-4C-Eval', '--', 'env',
  'PGHOST=127.0.0.1', 'PGPORT=55441', 'PGUSER=postgres', 'PGDATABASE=vinpoker_ranking860_local',
  'psql', '-w', '-X', '-v', 'ON_ERROR_STOP=1'],
  { input: sql, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 180000 });
const log = `${output.stdout ?? ''}${output.stderr ?? ''}`;
writeFileSync('D:/Quy trình/output/reports/d2_938-source-revision-native-local-20261026.txt', log);
assert.equal(output.status, 0, log.slice(-12000));
assert.match(log, /D2_938_CANONICAL_SEED_REVISION_SOURCE_STALE_NO_PARTIAL_WRITE_PASS/);
assert.match(log, /D2_913_TWO_FLIGHTS_SUM8_CANONICAL_START_PENDING_MOVE_DENIAL_SAME_PLAN_APPLY_REPLAY_ROLLBACK_PASS/);
console.log('D2_938_SOURCE_STALE_AND_SAME_PLAN_RECOVERY_ROLLBACK_PASS');
