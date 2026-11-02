import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,writeFileSync} from 'node:fs';
assert.equal(process.env.VINPOKER_EARLYITM1206_LOCAL,'1');
const output='D:/Quy trình/output/reports/earlyitm1206-paid-restore-qualified-local-20261028.json';
assert.equal(existsSync(output),false);
const sql=q=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_earlyitm1172_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',timeout:20000,maxBuffer:4e6}).trim();
const read=q=>JSON.parse(sql('BEGIN READ ONLY;'+q+'ROLLBACK;'));
const guard=read("SELECT jsonb_build_object('db',current_database(),'host',host(inet_server_addr()),'port',inet_server_port(),'dir',current_setting('data_directory'),'comment',(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()),'external',(SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink')));");
assert.deepEqual(guard,{db:'vinpoker_earlyitm1172_local',host:'127.0.0.1',port:55441,dir:'/tmp/vinpoker-sol-local-20261016-0e79a729/data',comment:'VINPOKER_EARLYITM1172_OWNED_LOCAL_SOURCE_ranking860_HEAD_ef6a26948',external:0});
const tables=['public.tournaments','public.tournament_entries','public.tournament_seats','public.tournament_tables','public.table_sessions','public.tournament_hands','public.tournament_prize_payments','public.table_operation_receipts','public.audit_logs','private.multi_day_individual_results_v1','private.multi_day_individual_obligations_v1','private.multi_day_individual_payment_commits_v1','floor_private.payout_payment_receipts_v1'];
const fingerprint=()=>read("SELECT to_jsonb(md5(jsonb_build_array("+tables.map(t=>"(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM "+t+" x)").join(',')+")::text));");
const before=fingerprint();
const probe=String.raw`BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
SET LOCAL request.jwt.claim.sub='495e96be-c00b-4e68-b227-593300f3e2bc';
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claims='{"sub":"495e96be-c00b-4e68-b227-593300f3e2bc","role":"authenticated"}';
DO $$ DECLARE target record; wrapper text; result jsonb; outcomes jsonb:='[]';
 v_entry uuid:='bd43332b-a941-4d79-bcab-4e0686cb38fa';
 tour_id uuid:='e25c75c1-6cf0-4b5b-bf92-55b7054a52f9';
BEGIN
 ASSERT (SELECT status='busted' FROM public.tournament_entries WHERE id=v_entry AND tournament_id=tour_id);
 ASSERT (SELECT count(*)=1 AND sum(prize_amount)=100000 FROM public.tournament_prize_payments WHERE tournament_id=tour_id);
 ASSERT (SELECT count(*)=1 FROM private.multi_day_individual_results_v1 WHERE entry_id=v_entry AND finished_place=8);
 SELECT t.id,s.revision,s.control_epoch,n.seat INTO STRICT target
 FROM public.tournament_tables t JOIN public.table_sessions s ON s.id=t.table_session_id
 CROSS JOIN LATERAL(SELECT n AS seat FROM generate_series(1,9)n WHERE NOT EXISTS(
  SELECT 1 FROM public.tournament_seats occupied WHERE occupied.tournament_table_id=t.id AND occupied.is_active AND occupied.seat_number=n) ORDER BY n LIMIT 1)n
 WHERE t.tournament_id=tour_id AND t.status='active' ORDER BY t.id LIMIT 1;
 FOREACH wrapper IN ARRAY ARRAY['floor_restore_busted_player_to_seat_v3','floor_restore_busted_player_to_seat_v4'] LOOP
  BEGIN
   PERFORM set_config('role','authenticated',true);
   EXECUTE format('SELECT public.%I($1,$2,$3,$4,$5,$6)',wrapper) INTO result
    USING v_entry,target.id,target.seat,target.revision,target.control_epoch,gen_random_uuid();
   ASSERT result=jsonb_build_object('ok',false,'error','restore_result_dependency'),result::text;
   outcomes:=outcomes||jsonb_build_array(jsonb_build_object('rpc',wrapper,'result',result));
  EXCEPTION WHEN OTHERS THEN
   IF SQLERRM<>'individual_result_immutable' THEN RAISE; END IF;
   outcomes:=outcomes||jsonb_build_array(jsonb_build_object('rpc',wrapper,'error',SQLERRM));
  END;
  PERFORM set_config('role','none',true);
 END LOOP;
 PERFORM set_config('test.early1206',jsonb_build_object('entry',v_entry,'tour',tour_id,'targetTable',target.id,'targetSeat',target.seat,'outcomes',outcomes,'paidVnd',100000)::text,true);
END $$;
SELECT current_setting('test.early1206');
ROLLBACK;`;
writeFileSync(output.replace('.json','.sql'),probe);
let result;
try{result=JSON.parse(sql(probe));}
finally{const after=fingerprint();writeFileSync(output,JSON.stringify({guard,before,after,unchanged:before===after,result,groups:tables.length,rollback:true,newActorsOrGrants:false},null,2));assert.equal(after,before);}
assert.equal(result.outcomes.length,2);
console.log('EARLYITM1206_EXISTING_PAID_ENTRY_RESTORE_DENIED_ROLLBACK_UNCHANGED');
