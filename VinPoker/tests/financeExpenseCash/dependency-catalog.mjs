import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGDATABASE,'vinpoker_ops_expense_cash_catalog');
assert.ok(process.env.RUNNER_TEMP);
const expense='supabase/migrations/20270128000354_finance_expense_scope_idempotency.sql';
const pt='supabase/pending-migrations/20261126001901_finance_pt_cash_drawer_link_v1.sql';
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
assert.equal(hash(expense),'4c7615860dba50225a6507f6b2db378f417701a3968bb0063414bdad1ac62632');
assert.equal(hash(pt),'44106b5d3500dbb9c1b2f4d3a1feecfc6c83f1ff018266e1951f32d8b5eb2dcb');
function psql(args){const r=spawnSync('psql',['-XqAt','-v','ON_ERROR_STOP=1',...args],{encoding:'utf8'});assert.equal(r.status,0,String(r.stderr).slice(0,1600));return r.stdout.trim();}
assert.equal(psql(['-c','SELECT count(*) FROM public.clubs']),'0');
const serverVersion=psql(['-c','SHOW server_version']);
assert.equal(Math.floor(Number(psql(['-c','SHOW server_version_num']))/10000),17);
psql(['-f',expense]);psql(['--single-transaction','-f',pt]);
const catalog=JSON.parse(psql(['-c',`SELECT jsonb_build_object(
 'constraints',(SELECT jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid),'validated',convalidated) ORDER BY conname) FROM pg_constraint WHERE conrelid='public.cashier_buyin_movements'::regclass),
 'indexes',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'definition',pg_get_indexdef(i.indexrelid),'unique',i.indisunique,'valid',i.indisvalid,'ready',i.indisready) ORDER BY c.relname) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid='public.cashier_buyin_movements'::regclass),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('table',t.tgrelid::regclass::text,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid),'source_md5',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'config',p.proconfig,'acl',p.proacl::text) ORDER BY t.tgrelid::regclass::text,t.tgname) FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid IN('public.cashier_buyin_movements'::regclass,'public.dealer_pt_wage_payments'::regclass) AND NOT t.tgisinternal),
 'functions',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'identity',pg_get_function_identity_arguments(p.oid),'source_md5',md5(p.prosrc),'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'config',p.proconfig,'acl',p.proacl::text) ORDER BY n.nspname,p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='floor_private' AND p.proname IN('bind_pt_cash_drawer_v1','preserve_pt_cash_source_v1','record_pt_cash_movement_v1','verify_pt_cash_movement_v1')) OR (n.nspname='public' AND p.proname IN('record_club_expense','cashier_shift_summary_v1','cashier_cashflow_range_v1','cashier_close_shift_v1','is_club_cashier','cashier_tour_active_v1'))),
 'source_columns',(SELECT jsonb_agg(jsonb_build_object('table',a.attrelid::regclass::text,'column',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attrelid::regclass::text,a.attname) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid IN('public.cashier_tour_settings'::regclass,'public.dealer_pt_wage_payments'::regclass,'public.cashier_buyin_movements'::regclass) AND a.attname IN('pt_cash_drawer_link_enabled','cashier_shift_id','dealer_pt_wage_payment_id'))
)`]));
const proof={sourceSha:process.env.SOURCE_SHA,serverVersion,scope:'exact expense354 plus PTd729 prerequisite metadata only; expense cash candidate NOT applied',qualification:false,productionMutation:false,productionCapacityClaim:false,expense354SqlSha256:hash(expense),ptSqlSha256:hash(pt),catalog};
writeFileSync(join(process.env.RUNNER_TEMP,'expense-cash-dependency-catalog.json'),JSON.stringify(proof));
console.log('EXPENSE_CASH_DEPENDENCY_CATALOG_CAPTURED_QUALIFICATION_FALSE');
