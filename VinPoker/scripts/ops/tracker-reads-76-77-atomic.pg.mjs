import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {atomicSql,postcheckSql,loadMigrations} from './tracker-reads-76-77-release-plan.mjs';
import {receiptSql} from './floor-37-47-protected-apply.mjs';
assert.equal(process.platform,'win32');for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const run=sql=>spawnSync('wsl',['-d','PokerVision-P16-4C-Eval','--','psql','-X','-w','-t','-A','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55464','-U','postgres','-d','vinpoker_reads76_77_atomic_20261014'],{input:sql,encoding:'utf8',timeout:45000});
const guard=`DO $$ BEGIN IF current_database()<>'vinpoker_reads76_77_atomic_20261014' OR current_user<>'postgres' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port()<>55464 OR (SELECT count(*) FROM public.clubs)<>2 THEN RAISE EXCEPTION 'owned_reads76_77_atomic_required'; END IF; END $$;`;
const snapshot=()=>{const r=run(`BEGIN READ ONLY;${guard} SELECT md5(jsonb_build_object('functions',(SELECT jsonb_agg(jsonb_build_object('oid',p.oid,'definition',pg_get_functiondef(p.oid),'owner',p.proowner,'acl',p.proacl::text,'path',p.proconfig) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','floor_private') AND p.prokind='f'),'ledger',(SELECT jsonb_agg(to_jsonb(m) ORDER BY version) FROM supabase_migrations.schema_migrations m))::text);COMMIT;`);assert.equal(r.status,0,r.stderr);const digest=r.stdout.split('\n').find(x=>/^[a-f0-9]{32}$/u.test(x.trim()));assert.ok(digest,r.stdout);return digest.trim();};
const before=snapshot(),sql=atomicSql().replace('BEGIN;',()=>`BEGIN;${guard}`);
const failed=run(sql.replace(/COMMIT;\s*$/u,'SELECT 1/0; COMMIT;'));assert.notEqual(failed.status,0);assert.match(failed.stderr,/division by zero/u);assert.equal(snapshot(),before);
const committed=run(sql);assert.equal(committed.status,0,committed.stderr);
for(const item of loadMigrations()){const r=run(receiptSql(item));assert.equal(r.status,0,r.stderr);const json=r.stdout.split('\n').find(x=>x.trim().startsWith('{'));assert.ok(json,r.stdout);const receipt=JSON.parse(json);assert.equal(receipt.count,1);assert.equal(receipt.exact,true);}
const post=run(postcheckSql());assert.equal(post.status,0,post.stderr);
const replay=run(sql);assert.notEqual(replay.status,0);assert.match(replay.stderr,/ledger_collision/u);
console.log('SCOPED_READS76_77_PRECOMMIT_ATOMIC_ROLLBACK_EXACT_LEDGER_COMMIT_POSTCHECK_REPLAY_DENIAL_PASS');
