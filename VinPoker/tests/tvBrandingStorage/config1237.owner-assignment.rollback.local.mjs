import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
assert.equal(process.env.VINPOKER_TV1237_LOCAL,'1');
const output='D:/Quy trình/output/reports/tv1237-owner-assignment-native-local-20261028.json';assert.equal(existsSync(output),false);
const guard=`DO $$ BEGIN ASSERT current_database()='vinpoker_ranking860_local' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';ASSERT (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948';ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));ASSERT (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.save_tv_display_config_v1(uuid,uuid,text,text,text,text)'::regprocedure)='bf18eb8bb0c7d5a668351e4f26649ce5';END $$;`;
const sql=q=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',timeout:20000,maxBuffer:3e6,stdio:['pipe','pipe','pipe']}).trim();
const ops=['tournaments','tournament_entries','tournament_seats','chip_bag','tournament_hands','cashier_buyin_movements','tournament_prize_payments'];
const expr=tables=>'md5(jsonb_build_array('+tables.map(t=>'(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.'+t+' x)').join(',')+')::text)';
const fingerprint=()=>JSON.parse(sql('BEGIN READ ONLY;'+guard+'SELECT to_jsonb('+expr(['tv_displays',...ops])+');ROLLBACK;'));
const before=fingerprint(),state={kind:'EXISTING_ACTOR_PUBLIC_CONFIG_RPC_TO_ANON_PROJECTION_ALL_ROLLBACK_NOT_BROWSER_OR_MANAGED_AUTH',before,actor:'675fe35e-60a8-4452-bb90-e79486d54da6',display:'ca1f1e29-0d57-4e59-b7e5-309f7928f3da',sourceHash:createHash('sha256').update(readFileSync('supabase/migrations/20270128000002_tv_display_config_guarded_rpc_v1.sql')).digest('hex')};
try{
 const rows=sql('BEGIN;'+guard+`SET LOCAL statement_timeout='10s';SELECT set_config('test.tv1237.ops_before',`+expr(ops)+`,true);SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';SET LOCAL request.jwt.claims='{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}';SET LOCAL ROLE authenticated;
 DO $$ DECLARE original public.tv_displays%ROWTYPE; reply jsonb; standby jsonb; restored jsonb; BEGIN
 SELECT * INTO STRICT original FROM public.tv_displays WHERE id='ca1f1e29-0d57-4e59-b7e5-309f7928f3da';
 ASSERT original.club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760'::uuid AND original.status='paired' AND original.assigned_tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580'::uuid;
 reply:=public.save_tv_display_config_v1(original.id,NULL,original.layout,original.announcement,original.name,original.zone);
 ASSERT reply->>'id'=original.id::text AND reply->>'assigned_tournament_id' IS NULL;
 PERFORM set_config('role','anon',true);standby:=public.get_tv_display_state_v4(original.display_token,true);
 ASSERT standby->>'status'='paired' AND standby->'tournament'='null'::jsonb AND NOT standby?'clock';
 PERFORM set_config('role','authenticated',true);
 reply:=public.save_tv_display_config_v1(original.id,original.assigned_tournament_id,original.layout,original.announcement,original.name,original.zone);
 ASSERT reply->>'assigned_tournament_id'=original.assigned_tournament_id::text;
 PERFORM set_config('role','anon',true);restored:=public.get_tv_display_state_v4(original.display_token,true);
 ASSERT restored->>'status'='paired' AND restored->'tournament'->>'id'=original.assigned_tournament_id::text;
 ASSERT (restored->'participation_counts'->>'total_entries')::integer=15 AND (restored->'participation_counts'->>'live_entry_stack')::numeric=300000;
 PERFORM set_config('test.tv1237.observation',jsonb_build_object('publicWriterCalls',2,'standbyTournament',standby->'tournament','restoredTournament',restored->'tournament'->>'id','restoredCounts',restored->'participation_counts','layoutRetained',reply->>'layout'=original.layout)::text,true);
 END $$;RESET ROLE;
 SELECT jsonb_build_object('observation',current_setting('test.tv1237.observation')::jsonb,'opsUnchanged',current_setting('test.tv1237.ops_before')=`+expr(ops)+`);ROLLBACK;`);
 state.observation=JSON.parse(rows.split(/\r?\n/).find(line=>line.startsWith('{')));assert.equal(state.observation.opsUnchanged,true);state.qualified=true;
}catch(error){state.failure=String(error.stderr??error);throw error;}
finally{state.after=fingerprint();state.unchanged=before===state.after;writeFileSync(output,JSON.stringify(state,null,2));assert.equal(state.unchanged,true);console.log('TV1237_PUBLIC_CONFIG_ROLLBACK_UNCHANGED');}
