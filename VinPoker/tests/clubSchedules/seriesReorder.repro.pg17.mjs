import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
// Diagnostic only: PASS means the old independent-write defect was reproduced.
// Caller creates this fresh owned clone; never accepts a target from environment.
const database='vinpoker_ops_series_reorder';
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.equal(process.env[key],undefined);
const command=process.platform==='win32'?'wsl':'psql';
const args=['-X','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55441','-U','postgres','-d',database];
const prefix=process.platform==='win32'?['-d','PokerVision-P16-4C-Eval','--','psql']:[];
const guard=`DO $$ BEGIN IF current_database()<>'${database}' OR current_user<>'postgres' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port()<>55441 OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 THEN RAISE EXCEPTION 'owned_series_reorder_pg17_only'; END IF; END $$;`;
function query(sql,error){
 const result=spawnSync(command,[...prefix,...args],{input:guard+'\n'+sql,encoding:'utf8',timeout:30000});
 if(error){assert.notEqual(result.status,0);assert.ok(result.stderr.includes(error),result.stderr);}
 else assert.equal(result.status,0,result.stderr);
 return result.stdout.trim();
}
const actor='ee920000-0000-4000-8000-000000000001',club='ee920000-0000-4000-8000-000000000002';
const first='ee920000-0000-4000-8000-000000000003',second='ee920000-0000-4000-8000-000000000004';
query(`BEGIN;
 INSERT INTO auth.users(id) VALUES('${actor}');
 INSERT INTO public.clubs(id,owner_id,name,region) VALUES('${club}','${actor}','Series reorder TEST','TEST');
 INSERT INTO public.club_series_images(id,club_id,image_url,position) VALUES('${first}','${club}','https://example.test/a.jpg',0),('${second}','${club}','https://example.test/b.jpg',1);
 CREATE FUNCTION public.series_reorder_fixture_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${first}' THEN RAISE EXCEPTION 'injected_second_reorder_request_failure'; END IF; RETURN NEW; END $$;
 CREATE TRIGGER series_reorder_fixture_fail BEFORE UPDATE ON public.club_series_images FOR EACH ROW EXECUTE FUNCTION public.series_reorder_fixture_fail();
 COMMIT;`);
const actorContext=`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${actor}',false);`;
// Separate transactions/connections match two successful/failed PostgREST calls.
query(`BEGIN;${actorContext} UPDATE public.club_series_images SET position=0 WHERE id='${second}'; COMMIT;`);
query(`BEGIN;${actorContext} UPDATE public.club_series_images SET position=1 WHERE id='${first}'; COMMIT;`,'injected_second_reorder_request_failure');
assert.deepEqual(JSON.parse(query(`SELECT json_agg(json_build_array(id,position) ORDER BY id) FROM public.club_series_images WHERE club_id='${club}';`)),[[first,0],[second,0]]);
console.log('BASELINE_SERIES_REORDER_PARTIAL_COMMIT_REPRODUCED_NOT_FIXED');
// Keep synthetic rows/fault trigger in the owned clone for inspection; never rerun as fresh.
