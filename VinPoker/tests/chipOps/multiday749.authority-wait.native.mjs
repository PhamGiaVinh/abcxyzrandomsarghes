import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
assert.equal(process.env.VINPOKER_MULTIDAY749_NATIVE,'1');
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('wsl',args,{input:q,encoding:'utf8',timeout:20000,maxBuffer:2e6}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink');"),'0');
assert.equal(sql("SELECT md5(pg_get_functiondef('public.multi_day_record_bag_v1(uuid,uuid,text,bigint,integer,uuid)'::regprocedure));"),'5938545dae6c953a7cabe3b090f0b9b2');
assert.equal(sql("SELECT to_regclass('floor_private.multiday749_authority_wait_v1') IS NULL;"),'t','baseline probe consumed; never delete/reset its evidence');
const flight='a0736301-cbd6-41bf-b5ce-2bcb1610a1b7',club='2d6ff316-9ca6-4aa5-8c6e-7bc9982f4abd',player='51475c20-f444-4daf-9eb0-026d531d6b93';
assert.equal(sql(`SELECT count(*) FROM public.multi_day_flight_ends_v1 f JOIN public.day_close d ON d.tournament_id=f.flight_tournament_id AND d.day_number=f.day_number
 WHERE f.flight_tournament_id='${flight}' AND f.club_id='${club}' AND f.day_number=1 AND f.status='bagging' AND f.roster_count=1 AND d.status='open';`),'1');
assert.equal(sql(`SELECT count(*) FROM public.multi_day_flight_roster_v1 WHERE flight_tournament_id='${flight}' AND player_id='${player}' AND tracked_stack=20000;`),'1');
assert.equal(sql(`SELECT count(*) FROM public.chip_bag WHERE tournament_id='${flight}';`),'0');
assert.equal(sql(`SELECT coalesce((SELECT auto_swing_enabled FROM public.club_settings WHERE club_id='${club}'),false);`),'f');
const quote=v=>`'${String(v).replaceAll("'","''")}'`;
const gate=JSON.parse(sql('SELECT to_jsonb(g) FROM public.multi_day_package_release_v1 g WHERE id;'));
const proof=()=>sql(`BEGIN READ ONLY;SELECT md5(jsonb_build_array(${['chip_bag','day_close','multi_day_bag_requests_v1','cashier_buyin_movements','tournament_entries','tournament_seats','tournament_prize_payments','multi_day_package_release_v1'].map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text);ROLLBACK;`);
const before=proof(),actor=randomUUID(),request=randomUUID();
const session=name=>{
 const child=spawn('wsl',args,{stdio:['pipe','pipe','pipe']});let out='',err='';
 child.stdout.on('data',v=>{out+=v;});child.stderr.on('data',v=>{err+=v;});
 const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve(out):reject(Error(err||`exit${code}`)));});void done.catch(()=>{});
 return {child,done,out:()=>out,name};
};
const until=async check=>{const end=Date.now()+10000;while(!check()){assert.ok(Date.now()<end,'actual bag/day blocker not observed');await new Promise(r=>setTimeout(r,30));}};
let holder,writer,result,observed=false;
try{
 sql(`BEGIN;INSERT INTO auth.users(id) VALUES('${actor}');INSERT INTO public.club_chip_masters(club_id,user_id) VALUES('${club}','${actor}');
 UPDATE public.multi_day_package_release_v1 SET enabled=true,allowed_club_ids=ARRAY(SELECT DISTINCT id FROM unnest(coalesce(allowed_club_ids,'{}'::uuid[])||ARRAY['${club}'::uuid])id) WHERE id;
 DO $$ BEGIN ASSERT public.is_club_chip_master('${actor}','${club}') AND NOT public.is_club_owner('${actor}','${club}');END $$;COMMIT;`);
 holder=session('multiday749-day-holder');writer=session('multiday749-revoked-writer');
 holder.child.stdin.write(`SET application_name='${holder.name}';BEGIN;SET LOCAL statement_timeout='15s';SELECT tournament_id FROM public.day_close WHERE tournament_id='${flight}' AND day_number=1 FOR UPDATE;SELECT 'MULTIDAY749_DAY_HELD';\n`);
 await until(()=>holder.out().includes('MULTIDAY749_DAY_HELD'));
 writer.child.stdin.end(`SET application_name='${writer.name}';BEGIN;SET LOCAL statement_timeout='15s';SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;
 SELECT public.multi_day_record_bag_v1('${flight}','${player}','LOCAL749-AUTH-WAIT',20000,0,'${request}');
 RESET ROLE;SELECT jsonb_build_object('bagSeen',EXISTS(SELECT 1 FROM public.chip_bag WHERE tournament_id='${flight}' AND created_by='${actor}'),
 'requestSeen',EXISTS(SELECT 1 FROM public.multi_day_bag_requests_v1 WHERE request_id='${request}'));ROLLBACK;\n`);
 await until(()=>sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity w JOIN pg_stat_activity h ON h.pid=ANY(pg_blocking_pids(w.pid)) WHERE w.application_name='${writer.name}' AND h.application_name='${holder.name}' AND w.wait_event_type='Lock');`)==='t');
 observed=true;
 holder.child.stdin.end(`DELETE FROM public.club_chip_masters WHERE club_id='${club}' AND user_id='${actor}';COMMIT;\n`);
 await holder.done;
 assert.equal(sql(`SELECT public.is_club_chip_master('${actor}','${club}');`),'f');
 result=await writer.done.then(out=>({rows:out.split(/\r?\n/).filter(v=>v.startsWith('{')).map(v=>JSON.parse(v))}),error=>({error:String(error.message)}));
 console.log('MULTIDAY749_ACTUAL_DAY_WAIT_REVOKED_ROLE_RESULT',JSON.stringify(result));
}finally{
 for(const s of [holder,writer])if(s&&!s.child.stdin.writableEnded)s.child.stdin.end('ROLLBACK;\n');
 await Promise.allSettled([holder?.done,writer?.done]);
 sql(`BEGIN;DELETE FROM public.club_chip_masters WHERE club_id='${club}' AND user_id='${actor}';
 UPDATE public.multi_day_package_release_v1 SET enabled=${gate.enabled},allowed_club_ids=ARRAY[${gate.allowed_club_ids.map(v=>quote(v)+'::uuid').join(',')}]::uuid[],updated_at=${quote(gate.updated_at)}::timestamptz WHERE id;COMMIT;`);
 assert.equal(proof(),before,'bag/day/receipt/money/entry/seat/payout/global gate changed; never reset to make this pass');
 assert.equal(sql(`SELECT count(*) FROM public.chip_bag WHERE tournament_id='${flight}';`),'0');
 if(observed&&result){
  sql(`CREATE TABLE floor_private.multiday749_authority_wait_v1 AS SELECT ${quote(JSON.stringify({test_only:true,flight,club,player,actor,request,observed,result,writerTransaction:'ROLLBACK',authorityRevoked:true}))}::jsonb AS fixture;
   ALTER TABLE floor_private.multiday749_authority_wait_v1 ENABLE ROW LEVEL SECURITY;REVOKE ALL ON floor_private.multiday749_authority_wait_v1 FROM PUBLIC,anon,authenticated,service_role;`);
 }
 console.log('MULTIDAY749_ORIGINAL_BAGS_DAY_RECEIPTS_FINANCIALS_GATES_UNCHANGED_ROLE_REVOKED');
}
assert.ok(result?.error?.includes('multi_day_bag_actor_not_allowed'),'MULTIDAY749_REVOKED_OPERATOR_WROTE_AFTER_WAIT');
