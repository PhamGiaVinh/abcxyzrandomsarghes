import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
assert.equal(process.env.VINPOKER_STOCKTAKE1158_LOCAL,'1');
const legacyCompat=process.argv.includes('--legacy-compat1191');
const output=legacyCompat?'D:/Quy trình/output/reports/stocktake1191-legacy-compat-native-local-20261028.json':'D:/Quy trình/output/reports/stocktake1158-confirmed-counts-native-local-20261027.json';assert.equal(existsSync(output),false);
const sql=q=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',timeout:30000,maxBuffer:4e6}).trim();
const read=q=>JSON.parse(sql("BEGIN READ ONLY;SET LOCAL statement_timeout='10s';"+q+'ROLLBACK;'));
const guard=read("SELECT jsonb_build_object('db',current_database(),'host',host(inet_server_addr()),'port',inet_server_port(),'dir',current_setting('data_directory'),'comment',(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()),'external',(SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink')));");
assert.equal(guard.db,'vinpoker_ranking860_local');assert.equal(guard.host,'127.0.0.1');assert.equal(guard.port,55441);assert.equal(guard.dir,'/tmp/vinpoker-sol-local-20261016-0e79a729/data');assert.equal(guard.comment,'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');assert.equal(guard.external,0);
const actor='a364de8e-06b1-4428-a20d-ac614ec406e5',other='675fe35e-60a8-4452-bb90-e79486d54da6',club='349ecf35-50ba-4c71-a581-15dc45f1cd01';
const candidate='supabase/pending-migrations/20261027151355_fnb_confirmed_stocktake_snapshot_v1.sql';
const tables=['fnb_categories','fnb_menu_items','fnb_ingredients','fnb_recipe_items','fnb_stock_movements','fnb_stocktakes','fnb_stocktake_lines','fnb_orders','fnb_order_items','tournaments','tournament_entries','tournament_seats','cashier_buyin_movements','tournament_prize_payments','chip_bank_ledger','tournament_hands','table_operation_receipts'];
const fingerprint=()=>read('SELECT to_jsonb(md5(jsonb_build_array('+tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')+')::text));');
const before=fingerprint();
assert.equal(read(`SELECT to_jsonb(count(*)) FROM public.fnb_stocktakes WHERE club_id='${club}' AND status='open';`),0);
const claims=id=>`SET LOCAL request.jwt.claim.sub='${id}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='${JSON.stringify({sub:id,role:'authenticated'})}';SET LOCAL ROLE authenticated;`;
const ingredient="current_setting('test.s1158.ingredient')::uuid",session="current_setting('test.s1158.session')::uuid";
const map=qty=>`jsonb_build_object(${ingredient}::text,${qty})`;
const call=expected=>`public.fnb_commit_stocktake_confirmed_v1(${session},${expected})`;
const observe=(kind,expression)=>`SELECT jsonb_build_object('kind','${kind}','result',${expression});`;
const snapshot=kind=>`SELECT jsonb_build_object('kind','${kind}','status',(SELECT status FROM public.fnb_stocktakes WHERE id=${session}),'stock',(SELECT on_hand FROM public.fnb_ingredients WHERE id=${ingredient}),'avg',(SELECT avg_unit_cost FROM public.fnb_ingredients WHERE id=${ingredient}),'adjustments',(SELECT count(*) FROM public.fnb_stock_movements WHERE ingredient_id=${ingredient} AND reason='stocktake_adjust'),'net',(SELECT sum(delta) FROM public.fnb_stock_movements WHERE ingredient_id=${ingredient}));`;
const compatibilitySql=legacyCompat?'SAVEPOINT legacy_compat;'+
 observe('compatChangedCount',`public.fnb_set_stocktake_line(${session},${ingredient},1.75)`)+
 observe('compatLegacyFirst',`public.fnb_commit_stocktake(${session})`)+snapshot('compatAfterLegacy')+
 observe('compatStaleConfirmed',call(map("'1.25'")))+snapshot('compatAfterStale')+
 observe('compatExactConfirmed',call(map("'1.7500'")))+
 observe('compatLegacyRepeat',`public.fnb_commit_stocktake(${session})`)+snapshot('compatFinal')+
 'ROLLBACK TO SAVEPOINT legacy_compat;':'';
const raw=sql("BEGIN;SET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='3s';"+readFileSync(candidate,'utf8')+
 observe('acl',"jsonb_build_object('anon',has_function_privilege('anon','public.fnb_commit_stocktake_confirmed_v1(uuid,jsonb)','EXECUTE'),'authenticated',has_function_privilege('authenticated','public.fnb_commit_stocktake_confirmed_v1(uuid,jsonb)','EXECUTE'))")+claims(actor)+
 `DO $$ DECLARE r jsonb;BEGIN r:=public.fnb_upsert_ingredient('${club}',NULL,'LOCAL1158 confirmed count TEST','unit','unit',1,0,true);IF r->>'status'<>'ok' THEN RAISE EXCEPTION 'fixture ingredient failed';END IF;PERFORM set_config('test.s1158.ingredient',r->>'id',true);END $$;`+
 observe('stock',`public.fnb_stock_in('${club}',${ingredient},2,1000,'${randomUUID()}')`)+
 `DO $$ DECLARE r jsonb;BEGIN r:=public.fnb_open_stocktake('${club}',NULL,'${randomUUID()}');IF r->>'status'<>'ok' THEN RAISE EXCEPTION 'fixture session failed';END IF;PERFORM set_config('test.s1158.session',r->>'stocktake_id',true);END $$;`+
 observe('count125',`public.fnb_set_stocktake_line(${session},${ingredient},1.25)`)+observe('stockAfterCount',`public.fnb_stock_in('${club}',${ingredient},0.5,1000,'${randomUUID()}')`)+
 compatibilitySql+
 'SAVEPOINT legacy_red;'+observe('legacyIntervene',`public.fnb_set_stocktake_line(${session},${ingredient},1.75)`)+observe('legacyCommit',`public.fnb_commit_stocktake(${session})`)+snapshot('legacyRed')+'ROLLBACK TO SAVEPOINT legacy_red;'+
 observe('intervene',`public.fnb_set_stocktake_line(${session},${ingredient},1.75)`)+observe('staleDenied',call(map("'1.25'")))+snapshot('afterDenied')+
 observe('missingLineDenied',call("'{}'::jsonb"))+observe('nullDenied',call('NULL'))+observe('negativeDenied',call(map("'-1'")))+observe('nanDenied',call(map("'NaN'")))+
 claims(other)+observe('otherActorDenied',call(map("'1.75'")))+claims('')+observe('unauthenticatedDenied',call(map("'1.75'")))+claims(actor)+
 observe('freshConfirmed',call(map("'1.7500'")))+observe('exactReplay',call(map('1.75')))+(legacyCompat?observe('compatLegacyAfterConfirmed',`public.fnb_commit_stocktake(${session})`):'')+observe('wrongReplayDenied',call(map("'1.25'")))+observe('closedEditDenied',`public.fnb_set_stocktake_line(${session},${ingredient},999)`)+snapshot('final')+
 "RESET ROLE;ROLLBACK;");
const observations=raw.split(/\r?\n/).filter(Boolean).map(JSON.parse),get=kind=>observations.find(row=>row.kind===kind);
const after=fingerprint();const removed=read("SELECT jsonb_build_object('functionAbsent',to_regprocedure('public.fnb_commit_stocktake_confirmed_v1(uuid,jsonb)') IS NULL,'ingredientAbsent',NOT EXISTS(SELECT 1 FROM public.fnb_ingredients WHERE name='LOCAL1158 confirmed count TEST'));");
writeFileSync(output,JSON.stringify({guard,candidate,before,after,unchanged:before===after,observations,removed,retainedWrites:0},null,2)+'\n');
assert.equal(before,after);assert.deepEqual(removed,{functionAbsent:true,ingredientAbsent:true});
assert.deepEqual(get('acl').result,{anon:false,authenticated:true});
assert.equal(get('legacyRed').stock,1.75);assert.equal(get('legacyCommit').result.status,'ok');
for(const kind of ['staleDenied','missingLineDenied','wrongReplayDenied'])assert.equal(get(kind).result.error,'STOCKTAKE_COUNTS_CHANGED');
for(const kind of ['nullDenied','negativeDenied','nanDenied'])assert.equal(get(kind).result.error,'INVALID_EXPECTED_COUNTS');
assert.equal(get('otherActorDenied').result.error,'Forbidden');assert.equal(get('unauthenticatedDenied').result.error,'Unauthorized');
assert.equal(get('afterDenied').stock,2.5);assert.equal(get('afterDenied').status,'open');assert.equal(get('afterDenied').adjustments,0);
assert.equal(get('freshConfirmed').result.counts_confirmed,true);assert.equal(get('freshConfirmed').result.adjusted_lines,1);assert.equal(get('exactReplay').result.idempotent,true);assert.equal(get('closedEditDenied').result.error,'BAD_STATE');
assert.equal(get('final').stock,1.75);assert.equal(get('final').net,1.75);assert.equal(get('final').avg,1000);assert.equal(get('final').adjustments,1);
if(legacyCompat){
 assert.equal(get('compatLegacyFirst').result.status,'ok');
 assert.equal(get('compatStaleConfirmed').result.error,'STOCKTAKE_COUNTS_CHANGED');
 assert.equal(get('compatExactConfirmed').result.counts_confirmed,true);
 for(const kind of ['compatExactConfirmed','compatLegacyRepeat','compatLegacyAfterConfirmed'])assert.equal(get(kind).result.idempotent,true,kind);
 for(const kind of ['compatAfterLegacy','compatAfterStale','compatFinal']){
  const row=get(kind);assert.equal(row.status,'committed');assert.equal(row.stock,1.75);assert.equal(row.avg,1000);assert.equal(row.net,1.75);assert.equal(row.adjustments,1);
 }
}
console.log('STOCKTAKE1158_LEGACY_RED_CONFIRMED_REJECTION_FRESH_REPLAY_ACTOR_CONSERVATION_ROLLBACK_PASS');
