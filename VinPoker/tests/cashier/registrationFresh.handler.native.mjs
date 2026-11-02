import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createPaidJourneyFixture} from './paidJourney.fixture.mjs';
import {runRegisterBrowserEdge} from './registerBrowserEdge.local.mjs';

assert.equal(process.env.VINPOKER_NATIVE_BROWSER,'1');
assert.equal(process.env.VINPOKER_NATIVE_FRESH_REGISTRATION,'1');
const prefix=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c'];
const sql=input=>execFileSync('wsl',[...prefix,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:30000,maxBuffer:2e6}).trim();
assert.equal(sql("SELECT current_setting('data_directory');"),'/tmp/vinpoker-sol-local-20261016-0e79a729/data');
assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');"),'f');
const f=createPaidJourneyFixture(sql),player=randomUUID(),parallelPlayer=randomUUID(),faultPlayer=randomUUID();
// Independent negative/integrity fixture, NOT the retained browser tour. Inputs
// are explicit TEST pricing; original paid seed's frozen receipt is unchanged.
sql(`INSERT INTO auth.users(id) VALUES('${player}'),('${parallelPlayer}'),('${faultPlayer}');
 INSERT INTO public.club_settings(club_id,auto_swing_enabled) VALUES('${f.club}',false)
 ON CONFLICT(club_id) DO UPDATE SET auto_swing_enabled=false;
 UPDATE public.tournaments SET rake_amount=10000,service_fee_amount=5000,
 free_rake_enabled=true,free_rake_slots=2,free_rake_used=0 WHERE id='${f.tour}';
 INSERT INTO public.club_payment_config(club_id,master_account_number,api_token_vault_key,is_active)
 VALUES('${f.club}','TEST-${f.club}','LOCAL_TEST_NO_SECRET',true);
 INSERT INTO public.platform_bank_accounts(club_id,bank_name,account_number,account_holder,notes)
 VALUES('${f.club}','LOCAL TEST','TEST-${f.club}','LOCAL TEST ONLY','Synthetic non-payable account; no provider calls');`);
const money=()=>sql(`SELECT md5(jsonb_build_object('cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m WHERE tournament_id='${f.tour}'),
 'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='${f.tour}'),
 'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id='${f.tour}'))::text);`);
const beforeMoney=money(),log=[];
try{
 const invoke=()=>runRegisterBrowserEdge({body:{tournament_id:f.tour},fixture:f,user:{id:player},sql,log});
 const first=await invoke();assert.equal(first.status,200);const created=await first.json();
 assert.equal(created.already_registered,false);assert.equal(created.total_pay,105000);assert.equal(created.free_rake_applied,true);
 const second=await invoke();assert.equal(second.status,200);const replay=await second.json();
 assert.equal(replay.already_registered,true);assert.equal(replay.registration_id,created.registration_id);assert.equal(replay.total_pay,105000);
 assert.equal(log.filter(row=>row.edgeNotification).length,1);
 assert.equal(sql(`SELECT count(*) FROM public.tournament_registrations WHERE tournament_id='${f.tour}' AND player_id='${player}';`),'1');
 assert.equal(sql(`SELECT free_rake_used FROM public.tournaments WHERE id='${f.tour}';`),'1');
 assert.equal(sql(`SELECT count(*) FROM public.notifications WHERE user_id='${player}' AND type='registration_confirmed';`),'1');
 const service=`SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL ROLE service_role;`;
 const appA='registration-'+randomUUID(),appB='registration-'+randomUUID();
 const session=name=>{
  const child=spawn('wsl',[...prefix,`PGAPPNAME=${name}`,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe'],timeout:30000});
  let output='',errors='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>errors+=v);
  const closed=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve(output):reject(new Error(errors)));});
  void closed.catch(()=>{});return {child,closed,output:()=>output};
 };
 const until=async predicate=>{const deadline=Date.now()+10000;while(!predicate()){assert.ok(Date.now()<deadline,'registration overlap barrier timeout');await new Promise(resolve=>setTimeout(resolve,25));}};
 const a=session(appA),b=session(appB);
 try{
  a.child.stdin.write(`BEGIN;${service}SELECT public.cashier_create_app_registration_v1('${f.tour}','${parallelPlayer}');\n`);
  await until(()=>a.output().includes('registration_id'));
  b.child.stdin.end(`BEGIN;${service}SELECT public.cashier_create_app_registration_v1('${f.tour}','${parallelPlayer}');COMMIT;\n`);
  await until(()=>sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${appB}' AND wait_event_type='Lock');`)==='t');
  a.child.stdin.end('COMMIT;\n');
  const [rawA,rawB]=await Promise.all([a.closed,b.closed]);
  const ra=JSON.parse(rawA),rb=JSON.parse(rawB);
  assert.equal(ra.already_registered,false);assert.equal(rb.already_registered,true);assert.equal(ra.registration_id,rb.registration_id);
  assert.equal(ra.total_pay,105000);assert.equal(rb.total_pay,105000);
 }finally{if(a.child.exitCode===null)a.child.stdin.end('ROLLBACK;\n');if(b.child.exitCode===null)b.child.stdin.end('ROLLBACK;\n');}
 assert.equal(sql(`SELECT free_rake_used FROM public.tournaments WHERE id='${f.tour}';`),'2');
 assert.equal(sql(`SELECT count(*) FROM public.tournament_registrations WHERE tournament_id='${f.tour}' AND player_id='${parallelPlayer}';`),'1');
 sql(`BEGIN;
 UPDATE public.tournaments SET free_rake_slots=3 WHERE id='${f.tour}';
 CREATE FUNCTION pg_temp.reject_registration_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST_REGISTRATION_INSERT_FAILURE';END $$;
 CREATE TRIGGER native_registration_insert_fault BEFORE INSERT ON public.tournament_registrations
 FOR EACH ROW WHEN(NEW.player_id='${faultPlayer}'::uuid) EXECUTE FUNCTION pg_temp.reject_registration_test();
 DO $$ BEGIN
  BEGIN PERFORM public.cashier_create_app_registration_v1('${f.tour}','${faultPlayer}');RAISE EXCEPTION 'EXPECTED_REGISTRATION_FAULT';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'TEST_REGISTRATION_INSERT_FAILURE' THEN RAISE;END IF;END;
  IF (SELECT free_rake_used FROM public.tournaments WHERE id='${f.tour}')<>2
  OR EXISTS(SELECT 1 FROM public.tournament_registrations WHERE player_id='${faultPlayer}' AND tournament_id='${f.tour}')
  THEN RAISE EXCEPTION 'REGISTRATION_FAULT_LEAKED_STATE';END IF;
 END $$;ROLLBACK;`);
 assert.equal(sql(`SELECT free_rake_slots FROM public.tournaments WHERE id='${f.tour}';`),'2');
 console.log('NATIVE_NEW_REGISTRATION_HANDLER_FROZEN_PRICE_NOTICE_ONCE_TRUE_OVERLAP_INSERT_ROLLBACK_PASS',JSON.stringify({tour:f.tour,club:f.club,player,registration:created.registration_id,parallelPlayer,faultPlayer,totalPay:105000,freeRakeUsed:2}));
}finally{assert.equal(money(),beforeMoney,'pending registration must not create payment/entry/seating');}
