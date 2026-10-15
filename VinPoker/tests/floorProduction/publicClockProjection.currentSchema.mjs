import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
for(const [k,v] of Object.entries({PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:'vinpoker_public_clock90'})) assert.equal(process.env[k],v);
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS']) assert.equal(process.env[key],undefined);
const sql=`DO $$ BEGIN IF current_database()<>'vinpoker_public_clock90' OR current_user<>'postgres'
 OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port()<>55441
 OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 THEN RAISE EXCEPTION 'Owned PG17 clock90 only'; END IF; END $$;
BEGIN;
CREATE FUNCTION pg_temp.check_it(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'public_clock90_failed: %',message; END IF; END $$;
INSERT INTO auth.users(id) VALUES('ee900000-0000-4000-8000-000000000001');
INSERT INTO public.clubs(id,owner_id,name,region) VALUES('ee900000-0000-4000-8000-000000000002','ee900000-0000-4000-8000-000000000001','Public clock TEST','TEST');
INSERT INTO public.tournaments(id,club_id,name,status,live_status,current_level,clock_started_at) VALUES
 ('ee900000-0000-4000-8000-000000000003','ee900000-0000-4000-8000-000000000002','Flight A TEST','live','playing',1,statement_timestamp()-interval '5 minutes'),
 ('ee900000-0000-4000-8000-000000000004','ee900000-0000-4000-8000-000000000002','Flight B TEST','live','playing',2,statement_timestamp()-interval '2 minutes');
INSERT INTO public.tournament_levels(tournament_id,level_number,small_blind,big_blind,ante,duration_minutes) VALUES
 ('ee900000-0000-4000-8000-000000000003',1,100,200,200,20),
 ('ee900000-0000-4000-8000-000000000003',2,200,400,400,20),
 ('ee900000-0000-4000-8000-000000000004',2,500,1000,1000,30);
INSERT INTO public.tournament_entries(tournament_id,player_id,entry_no,current_stack,status) VALUES
 ('ee900000-0000-4000-8000-000000000003','ee900000-0000-4000-8000-000000000001',1,20000,'registered'),
 ('ee900000-0000-4000-8000-000000000003','ee900000-0000-4000-8000-000000000001',2,0,'busted'),
 ('ee900000-0000-4000-8000-000000000004','ee900000-0000-4000-8000-000000000001',1,40000,'registered');
SELECT pg_temp.check_it(NOT has_function_privilege('anon','floor_private.tournament_participation_v1(uuid)','EXECUTE'),'private helper stays private');
SET LOCAL ROLE anon;
SELECT pg_temp.check_it((SELECT entries=2 AND players_remaining=1 AND average_stack=20000 AND big_blind=200
 AND remaining_seconds BETWEEN 899 AND 900 AND is_running FROM public.get_public_tournament_clock_summary('ee900000-0000-4000-8000-000000000003')),'anonymous canonical counts and running clock');
SELECT pg_temp.check_it((SELECT entries=1 AND average_stack=40000 AND big_blind=1000 FROM public.get_public_tournament_clock_summary('ee900000-0000-4000-8000-000000000004')),'flight isolation');
DO $$ BEGIN
 BEGIN PERFORM * FROM public.get_public_tournament_results('ee900000-0000-4000-8000-000000000003');
  RAISE EXCEPTION 'missing publication treated as verified empty';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'public_payout_pending' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
UPDATE public.tournaments SET current_level=99 WHERE id='ee900000-0000-4000-8000-000000000004';
SET LOCAL ROLE anon;
SELECT pg_temp.check_it((SELECT NOT is_running AND remaining_seconds IS NULL AND level_ends_at IS NULL FROM public.get_public_tournament_clock_summary('ee900000-0000-4000-8000-000000000004')),'missing selected level cannot claim running');
RESET ROLE;
UPDATE public.tournaments SET clock_paused_at=statement_timestamp() WHERE id='ee900000-0000-4000-8000-000000000003';
SET LOCAL ROLE anon;
SELECT pg_temp.check_it((SELECT NOT is_running AND level_ends_at IS NULL AND remaining_seconds BETWEEN 899 AND 900 FROM public.get_public_tournament_clock_summary('ee900000-0000-4000-8000-000000000003')),'paused time frozen, no moving deadline');
RESET ROLE;
-- Consumer fixture of a completed projection publication. This is not worker/lease acceptance.
INSERT INTO spectator_projection_v2.publications(tournament_id,component,source_vector,payload)
SELECT 'ee900000-0000-4000-8000-000000000003','payout',
 coalesce((SELECT jsonb_object_agg(entity_key,source_revision::text) FROM spectator_projection_v2.entity_markers
 WHERE tournament_id='ee900000-0000-4000-8000-000000000003' AND component='payout'),'{}'::jsonb),
 '{"items":[{"fromPlace":1,"toPlace":1,"amountPerPlayer":1000,"playerName":"TEST winner","avatarUrl":null,"resultStatus":"official"}]}'::jsonb;
DELETE FROM spectator_projection_v2.work_groups WHERE tournament_id='ee900000-0000-4000-8000-000000000003' AND component='payout';
SET LOCAL ROLE anon;
SELECT pg_temp.check_it((SELECT place=1 AND prize=1000 AND player_name='TEST winner' AND result_status='official' FROM public.get_public_tournament_results('ee900000-0000-4000-8000-000000000003')),'current public payout projection');
RESET ROLE;
UPDATE spectator_projection_v2.entity_markers SET source_revision=source_revision+1 WHERE tournament_id='ee900000-0000-4000-8000-000000000003' AND component='payout';
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM * FROM public.get_public_tournament_results('ee900000-0000-4000-8000-000000000003');
  RAISE EXCEPTION 'stale official payout exposed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'public_payout_pending' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
UPDATE public.tournaments SET deleted_at=now() WHERE id='ee900000-0000-4000-8000-000000000003';
SET LOCAL ROLE anon;
SELECT pg_temp.check_it((SELECT count(*)=0 FROM public.get_public_tournament_clock_summary('ee900000-0000-4000-8000-000000000003')),'deleted tournament clock revoked');
SELECT pg_temp.check_it((SELECT count(*)=0 FROM public.get_public_tournament_results('ee900000-0000-4000-8000-000000000003')),'deleted tournament results revoked');
RESET ROLE;
ROLLBACK;`;
const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'});
assert.equal(r.status,0,r.stderr);
console.log('Anonymous public clock counts, flight/pause isolation, payout freshness and deletion revocation PASS');
