// Focused native proof of the captured production Undo body, not the newer
// receipt/cancellation API. Only the explicitly owned disposable clone is used.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

assert.equal(process.platform,'win32');
const database='vinpoker_hud_test_current_undo_20261107a';
const reportPath=process.env.UNDO_CAPTURED_CURRENT_REPORT;
assert.match(reportPath??'',/^D:\/Quy-trinh-hud-scale-evidence\/undo-captured-current-[A-Za-z0-9-]+\.json$/);
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8').replaceAll('\r','');
const digest=(value,algorithm='md5')=>createHash(algorithm).update(value).digest('hex');
const source=read('../../supabase/migrations/20270115000016_tracker_correction_uat_release2.sql');
const definition=source.match(/CREATE OR REPLACE FUNCTION public\.undo_tracker_last_action_v1\([\s\S]*?AS (\$[A-Za-z0-9_]*\$)([\s\S]*?)\1;/);
assert.ok(definition);
assert.equal(digest(definition[2]),'60291b40aab10a1deccbe2aae1195215');
const capture=readFileSync('D:/pokervision-private/qualification/staff-salary-schema-20261106/live-public-schema.sql','utf8').replaceAll('\r','');
const boards=[...capture.matchAll(/CREATE(?: OR REPLACE)? FUNCTION "?public"?\."?update_community_cards"?\([\s\S]*?AS (\$[A-Za-z0-9_]*\$)([\s\S]*?)\1;/g)];
assert.equal(boards.length,1);
assert.equal(digest(boards[0][2]),'64734d09453c95918299ca3f6e3cc339');
const boardDefinition=boards[0][0].replace(/^CREATE FUNCTION /,'CREATE OR REPLACE FUNCTION ');
let fixture=read('./undo681.authorized-current.rollback.sql');
const once=(from,to)=>{assert.equal(fixture.split(from).length,2,'native fixture boundary changed');fixture=fixture.replace(from,()=>to);};
once("ASSERT current_database()='vinpoker_ops_cash115_qualified_c';",`ASSERT current_database()='${database}';`);
// Replay is proved by the same current Undo writer. These two newer reader
// assertions are deliberately absent from the captured production contract.
once("  answer:=public.get_tracker_undo_receipt_v1(tour,tbl,hand,act,rev,key);\n ASSERT answer->>'outcome'='recorded' AND answer->'receipt'->>'duplicate'='true',answer::text;".trimStart(), '');
once("  answer:=public.get_tracker_undo_receipt_v1(tour,tbl,hand,act,rev,boundary_key);\n ASSERT answer->>'outcome'='not_found',answer::text;".trimStart(), '');
once(" PERFORM set_config('role','none',true);\n ASSERT (SELECT source_revision=rev FROM public.tournament_hands WHERE id=hand);",
 " PERFORM set_config('role','none',true);\n ASSERT NOT EXISTS(SELECT 1 FROM public.tracker_correction_operations WHERE actor_user_id=actor AND idempotency_key=boundary_key);\n ASSERT (SELECT source_revision=rev FROM public.tournament_hands WHERE id=hand);");
assert.ok(!fixture.includes('get_tracker_undo_receipt_v1'));
assert.ok(!fixture.includes('cancel_tracker_undo_intent_v1'));
once(" PERFORM set_config('role','authenticated',true);\n receipt:=public.undo_tracker_last_action_v1(tour,tbl,hand,act,rev,key);",`
 -- Capability expiry,actor and scope failures must leave the action/revision intact.
 UPDATE public.tracker_correction_uat_scopes SET expires_at=statement_timestamp()-interval '1 second'
 WHERE club_id=club AND tournament_id=tour AND tournament_table_id=tbl AND user_id=actor AND capability='undo_open_hand';
 PERFORM set_config('role','authenticated',true);
 answer:=public.undo_tracker_last_action_v1(tour,tbl,hand,act,rev,gen_random_uuid());
 ASSERT answer->>'error'='uat_capability_disabled',answer::text;
 PERFORM set_config('role','none',true);
 UPDATE public.tracker_correction_uat_scopes SET expires_at=statement_timestamp()+interval '10 minutes'
 WHERE club_id=club AND tournament_id=tour AND tournament_table_id=tbl AND user_id=actor AND capability='undo_open_hand';
 PERFORM set_config('request.jwt.claim.sub',owner_actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',owner_actor)::text,true);
 PERFORM set_config('role','authenticated',true);
 answer:=public.undo_tracker_last_action_v1(tour,tbl,hand,act,rev,gen_random_uuid());
 ASSERT answer->>'error'='uat_capability_disabled',answer::text;
 PERFORM set_config('role','none',true);
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);
 PERFORM set_config('role','authenticated',true);
 answer:=public.undo_tracker_last_action_v1('c367013a-3ed3-48af-ad48-3915acadc50e',tbl,hand,act,rev,gen_random_uuid());
 ASSERT answer->>'error'='stale_tracker_context',answer::text;
 answer:=public.undo_tracker_last_action_v1(tour,tbl,hand,act,rev+1,gen_random_uuid());
 ASSERT answer->>'error'='stale_source_revision',answer::text;
 PERFORM set_config('role','none',true);
 ASSERT EXISTS(SELECT 1 FROM public.hand_actions WHERE id=act AND hand_id=hand);
 ASSERT (SELECT source_revision=rev FROM public.tournament_hands WHERE id=hand);
 ASSERT proof=(SELECT source_chain_hash FROM public.get_tournament_historical_display_source_hash(hand));
 ASSERT NOT EXISTS(SELECT 1 FROM public.tracker_correction_operations WHERE actor_user_id=actor);
 PERFORM set_config('role','authenticated',true);
  receipt:=public.undo_tracker_last_action_v1(tour,tbl,hand,act,rev,key);`);
once(" ASSERT (SELECT count(*)=2 FROM public.hand_actions WHERE hand_id=hand);\n ASSERT (SELECT count(*)=2 AND sum(chip_count)=60000 FROM public.tournament_seats WHERE tournament_table_id=tbl AND is_active);\nEND $$;",`
 ASSERT (SELECT count(*)=2 FROM public.hand_actions WHERE hand_id=hand);
 PERFORM set_config('role','authenticated',true);
 answer:=public.record_action(hand,sb,'call',3,1,'preflop',100,key||':call',NULL,actor);
 ASSERT answer->>'status'='success','captured_board_call_failed';
 answer:=public.record_action(hand,bb,'check',4,1,'preflop',0,key||':check',NULL,actor);
 ASSERT answer->>'status'='success','captured_board_check_failed';
 answer:=public.update_community_cards(hand,'["As","Kh","2c"]'::jsonb,actor);
 ASSERT answer->>'status'='success','captured_board_commit_failed_'||CASE WHEN answer->>'error' ~ '^[a-z_0-9]{1,64}$' THEN answer->>'error' ELSE 'unclassified' END;
 PERFORM set_config('role','none',true);
 SELECT source_revision INTO rev FROM public.tournament_hands WHERE id=hand;
 SELECT source_chain_hash INTO proof FROM public.get_tournament_historical_display_source_hash(hand);
 SELECT id INTO act FROM public.hand_actions WHERE hand_id=hand AND action_order=4;
 PERFORM set_config('role','authenticated',true);
 answer:=public.undo_tracker_last_action_v1(tour,tbl,hand,act,rev,boundary_key);
 ASSERT answer->>'error'='undo_boundary_board','captured_undo_board_denial_failed';
 PERFORM set_config('role','none',true);
 ASSERT EXISTS(SELECT 1 FROM public.hand_actions WHERE id=act AND hand_id=hand);
 ASSERT (SELECT count(*)=4 FROM public.hand_actions WHERE hand_id=hand);
 ASSERT (SELECT source_revision=rev AND community_cards='["As","Kh","2c"]'::jsonb FROM public.tournament_hands WHERE id=hand);
 ASSERT proof=(SELECT source_chain_hash FROM public.get_tournament_historical_display_source_hash(hand));
 ASSERT NOT EXISTS(SELECT 1 FROM public.tracker_correction_operations WHERE actor_user_id=actor AND idempotency_key=boundary_key);
 ASSERT (SELECT count(*)=2 AND sum(chip_count)=60000 FROM public.tournament_seats WHERE tournament_table_id=tbl AND is_active);
END $$;`);
const signatures=[
 ['public.undo_tracker_last_action_v1(uuid,uuid,uuid,uuid,bigint,uuid)','4d734b1811e1dd5cd4ff236d8d3f54d6'],
 ['public._tracker_correction_uat_context(uuid,uuid,uuid,text)','2e3c0d73bce278f80a8983d3a425f206'],
 ['public.delete_last_action(uuid,uuid)','af19be0f327568eafedac42e4c7671d8'],
 ['public.update_community_cards(uuid,jsonb,uuid)','619461b5a4d0ebfc6a239f3e89aca21b'],
];
const guard=`DO $guard$ BEGIN
 ASSERT current_database()='${database}';
 ASSERT current_user='postgres';
 ASSERT (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='vinpoker-owned-current-undo-20261107a';
 ${signatures.map(([name,hash])=>`ASSERT (SELECT md5(replace(prosrc,chr(13),''))='${hash}' FROM pg_proc WHERE oid='${name}'::regprocedure);`).join('\n')}
END $guard$;`;
const snapshot=`SELECT jsonb_build_array(${['tournament_hands','hand_players','hand_actions','tournament_seats',
 'dealer_assignments','dealer_attendance','dealers','dealer_shifts','tracker_correction_uat_scopes',
 'tracker_correction_operations','audit_logs'].map(name=>`(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'')) FROM public.${name} t)`).join(',')},
 (SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'')) FROM auth.users t)) fingerprint`;
// Replace two unrelated historical fixture assertions with full before/after
// fingerprints of every source/authorization/audit relation touched by this test.
once(" ASSERT (SELECT count(*)=7 AND sum(chip_count)=180000 FROM public.tournament_seats WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e' AND is_active);",'');
once(" ASSERT EXISTS(SELECT 1 FROM public.dealer_attendance WHERE id='592a1d69-3e2c-4a07-aa7a-8a77a7907f5f' AND shift_date='2026-10-20' AND current_state='available' AND check_out_time IS NULL);",'');
once('BEGIN;\nSET LOCAL lock_timeout',`BEGIN;\n${guard}\n${definition[0]}\n${boardDefinition}\nDO $pin$ BEGIN
 ASSERT (SELECT md5(replace(prosrc,chr(13),''))='60291b40aab10a1deccbe2aae1195215' FROM pg_proc WHERE oid='${signatures[0][0]}'::regprocedure);
 ASSERT (SELECT md5(replace(prosrc,chr(13),''))='64734d09453c95918299ca3f6e3cc339' FROM pg_proc WHERE oid='${signatures[3][0]}'::regprocedure);
END $pin$;\nSET LOCAL lock_timeout`);
fixture=fixture.replace("SELECT 'UNDO681_CANONICAL_CURRENT_CHECKIN_ASSIGN_START_ACTION_UNDO_REPLAY_CONFLICT_ROLLBACK_PASS';",`BEGIN READ ONLY;${guard}ROLLBACK;
DO $preserved$ BEGIN ASSERT (SELECT fingerprint FROM pg_temp.undo_captured_before)=(SELECT fingerprint FROM (${snapshot}) after_rows);END $preserved$;
SELECT 'CAPTURED_CURRENT_UNDO_NATIVE_ROLLBACK_PASS';`);
fixture=`${guard}\nCREATE TEMP TABLE undo_captured_before AS ${snapshot};\n${fixture}`;
const started=performance.now();
const result=spawnSync('wsl',['-d','PokerVision-P16-4C-Eval','--','psql','-X','-Atq','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-h','127.0.0.1','-p','55441','-U','postgres','-d',database],{input:fixture,encoding:'utf8',timeout:60000,maxBuffer:1048576,windowsHide:true});
const passed=result.status===0&&result.stdout.trim()==='CAPTURED_CURRENT_UNDO_NATIVE_ROLLBACK_PASS';
const report={kind:'CAPTURED_PRODUCTION_UNDO_NATIVE_ISOLATED_ROLLBACK',passed,
 bodyMd5:digest(definition[2]),contextBodyMd5:signatures[1][1],legacyDeleteBodyMd5:signatures[2][1],
 capturedBoardBodyMd5:digest(boards[0][2]),
 elapsedMs:performance.now()-started,exitCode:result.status,
 diagnosticSha256:passed?null:digest(String(result.stderr??''),'sha256'),
 diagnostic:passed?null:{assertionFailed:/ERROR:\s+P0004:/.test(result.stderr??''),
  sqlState:String(result.stderr??'').match(/ERROR:\s+([0-9A-Z]{5}):/)?.[1]??null,
  errorKind:String(result.stderr??'').match(/ERROR:\s+[0-9A-Z]{5}: ([a-z][a-z0-9_]+)\r?\n/)?.[1]??null,
  blockLine:Number(String(result.stderr??'').match(/inline_code_block line (\d+)/)?.[1]??0),
  permissionDenied:/permission denied/.test(result.stderr??''),missingRelation:/does not exist/.test(result.stderr??'')},
 productionChanged:false,qualification:false,
 checks:passed?['canonical-checkin-and-assignment','canonical-start-and-action','expired-capability-denied','different-actor-denied','cross-tour-denied','stale-revision-denied','denials-preserve-action-source-hash-and-receipts','last-action-deleted-only','source-revision-and-hash-changed','same-writer-idempotent-retry','key-payload-conflict','blind-boundary-denied','canonical-call-check-flop','board-boundary-denied-preserves-source','no-denial-receipt','seat-chip-conservation','source-fixture-rollback','original-function-bodies-restored']:[],
 limitations:'Native real PG roles on an owned clone;one successful Undo,not Auth HTTP/p95/concurrency/receipt-reader/cancellation or production capacity. Captured602Undo and647board writers are installed only inside the rolled-back transaction;other clone objects are not claimed to equal the full production catalog.'};
writeFileSync(reportPath,JSON.stringify(report,null,2),{mode:0o600,flag:'wx'});
console.log(JSON.stringify(report));
if(!passed)process.exitCode=1;
