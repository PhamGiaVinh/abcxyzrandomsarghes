import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
for(const [k,v] of Object.entries({PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:'vinpoker_ops_checkin'})) assert.equal(process.env[k],v);
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS']) assert.equal(process.env[key],undefined);
const sql=`DO $$ BEGIN IF current_database()<>'vinpoker_ops_checkin' OR current_user<>'postgres'
 OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port()<>55441
 OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 THEN RAISE EXCEPTION 'Owned PG17 only'; END IF; END $$;
BEGIN;
INSERT INTO auth.users(id) VALUES('ee890000-0000-4000-8000-000000000001'),('ee890000-0000-4000-8000-000000000098');
INSERT INTO public.clubs(id,owner_id,name,region) VALUES('ee890000-0000-4000-8000-000000000002','ee890000-0000-4000-8000-000000000001','Clock readiness TEST','TEST');
INSERT INTO public.tournaments(id,club_id,name,live_status,current_level)
 VALUES('ee890000-0000-4000-8000-000000000003','ee890000-0000-4000-8000-000000000002','Clock readiness TEST','registering',1);
SELECT set_config('request.jwt.claim.sub','ee890000-0000-4000-8000-000000000001',true);
DO $$ DECLARE r jsonb; BEGIN
 r:=public.floor_start_tournament_clock('ee890000-0000-4000-8000-000000000003');
 IF r->>'error' IS DISTINCT FROM 'invalid_tournament_level' THEN RAISE EXCEPTION 'orphan_level_started: %',r; END IF;
 IF EXISTS(SELECT FROM public.tournaments WHERE id='ee890000-0000-4000-8000-000000000003' AND clock_started_at IS NOT NULL)
 THEN RAISE EXCEPTION 'rejected_clock_changed'; END IF;
END $$;
UPDATE public.tournaments SET current_level=NULL WHERE id='ee890000-0000-4000-8000-000000000003';
DO $$ DECLARE r jsonb; BEGIN
 r:=public.floor_start_tournament_clock('ee890000-0000-4000-8000-000000000003');
 IF r->>'error' IS DISTINCT FROM 'no_tournament_level' THEN RAISE EXCEPTION 'empty_structure_not_denied: %',r; END IF;
END $$;
INSERT INTO public.tournament_levels(tournament_id,level_number,small_blind,big_blind,ante,duration_minutes)
 VALUES('ee890000-0000-4000-8000-000000000003',1,100,200,0,20);
SELECT set_config('request.jwt.claim.sub','ee890000-0000-4000-8000-000000000098',true);
DO $$ DECLARE r jsonb; BEGIN
 r:=public.floor_start_tournament_clock('ee890000-0000-4000-8000-000000000003');
 IF r->>'error' IS DISTINCT FROM 'actor_not_allowed' THEN RAISE EXCEPTION 'outsider_clock_allowed: %',r; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','ee890000-0000-4000-8000-000000000001',true);
DO $$ DECLARE r jsonb; audit_before bigint; BEGIN
 SELECT count(*) INTO audit_before FROM public.audit_logs WHERE entity_id='ee890000-0000-4000-8000-000000000003';
 r:=public.floor_start_tournament_clock('ee890000-0000-4000-8000-000000000003');
 IF r->>'outcome' IS DISTINCT FROM 'clock_started' OR (r->>'current_level')::int<>1 THEN
   RAISE EXCEPTION 'valid_level_did_not_start: %',r; END IF;
 IF (SELECT count(*) FROM public.audit_logs WHERE entity_id='ee890000-0000-4000-8000-000000000003')<>audit_before+1
 THEN RAISE EXCEPTION 'clock_audit_not_atomic'; END IF;
 r:=public.floor_start_tournament_clock('ee890000-0000-4000-8000-000000000003');
 IF r->>'error' IS DISTINCT FROM 'clock_already_started' THEN RAISE EXCEPTION 'repeat_clock_started: %',r; END IF;
 IF (SELECT count(*) FROM public.audit_logs WHERE entity_id='ee890000-0000-4000-8000-000000000003')<>audit_before+1
 THEN RAISE EXCEPTION 'duplicate_clock_audit'; END IF;
END $$;
ROLLBACK;`;
const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'});
assert.equal(r.status,0,r.stderr);
console.log('Clock stale/empty level rejection, outsider denial, valid first-level start and single audit PASS');
