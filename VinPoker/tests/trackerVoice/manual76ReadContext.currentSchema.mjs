import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGUSER,'postgres');
assert.equal(process.env.PGDATABASE,'vinpoker_manual76_read_20261014');
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const win=process.platform==='win32';
if(win){assert.equal(process.env.PGPORT,'55464');assert.match(process.env.VINPOKER_TEST_WSL_DISTRO??'',/^[A-Za-z0-9_.-]+$/u);}
else{assert.equal(process.platform,'linux');assert.equal(process.env.CI,'true');assert.equal(process.env.PGPORT,'55441');}
const base=['-X','-w','-t','-A','-v','ON_ERROR_STOP=1','-h',process.env.PGHOST,'-p',process.env.PGPORT,'-U','postgres','-d',process.env.PGDATABASE];
const run=sql=>spawnSync(win?'wsl':'psql',win?['-d',process.env.VINPOKER_TEST_WSL_DISTRO,'--','psql',...base]:base,{input:sql.replaceAll('\r\n','\n'),encoding:'utf8',timeout:45000,maxBuffer:2*1024*1024});
const guard=`DO $$ BEGIN
 IF current_database()<>'vinpoker_manual76_read_20261014' OR current_user<>'postgres'
 OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port()<>${Number(process.env.PGPORT)}
 OR (SELECT count(*) FROM public.clubs)<>2
 OR md5(replace(pg_get_functiondef('floor_private.tracker_hand_input_context_v4(uuid)'::regprocedure),chr(13),''))<>'588f4bc2f1b8ce3839bb42a635f7b6a0'
 OR md5(replace(pg_get_functiondef('public.get_tracker_hand_input_tables_v4(uuid)'::regprocedure),chr(13),''))<>'b815d03fd7b596eba689f7a788fc49fc'
 OR md5(replace(pg_get_functiondef('public.get_tracker_hand_input_tables_v3(uuid)'::regprocedure),chr(13),''))<>'f5bd425da1ca2d94367c5136de16bdc1'
 OR md5(replace(pg_get_functiondef('floor_private.tracker_manual_cards_v1(uuid,uuid,bigint,bigint,text,jsonb)'::regprocedure),chr(13),''))<>'37faf2e637e06d255c0f9186d3a7e9e9'
 THEN RAISE EXCEPTION 'exact_owned76_context_required'; END IF; END $$;`;
const snapshot=()=>{
 const r=run(`BEGIN READ ONLY;${guard}
 SELECT md5(jsonb_build_object(
 'hands',(SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id) FROM public.tournament_hands h),
 'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.tournament_seats s),
 'sessions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.table_sessions s),
 'assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.dealer_assignments a),
 'floors',(SELECT jsonb_agg(to_jsonb(f) ORDER BY f.club_id,f.user_id) FROM public.club_floors f),
 'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.actor_id,r.request_key) FROM floor_private.tracker_manual_card_receipts_v1 r)
 )::text); COMMIT;`);
 assert.equal(r.status,0,r.stderr);const digest=r.stdout.split('\n').find(line=>/^[a-f0-9]{32}$/u.test(line.trim()));assert.ok(digest,r.stdout);return digest.trim();
};
const before=snapshot();
const prototype=readFileSync('tests/trackerVoice/manual76ReadContext.prototype.pg17.sql','utf8').replaceAll('\r\n','\n');
const boundary='DO $$ BEGIN\n IF has_function_privilege';assert.equal(prototype.split(boundary).length,2);
const cases=prototype.slice(prototype.indexOf(boundary))
 .replaceAll('public.manual76_context_prototype','public.get_tracker_hand_input_tables_v4')
 .replaceAll('floor_private.manual76_context_prototype','floor_private.tracker_hand_input_context_v4');
const result=run(`BEGIN;${guard}\n${cases}`);assert.equal(result.status,0,result.stderr);
assert.match(result.stdout,/MANUAL76_SCOPED_READ_PROTOTYPE_FLOOR_DEALER_OUTSIDER_INACTIVE_PASS_NOT_RELEASE/u);
assert.equal(snapshot(),before,'context role/legacy fixture failed to roll back canonical data');
console.log('MANUAL76_CANONICAL_SCOPED_READ_ROLE_LIFECYCLE_MATRIX_ROLLBACK_PASS');
