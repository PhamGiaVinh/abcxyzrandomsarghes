"""Actual observer and source patch, real isolated PostgreSQL, no HTTP/Vault."""
import os,json,pathlib,subprocess
root=pathlib.Path(__file__).resolve().parents[2]
assert os.environ['PGDATABASE'].startswith('vinpoker_swing_observer_test_')
def sql(q,actor=None):
 env=os.environ.copy()
 if actor:env['PGUSER']=actor
 return subprocess.check_output(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],input=q,text=True,env=env).strip()
source=(root/'supabase/migrations/20270104000002_dealer_swing_contract_drift.sql').read_text()
sql('CREATE TABLE public.clubs(id uuid PRIMARY KEY);','postgres')
start=source.index('CREATE TABLE IF NOT EXISTS public.process_swing_dispatch_runs (')
end=source.index('CREATE TABLE IF NOT EXISTS public.process_swing_dispatch_events (',start)
sql(source[start:end],'postgres')
start=source.index('CREATE OR REPLACE FUNCTION public.observe_process_swing_cron(')
end=source.index('TO service_role;',start)+len('TO service_role;')
sql(source[start:end],'postgres')
sql("DO $$DECLARE d text;BEGIN SELECT pg_get_functiondef('public.observe_process_swing_cron(integer)'::regprocedure) INTO d;EXECUTE replace(d,'public.observe_process_swing_cron(','public.observer_window_baseline(');END$$;",'postgres')
metadata="SELECT jsonb_build_object('owner',proowner,'definer',prosecdef,'config',proconfig,'acl',proacl) FROM pg_proc WHERE oid='public.observe_process_swing_cron(integer)'::regprocedure;"
before=sql(metadata)
sql("INSERT INTO net._http_response SELECT n,200,false,now()-interval '1 day',repeat(md5(n::text),90) FROM generate_series(1,100000)n;ANALYZE net._http_response;")
migration=(root/'supabase/migrations/20270128000338_process_swing_observer_indexable_window.sql').read_text()
def rejects(token,actor):
 env=os.environ.copy();env['PGUSER']=actor
 r=subprocess.run(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],input=migration,text=True,env=env,capture_output=True)
 assert r.returncode!=0 and token in r.stderr
wrong_actor_tested=sql('SELECT current_user;')!='postgres'
if wrong_actor_tested:rejects('swing_observer_wrong_actor',os.environ['PGUSER'])
sql("ALTER FUNCTION public.observe_process_swing_cron(integer) SET statement_timeout='2s';",'postgres')
rejects('swing_observer_source_or_boundary_drift','postgres')
sql("ALTER FUNCTION public.observe_process_swing_cron(integer) SET statement_timeout='1s';GRANT EXECUTE ON FUNCTION public.observe_process_swing_cron(integer) TO anon;",'postgres')
rejects('swing_observer_source_or_boundary_drift','postgres')
sql('REVOKE EXECUTE ON FUNCTION public.observe_process_swing_cron(integer) FROM anon;','postgres')
sql(migration,'postgres');assert sql(metadata)==before
# Each fixture runs both actual functions in one transaction; timestamps are
# compared for presence, not byte equality across different wall-clock calls.
cases=[('success','200','false','1 second','1 second',100),('http500','500','false','1 second','1 second',100),
 ('timeout','200','true','1 second','1 second',100),('nullstatus','NULL','false','1 second','1 second',100),
 ('oldresponse','200','false','11 minutes','1 second',100),('oldpending','200','false','1 second','11 minutes',100),
 ('missing','200','false','1 second','1 second',100),('expired','200','false','1 second','3 minutes',100),
 ('limitnull','200','false','1 second','1 second','NULL'),('limitnegative','200','false','1 second','1 second',-5),
 ('limithigh','200','false','1 second','1 second',1000)]
results=[]
for name,status,timed,response_age,request_age,limit in cases:
 q="""BEGIN;
 INSERT INTO public.clubs VALUES('11111111-1111-4111-8111-111111111111');
 INSERT INTO net._http_response VALUES(200001,"""+status+','+timed+",clock_timestamp()-interval '"+response_age+"',NULL);"+"""
 INSERT INTO public.process_swing_dispatch_runs(run_id,request_id,club_id,tick_at,request_fingerprint,net_request_id,requested_at,lease_token,lease_expires_at,business_state)
 VALUES('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',now(),'fixture',"""+('200002' if name=='missing' else '200001')+",clock_timestamp()-interval '"+request_age+"','44444444-4444-4444-8444-444444444444',now()+interval '1 minute','started');"+"""
 CREATE TEMP TABLE initial ON COMMIT DROP AS SELECT * FROM public.process_swing_dispatch_runs;
 CREATE TEMP TABLE comparison(kind text,result jsonb,rows jsonb,elapsed_ms numeric) ON COMMIT DROP;
 DO $$DECLARE t timestamptz;r jsonb;BEGIN
 t:=clock_timestamp();r:=public.observer_window_baseline("""+str(limit)+""");
 INSERT INTO comparison SELECT 'old',r,jsonb_agg(to_jsonb(d)-'updated_at'-'response_observed_at'),extract(epoch FROM(clock_timestamp()-t))*1000 FROM public.process_swing_dispatch_runs d;
 DELETE FROM public.process_swing_dispatch_runs;INSERT INTO public.process_swing_dispatch_runs SELECT * FROM initial;
 t:=clock_timestamp();r:=public.observe_process_swing_cron("""+str(limit)+""");
 INSERT INTO comparison SELECT 'new',r,jsonb_agg(to_jsonb(d)-'updated_at'-'response_observed_at'),extract(epoch FROM(clock_timestamp()-t))*1000 FROM public.process_swing_dispatch_runs d;
 END$$;
 SELECT jsonb_build_object('equal',(SELECT result FROM comparison WHERE kind='old')=(SELECT result FROM comparison WHERE kind='new') AND (SELECT rows FROM comparison WHERE kind='old')=(SELECT rows FROM comparison WHERE kind='new'),
 'businessUnchanged',(SELECT business_state='started' AND lease_token='44444444-4444-4444-8444-444444444444' FROM public.process_swing_dispatch_runs),
 'result',(SELECT result FROM comparison WHERE kind='new'),'timings',(SELECT jsonb_object_agg(kind,elapsed_ms) FROM comparison));ROLLBACK;"""
 r=json.loads(sql(q));assert r['equal'] and r['businessUnchanged'],(name,r);r['case']=name;results.append(r)
bounds=json.loads(sql(r"""BEGIN;
 INSERT INTO public.clubs VALUES('11111111-1111-4111-8111-111111111111');
 UPDATE net._http_response SET created=clock_timestamp() WHERE id<=101;
 INSERT INTO public.process_swing_dispatch_runs(run_id,request_id,club_id,tick_at,request_fingerprint,net_request_id,requested_at,lease_token,lease_expires_at,business_state)
 SELECT gen_random_uuid(),gen_random_uuid(),'11111111-1111-4111-8111-111111111111',now(),'bound-'||n,n,clock_timestamp(),gen_random_uuid(),now()+interval '1 minute','started' FROM generate_series(1,101)n;
 SELECT public.observe_process_swing_cron(1000) AS first \gset
 SELECT public.observe_process_swing_cron(-1) AS second \gset
 SELECT jsonb_build_object('first',:'first'::jsonb,'second',:'second'::jsonb,'pending',(SELECT count(*) FROM public.process_swing_dispatch_runs WHERE transport_state='pending'),'businessUnchanged',(SELECT bool_and(business_state='started') FROM public.process_swing_dispatch_runs));ROLLBACK;"""))
assert bounds['first']['observed']==100 and bounds['second']['observed']==1 and bounds['pending']==0 and bounds['businessUnchanged']
actor=sql("SELECT jsonb_build_object('superuser',(SELECT rolsuper FROM pg_roles WHERE rolname='postgres'),'canCreateNet',has_schema_privilege('postgres','net','CREATE')); ")
report={'kind':'REAL_POSTGRES_OBSERVER_WINDOW_NOT_PRODUCTION_CAPACITY','passed':True,'cases':results,'bounds':bounds,'wrongActorTested':wrong_actor_tested,'metadataUnchanged':True,'actor':json.loads(actor),'httpCalls':0,'productionChanged':False}
if os.environ.get('EXPECT_MANAGED_NO_CREATE')=='1':assert not report['actor']['superuser'] and not report['actor']['canCreateNet'] and wrong_actor_tested
output=os.environ.get('SWING_OBSERVER_REPORT')
if output:pathlib.Path(output).write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
