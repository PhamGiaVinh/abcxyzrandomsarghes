import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
assert.equal(process.env.VINPOKER_SCHEDULE1061_LOCAL,'1');const report='D:/Quy trình/output/reports/schedule1061-readiness-native-local-20261027.json';assert.equal(existsSync(report),false);
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];const sql=q=>execFileSync('wsl',args,{input:q,encoding:'utf8',timeout:20000,maxBuffer:4e6}).trim();
const guard=JSON.parse(sql("BEGIN READ ONLY;SELECT jsonb_build_object('db',current_database(),'host',host(inet_server_addr()),'port',inet_server_port(),'dir',current_setting('data_directory'),'comment',(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()),'external',(SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink')));ROLLBACK;"));assert.equal(guard.db,'vinpoker_ranking860_local');assert.equal(guard.host,'127.0.0.1');assert.equal(guard.port,55441);assert.equal(guard.dir,'/tmp/vinpoker-sol-local-20261016-0e79a729/data');assert.equal(guard.comment,'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');assert.equal(guard.external,0);
const tables=['tournaments','tournament_levels','tournament_entries','tournament_seats','cashier_buyin_movements','tournament_prize_payments'];const fingerprint=()=>sql("BEGIN READ ONLY;SELECT md5(jsonb_build_array("+tables.map(t=>"(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public."+t+" x)").join(',')+")::text);ROLLBACK;");const before=fingerprint();
const actor='675fe35e-60a8-4452-bb90-e79486d54da6',club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',key=randomUUID();const rows=[100000,0].map((buy_in,i)=>({club_id:club,name:'Schedule1061 '+i+' '+key+' TEST',start_time:'2030-01-02T13:00:00Z',buy_in,starting_stack:20000,game_type:'nlh',location:null}));const literal=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
const input=literal(rows),changed=literal([{...rows[0],name:'Different payload TEST'},rows[1]]);
const query="BEGIN;SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='15s';SET LOCAL request.jwt.claim.sub='"+actor+"';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{\"sub\":\""+actor+"\",\"role\":\"authenticated\"}';SET LOCAL ROLE authenticated;"+`DO $proof$ DECLARE result jsonb; replay jsonb; receipt jsonb; conflict jsonb; child jsonb; tour uuid; initial jsonb; started jsonb; saved jsonb:='[]'; BEGIN
 result:=public.create_tournament_schedule_batch_v1(${input},'${key}','${actor}');ASSERT result->>'ok'='true',result::text;
 replay:=public.create_tournament_schedule_batch_v1(${input},'${key}','${actor}');receipt:=public.get_tournament_schedule_batch_receipt_v1(${input},'${key}','${actor}');ASSERT replay=result AND receipt=result;
 conflict:=public.create_tournament_schedule_batch_v1(${changed},'${key}','${actor}');ASSERT conflict->>'error'='IDEMPOTENCY_CONFLICT';
 FOR child IN SELECT value FROM jsonb_array_elements(result->'tournaments') LOOP
  tour:=(child->>'tournament_id')::uuid;SELECT to_jsonb(t) INTO initial FROM public.tournaments t WHERE id=tour;
  ASSERT initial->>'status'='active' AND initial->>'live_status'='registering' AND initial->'current_level'='null'::jsonb;
  ASSERT NOT EXISTS(SELECT FROM public.tournament_levels WHERE tournament_id=tour);
  started:=public.floor_start_tournament_clock(tour);ASSERT started->>'ok'='false' AND started->>'error'='no_tournament_level',started::text;
  ASSERT initial=(SELECT to_jsonb(t) FROM public.tournaments t WHERE id=tour),'clock rejection changed tournament';
  ASSERT NOT EXISTS(SELECT FROM public.tournament_entries WHERE tournament_id=tour);
  ASSERT NOT EXISTS(SELECT FROM public.cashier_buyin_movements WHERE tournament_id=tour);
  saved:=saved||jsonb_build_array(jsonb_build_object('id',tour,'status',initial->'status','live_status',initial->'live_status','current_level',initial->'current_level','buy_in',initial->'buy_in','starting_stack',initial->'starting_stack','clockStartError',started->'error'));
 END LOOP;
 PERFORM set_config('test.schedule1061.result',jsonb_build_object('receipt',result,'replaySame',true,'readReceiptSame',true,'conflict',conflict,'saved',saved)::text,true);
 END $proof$;SELECT current_setting('test.schedule1061.result');ROLLBACK;`;
const proof=JSON.parse(sql(query)),after=fingerprint();assert.equal(after,before);assert.equal(proof.saved.length,2);assert.deepEqual(proof.saved.map(r=>r.buy_in),[100000,0]);const out={kind:'EXISTING_ACTOR_NATIVE_SCHEDULE_BATCH_CLOCK_READINESS_TRANSACTION_ROLLBACK_NOT_BROWSER',guard,requestId:key,proof,before,after,unchanged:true};writeFileSync(report,JSON.stringify(out,null,2));console.log('SCHEDULE1061_TWO_CHILD_REPLAY_RECEIPT_CONFLICT_NO_LEVEL_CLOCK_DENIED_NO_ENTRIES_MONEY_ROLLBACK_PASS');
