import assert from 'node:assert/strict';import{execFileSync}from'node:child_process';import{randomUUID}from'node:crypto';import{readFileSync,writeFileSync,existsSync}from'node:fs';assert.equal(process.env.VINPOKER_STOCK1095_LOCAL,'1');const output='D:/Quy trình/output/reports/stock1095-native-binding-rollback-local-20261027.json';assert.equal(existsSync(output),false);
const sql=q=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',timeout:20000,maxBuffer:4e6}).trim();
const read=q=>JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL statement_timeout='10s';${q}ROLLBACK;`));
const guard=read(`SELECT jsonb_build_object('db',current_database(),'host',host(inet_server_addr()),'port',inet_server_port(),'dir',current_setting('data_directory'),'comment',(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()),'external',(SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink')));`);
assert.equal(guard.db,'vinpoker_ranking860_local');assert.equal(guard.host,'127.0.0.1');assert.equal(guard.port,55441);assert.equal(guard.dir,'/tmp/vinpoker-sol-local-20261016-0e79a729/data');assert.equal(guard.external,0);assert.equal(guard.comment,'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
const tables=['fnb_categories','fnb_menu_items','fnb_ingredients','fnb_recipe_items','fnb_stock_movements','fnb_stocktakes','fnb_stocktake_lines','fnb_orders','fnb_order_items','tournaments','tournament_entries','tournament_seats','cashier_buyin_movements','tournament_prize_payments','chip_bank_ledger','tournament_hands','table_operation_receipts'];
const fingerprint=()=>read(`SELECT to_jsonb(md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text));`);





const manifest=JSON.parse(readFileSync('D:/Quy trình/output/reports/stock1095-candidate-manifest-local-20261027.json','utf8'));
const up=readFileSync(manifest.up,'utf8'),down=readFileSync(manifest.down,'utf8');
const actor='a364de8e-06b1-4428-a20d-ac614ec406e5',club='349ecf35-50ba-4c71-a581-15dc45f1cd01',ingredient='7ebcc99b-b544-4764-a943-0fc94985f619',request=randomUUID(),legacy=randomUUID();
const body=()=>sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fnb_stock_in(uuid,uuid,numeric,numeric,text)'::regprocedure;");assert.equal(body(),manifest.beforeBody);const before=fingerprint();
const meta="md5(jsonb_build_array(oid,proowner,proacl,proconfig,prosecdef,prorettype,proargtypes::text,proargnames,provolatile,proparallel)::text)";
const claims=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
const raw=sql(`BEGIN;SET LOCAL statement_timeout='10s';SELECT jsonb_build_object('kind','metadata_before','value',${meta}) FROM pg_proc WHERE oid='public.fnb_stock_in(uuid,uuid,numeric,numeric,text)'::regprocedure;
${claims}
SELECT jsonb_build_object('kind','before','on_hand',on_hand,'avg',avg_unit_cost,'conversion',units_per_purchase) FROM public.fnb_ingredients WHERE club_id='${club}' AND id='${ingredient}';
SELECT jsonb_build_object('kind','legacy_created','result',public.fnb_stock_in('${club}','${ingredient}',1,1000,'${legacy}'));
RESET ROLE;${up}${up}${claims}
SELECT jsonb_build_object('kind','first','result',public.fnb_stock_in('${club}','${ingredient}',2,1000,'${request}'));
SELECT jsonb_build_object('kind','same','result',public.fnb_stock_in('${club}','${ingredient}',2.00,1000.00,'${request}'));
SELECT jsonb_build_object('kind','qty_conflict','result',public.fnb_stock_in('${club}','${ingredient}',999,1000,'${request}'));
SELECT jsonb_build_object('kind','cost_conflict','result',public.fnb_stock_in('${club}','${ingredient}',2,999999,'${request}'));
SELECT jsonb_build_object('kind','ingredient_conflict','result',public.fnb_stock_in('${club}',(SELECT id FROM public.fnb_ingredients WHERE club_id='${club}' AND id<>'${ingredient}' ORDER BY id LIMIT 1),2,1000,'${request}'));
SELECT jsonb_build_object('kind','legacy_unverified','result',public.fnb_stock_in('${club}','${ingredient}',1,1000,'${legacy}'));
SELECT jsonb_build_object('kind','movements','count',count(*),'delta',sum(delta),'frozen',(SELECT details->'stock_in_intent_v1' FROM public.fnb_stock_movements WHERE club_id='${club}' AND client_request_id='${request}')) FROM public.fnb_stock_movements WHERE club_id='${club}' AND client_request_id IN('${request}','${legacy}');
SELECT jsonb_build_object('kind','after_writes','on_hand',on_hand,'avg',avg_unit_cost) FROM public.fnb_ingredients WHERE club_id='${club}' AND id='${ingredient}';
RESET ROLE;SELECT jsonb_build_object('kind','metadata_after','value',${meta},'body',md5(prosrc)) FROM pg_proc WHERE oid='public.fnb_stock_in(uuid,uuid,numeric,numeric,text)'::regprocedure;
${down}${down}
SELECT jsonb_build_object('kind','down','body',md5(prosrc)) FROM pg_proc WHERE oid='public.fnb_stock_in(uuid,uuid,numeric,numeric,text)'::regprocedure;
ROLLBACK;`);
const observations=raw.split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x)),get=k=>observations.find(x=>x.kind===k);assert.equal(get('before').conversion,1);assert.equal(get('legacy_created').result.status,'ok');assert.equal(get('first').result.status,'ok');assert.deepEqual(get('same').result,{status:'ok',idempotent:true});for(const k of ['qty_conflict','cost_conflict','ingredient_conflict'])assert.deepEqual(get(k).result,{error:'STOCK_IN_REQUEST_CONFLICT'});assert.deepEqual(get('legacy_unverified').result,{error:'STOCK_IN_INTENT_UNVERIFIED'});assert.equal(get('movements').count,2);assert.equal(get('movements').delta,3);assert.equal(get('after_writes').on_hand,get('before').on_hand+3);assert.equal(get('after_writes').avg,1000);assert.equal(get('metadata_before').value,get('metadata_after').value);assert.equal(get('metadata_after').body,manifest.afterBody);assert.equal(get('down').body,manifest.beforeBody);const after=fingerprint();assert.equal(after,before);assert.equal(body(),manifest.beforeBody);const absent=read(`SELECT to_jsonb(count(*)) FROM public.fnb_stock_movements WHERE club_id='${club}' AND client_request_id IN('${request}','${legacy}');`);assert.equal(absent,0);writeFileSync(output,JSON.stringify({kind:'CANDIDATE_EXISTING_OWNER_PUBLIC_RPC_UP_REAPPLY_DOWN_REAPPLY_ALL_OUTER_ROLLBACK_NOT_DURABLE_OR_E2E',guard,manifest,before,after,unchanged:true,absentAfterRollback:absent,observations},null,2)+'\n');console.log(JSON.stringify({same:get('same').result,conflict:get('qty_conflict').result,legacy:get('legacy_unverified').result,movements:get('movements'),stock:get('after_writes'),unchanged:true}));
