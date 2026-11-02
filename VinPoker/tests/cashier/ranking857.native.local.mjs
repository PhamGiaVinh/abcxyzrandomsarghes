import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
assert.equal(process.env.VINPOKER_RANKING857_LOCAL,'1');
assert.ok(process.argv.slice(2).every(x=>['--candidate','--confirm'].includes(x)));
if(process.argv.includes('--confirm'))assert.ok(process.argv.includes('--candidate'));
const prefix=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=input=>execFileSync('wsl',prefix,{input,encoding:'utf8',timeout:30000,maxBuffer:2e6});
const guard=`DO $$ BEGIN ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));END $$;`;
const tables=['tournaments','tournament_entries','tournament_seats','tournament_hands','hand_players','tournament_eliminations','cashier_buyin_movements','tournament_prize_payments','tournament_close_report','game_tables','table_sessions','tournament_tables'];
const fingerprint=()=>sql(`BEGIN READ ONLY;SET LOCAL statement_timeout='15s';${guard}
SELECT md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.${t} r)`).join(',')},
(SELECT jsonb_agg(jsonb_build_object('definition',pg_get_functiondef(oid),'owner',proowner,'acl',proacl,'config',proconfig,'volatility',provolatile) ORDER BY oid)
 FROM pg_proc WHERE oid IN('public.finalize_tournament_results(uuid)'::regprocedure,'floor_private.felt_official_results_close_status_v1(uuid)'::regprocedure)),
to_regclass('floor_private.tournament_ranking_reviews296')::text,
to_regprocedure('public.get_tournament_ranking_review_v1(uuid)')::text,
to_regprocedure('public.confirm_tournament_ranking_review_v1(uuid,text,uuid[],uuid,uuid)')::text,
to_regprocedure('public.get_tournament_ranking_review_receipt_v1(uuid,uuid,uuid)')::text,
to_regprocedure('floor_private.tournament_ranking_source296(uuid)')::text,
(SELECT count(*) FROM auth.users WHERE id::text LIKE 'fa857000-%'),
(SELECT count(*) FROM public.clubs WHERE id='fa857000-0000-4000-8000-000000000001'))::text);ROLLBACK;`).trim();
const before=fingerprint();let source=readFileSync('tests/cashier/ranking857.manual-review.rollback.sql','utf8');
if(process.argv.includes('--confirm'))source=source.replace('-- RANK857_CONFIRMATION_EXTENSION',()=>readFileSync('tests/cashier/ranking858.confirmation.extension.sql','utf8'));
if(process.argv.includes('--candidate')){
 const candidate=readFileSync('supabase/migrations/20270128000296_manual_ranking_review_v1.sql','utf8').replace(/^BEGIN;\r?$/m,'').replace(/^COMMIT;\r?$/m,'');
 source='BEGIN;\n'+candidate+'\n'+source.replace(/^BEGIN;\r?$/m,'');
}
let failed=false;
try{process.stdout.write(sql(source));}catch(error){failed=true;process.stdout.write(String(error.stdout??''));process.stderr.write(String(error.stderr??''));}
assert.equal(fingerprint(),before,'ranking857 rollback changed protected business/catalog state');
console.log('RANK857_FULL_ROLLBACK_PROTECTED_BUSINESS_AND_CATALOG_UNCHANGED');
if(failed)process.exitCode=1;
