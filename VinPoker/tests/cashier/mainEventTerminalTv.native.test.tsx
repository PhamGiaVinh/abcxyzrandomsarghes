import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {mapDisplayStateToTvData,type TvDisplayStatePayload} from '@/lib/tv/mapDisplayState';
import {mapTvDataToClock} from '@/lib/tv/mapClockData';

// Retained primary journey, not a synthetic replacement. Reads use actual anon
// SQL authority; display metadata/heartbeat writes are rolled back. No payment.
const sql=(input:string)=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env',
 'PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c',
 'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:30000}).trim();
const event='dbb49f8d-7d47-4c2c-afd9-f57062c9971d';
const final='4cd3af4d-7e1d-4042-855f-04fb6777e580';
const fingerprint=()=>sql(`SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(f) ORDER BY event_id) FROM public.multi_day_payout_finalizations_v1 f),
 (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.tournament_prize_payments p),
 (SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM public.tv_displays d),
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournaments t WHERE event_id='${event}'),
 (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m)
 )::text);`);
const candidateSql=()=>process.env.VINPOKER_NATIVE_TERMINAL_TV_CANDIDATE==='219'
 ?readFileSync('supabase/migrations/20270128000219_multiday_final_tv_funded_pool_v1.sql','utf8')
  .replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,''):'';

it.skipIf(process.env.VINPOKER_NATIVE_MAIN_EVENT_TERMINAL_TV !== '1')('finalized Main Event anonymous TV uses funded event pool, not Final zero or a client GTD estimate',()=>{
 assert.equal(process.env.VINPOKER_NATIVE_MAIN_EVENT_TERMINAL_TV,'1');
 assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),
  'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
 assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));"),'f');
 const expected=JSON.parse(sql(`SELECT jsonb_build_object('pool',direct_pool_vnd+recorded_overlay_vnd,
  'owed',unpaid_obligation_vnd+paid_player_vnd,'paid',paid_player_vnd,'recipients',jsonb_array_length(obligations))
  FROM public.multi_day_payout_finalizations_v1 WHERE event_id='${event}' AND final_tournament_id='${final}'
   AND request_id='264bdd6e-33a7-4d7b-837a-e3a6b60a16a6';`));
 assert.deepEqual(expected,{pool:2500000,owed:2500000,paid:0,recipients:15});
 const before=fingerprint();
 const oldBody=sql("SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.get_tv_display_state_v4(text,boolean)'::regprocedure;");
 const candidate=process.env.VINPOKER_NATIVE_TERMINAL_TV_CANDIDATE==='219';
 const forward=candidateSql();
 const recovery=candidate?readFileSync('tests/cashier/mainEventTerminalTv.recovery.pg17.sql','utf8'):'';
 const token='LOCAL-TERMINAL-TV-ROLLBACK-'+randomUUID();
 let payload:TvDisplayStatePayload;
 try{
  payload=JSON.parse(sql(`BEGIN;SET LOCAL statement_timeout='10s';${forward}
   INSERT INTO public.tv_displays(id,club_id,display_token,assigned_tournament_id,status,name)
   SELECT gen_random_uuid(),club_id,'${token}',id,'paired','Terminal216 rollback-only TEST'
   FROM public.tournaments WHERE id='${final}';
   SET LOCAL request.jwt.claim.role='anon';SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;
   SELECT public.get_tv_display_state_v4('${token}',false);
   RESET ROLE;${recovery}ROLLBACK;`));
 }finally{
  assert.equal(fingerprint(),before,'anonymous probe must preserve all financial and display facts');
  assert.equal(sql("SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.get_tv_display_state_v4(text,boolean)'::regprocedure;"),oldBody);
 }
 assert.equal(payload.status,'paired');assert.equal(payload.tournament?.id,final);
 assert.equal(payload.main_event?.guarantee_amount,2500000);
 const data=mapDisplayStateToTvData(payload,0)!;
 // This assertion is intentionally RED until the canonical public projection
 // supplies the exact event funding. Never substitute GTD/sum(rank awards).
 expect(data.prizePool).toBe(expected.pool);
 expect(mapTvDataToClock(data).prizePool).toBe('2.500.000');
 expect(data.status).toBe('finished');
 expect(data.isRunning).toBe(false);
 expect(data.nextBreakSeconds).toBeNull();
 expect(mapTvDataToClock(data).terminalStatus).toBe('finished');
},30000);

it.skipIf(process.env.VINPOKER_NATIVE_MAIN_EVENT_TERMINAL_TV !== '1')('keeps flight pools isolated and denies invalid, revoked and mismatched display capabilities',()=>{
 assert.equal(process.env.VINPOKER_NATIVE_MAIN_EVENT_TERMINAL_TV,'1');
 assert.equal(sql('SELECT current_database();'),'vinpoker_ops_cash115_qualified_c');
 const before=fingerprint();
 try{
  sql(`BEGIN;SET LOCAL statement_timeout='10s';${candidateSql()}
   DO $test$ DECLARE token text; p jsonb; t public.tournaments; flag boolean; other uuid; BEGIN
    ASSERT has_function_privilege('anon','public.get_tv_display_state_v4(text,boolean)','EXECUTE');
    ASSERT has_function_privilege('authenticated','public.get_tv_display_state_v4(text,boolean)','EXECUTE');
    ASSERT NOT has_function_privilege('service_role','public.get_tv_display_state_v4(text,boolean)','EXECUTE');
    FOR t IN SELECT * FROM public.tournaments WHERE event_id='${event}' AND flight_label IN('A','B') LOOP
     token:='TERMINAL219-FLIGHT-ROLLBACK-'||gen_random_uuid();
     INSERT INTO public.tv_displays(id,club_id,display_token,assigned_tournament_id,status)
      VALUES(gen_random_uuid(),t.club_id,token,t.id,'paired');
     FOREACH flag IN ARRAY ARRAY[false,true] LOOP
      PERFORM set_config('role','anon',true);
      p:=public.get_tv_display_state_v4(token,flag);
      PERFORM set_config('role','none',true);
      ASSERT p->>'status'='paired' AND p->'tournament'->>'id'=t.id::text;
      ASSERT (p->'tournament'->>'prize_pool')::numeric IS NOT DISTINCT FROM t.prize_pool,
       'Final event funding must never overwrite a flight pool';
      ASSERT p->'main_event'->>'id'='${event}';
      ASSERT NOT p ?| ARRAY['obligations','bank','bank_transactions','funding_revision','source_snapshot','receipt'];
     END LOOP;
    END LOOP;
    token:='TERMINAL219-FINAL-ROLLBACK-'||gen_random_uuid();
    INSERT INTO public.tv_displays(id,club_id,display_token,assigned_tournament_id,status)
     SELECT gen_random_uuid(),club_id,token,id,'paired' FROM public.tournaments WHERE id='${final}';
    PERFORM set_config('role','anon',true);
    p:=public.get_tv_display_state_v4(token,true);
    PERFORM set_config('role','none',true);
    ASSERT p->>'status'='paired' AND p->'tournament'->>'id'='${final}';
    ASSERT NOT p ?| ARRAY['obligations','bank','bank_transactions','funding_revision','source_snapshot','receipt'];
    UPDATE public.tv_displays SET status='revoked' WHERE display_token=token;
    PERFORM set_config('role','anon',true);
    p:=public.get_tv_display_state_v4(token,false);
    PERFORM set_config('role','none',true);
    ASSERT p->>'status'='revoked' AND NOT p ? 'tournament' AND NOT p ? 'main_event';
    SELECT id INTO STRICT other FROM public.clubs WHERE id<>(SELECT club_id FROM public.tournaments WHERE id='${final}') ORDER BY id LIMIT 1;
    UPDATE public.tv_displays SET status='paired',club_id=other WHERE display_token=token;
    PERFORM set_config('role','anon',true);
    p:=public.get_tv_display_state_v4(token,false);
    ASSERT p=jsonb_build_object('status','invalid');
    p:=public.get_tv_display_state_v4('invalid',true);
    ASSERT p=jsonb_build_object('status','invalid');
    PERFORM set_config('role','none',true);
   END $test$;ROLLBACK;`);
 }finally{assert.equal(fingerprint(),before);}
},30000);
