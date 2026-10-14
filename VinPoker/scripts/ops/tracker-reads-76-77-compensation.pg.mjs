import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {readFileSync} from 'node:fs';
const win=process.platform==='win32',port=win?'55464':'55441';
if(!win){assert.equal(process.platform,'linux');assert.equal(process.env.CI,'true');assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGPORT,port);assert.equal(process.env.PGUSER,'postgres');}
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const args=['-X','-w','-t','-A','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',port,'-U','postgres','-d','vinpoker_reads76_77_compensation_20261014'];
const run=sql=>spawnSync(win?'wsl':'psql',win?['-d','PokerVision-P16-4C-Eval','--','psql',...args]:args,{input:sql,encoding:'utf8',timeout:45000});
const guard=`DO $$ BEGIN IF current_database()<>'vinpoker_reads76_77_compensation_20261014' OR current_user<>'postgres' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port()<>${Number(port)} OR (SELECT count(*) FROM public.clubs)<>2 THEN RAISE EXCEPTION 'owned_reads_compensation_required'; END IF; END $$;`;
const targetNames="'tracker_hand_input_context_v4','get_tracker_hand_input_tables_v4','tracker_roster_snapshot_v2','get_tracker_roster_snapshot_v2'";
const rows=['public.tournament_hands','public.hand_players','public.tournament_seats','public.table_sessions','public.dealer_assignments','public.tracker_historical_display_queue','floor_private.tracker_manual_card_receipts_v1','supabase_migrations.schema_migrations'];
const snapshot=()=>{const r=run(`BEGIN READ ONLY;${guard} SELECT md5(jsonb_build_object('rows',jsonb_build_array(${rows.map(t=>`(SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text) FROM ${t} r)`).join(',')}),'functions',(SELECT jsonb_agg(jsonb_build_object('oid',p.oid,'definition',pg_get_functiondef(p.oid),'owner',p.proowner,'acl',CASE WHEN p.proname IN (${targetNames}) THEN NULL ELSE p.proacl::text END,'config',p.proconfig) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','floor_private') AND p.prokind='f'))::text);COMMIT;`);assert.equal(r.status,0,r.stderr);const digest=r.stdout.split('\n').find(x=>/^[a-f0-9]{32}$/u.test(x.trim()));assert.ok(digest,r.stdout);return digest.trim();};
const before=snapshot(),source=readFileSync('docs/runbooks/TRACKER_READS_76_77_COMPENSATION_SOURCE.sql','utf8').replaceAll('\r\n','\n');
const applied=run(source.replace('BEGIN;',()=>`BEGIN;${guard}`));assert.equal(applied.status,0,applied.stderr);assert.equal(snapshot(),before,'compensation changed histories/functions/receipts outside four ACLs');
const denied=run(`BEGIN;${guard} SET LOCAL ROLE authenticated;DO $$ BEGIN
 BEGIN PERFORM public.get_tracker_hand_input_tables_v4('85000000-0000-4000-8000-000000000001');RAISE EXCEPTION 'list_still_callable';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.get_tracker_roster_snapshot_v2('85000000-0000-4000-8000-000000000001',NULL,NULL,1);RAISE EXCEPTION 'roster_still_callable';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;ROLLBACK;`);assert.equal(denied.status,0,denied.stderr);
console.log('READS76_77_COMPENSATION_COMMIT_HISTORY_RECEIPTS_LEGACY_FUNCTIONS_UNCHANGED_NEW_API_DENIED_PASS');
