import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
assert.equal(process.env.VINPOKER_SCHEDULE1063_LOCAL,'1');const report='D:/Quy trình/output/reports/schedule1063-atomicity-native-local-20261027.json';assert.equal(existsSync(report),false);
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];const sql=q=>execFileSync('wsl',args,{input:q,encoding:'utf8',timeout:20000,maxBuffer:4e6}).trim();
const guard=JSON.parse(sql("BEGIN READ ONLY;SELECT jsonb_build_object('db',current_database(),'host',host(inet_server_addr()),'port',inet_server_port(),'dir',current_setting('data_directory'),'comment',(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()),'external',(SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink')));ROLLBACK;"));assert.equal(guard.db,'vinpoker_ranking860_local');assert.equal(guard.host,'127.0.0.1');assert.equal(guard.port,55441);assert.equal(guard.dir,'/tmp/vinpoker-sol-local-20261016-0e79a729/data');assert.equal(guard.comment,'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');assert.equal(guard.external,0);
const tables=['tournaments','tournament_levels','tournament_entries','tournament_seats','cashier_buyin_movements','tournament_prize_payments'];const fingerprint=()=>sql("BEGIN READ ONLY;SELECT md5(jsonb_build_array("+tables.map(t=>"(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public."+t+" x)").join(',')+")::text);ROLLBACK;");const before=fingerprint();
const actor='675fe35e-60a8-4452-bb90-e79486d54da6',club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',key=randomUUID();const rows=[100000,0].map((buy_in,i)=>({club_id:club,name:'Schedule1063 '+i+' '+key+' TEST',start_time:'2030-01-02T13:00:00Z',buy_in,starting_stack:20000,game_type:'nlh',location:null}));const literal=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
const badRows=[rows[0],{...rows[1],buy_in:9007199254740992}];
const input=literal(badRows);
const query="BEGIN;SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='15s';SET LOCAL request.jwt.claim.sub='"+actor+"';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{\"sub\":\""+actor+"\",\"role\":\"authenticated\"}';SET LOCAL ROLE authenticated;"+`DO $proof$ DECLARE result jsonb; initial jsonb; after_rows jsonb; receipt jsonb; control_result jsonb; control_id uuid; child jsonb; child_receipt jsonb; child_receipts jsonb:='[]'; ordinal integer:=0; BEGIN
 SELECT jsonb_build_object('tours',(SELECT count(*) FROM public.tournaments)) INTO initial;
 -- Positive control inside this outer rollback: first row can really create.
 control_result:=public.create_tournament_schedule_batch_v1(${literal([rows[0]])},'${randomUUID()}','${actor}');ASSERT control_result->>'ok'='true',control_result::text;
 control_id:=(control_result->'tournaments'->0->>'tournament_id')::uuid;
 ASSERT EXISTS(SELECT FROM public.tournaments WHERE id=control_id);
 -- Preserve the positive control while proving the failing two-child batch adds nothing.
 SELECT jsonb_build_object('tours',(SELECT count(*) FROM public.tournaments)) INTO initial;
 result:=public.create_tournament_schedule_batch_v1(${input},'${key}','${actor}');ASSERT result->>'ok'='false' AND result->>'error'='invalid_create_money',result::text;
 SELECT jsonb_build_object('tours',(SELECT count(*) FROM public.tournaments)) INTO after_rows;ASSERT after_rows=initial,'partial batch persisted';
 receipt:=public.get_tournament_schedule_batch_receipt_v1(${input},'${key}','${actor}');ASSERT receipt->>'error'='receipt_not_found';
 FOR child IN SELECT value FROM jsonb_array_elements(${input}) LOOP
 ordinal:=ordinal+1;
 child_receipt:=public.get_tournament_create_receipt_v1((child->>'club_id')::uuid,(child-'club_id')||jsonb_build_object('rake_amount',0,'minutes_per_level',20,'late_reg_close_level',6),'[]'::jsonb,md5('schedule-batch-v1:${key}:'||ordinal::text)::uuid,'${actor}');
 ASSERT child_receipt->>'error'='receipt_not_found',child_receipt::text;
 child_receipts:=child_receipts||jsonb_build_array(child_receipt);
 END LOOP;
 PERFORM set_config('test.schedule1063.result',jsonb_build_object('control',control_result,'failedRequestRows',${input},'failure',result,'receipt',receipt,'childReceipts',child_receipts,'beforeFailure',initial,'afterFailure',after_rows)::text,true);
 END $proof$;SELECT current_setting('test.schedule1063.result');ROLLBACK;`;
const proof=JSON.parse(sql(query)),after=fingerprint();assert.equal(after,before);const out={kind:'EXISTING_ACTOR_NATIVE_BATCH_SECOND_CHILD_MONEY_DENIAL_FULL_ROLLBACK_NOT_BROWSER',guard,requestId:key,proof,before,after,unchanged:true};writeFileSync(report,JSON.stringify(out,null,2));console.log('SCHEDULE1063_FIRST_CHILD_POSITIVE_SECOND_CHILD_DENIED_NO_PARTIAL_TOUR_OR_RECEIPTS_ROLLBACK_PASS');
