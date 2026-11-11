"""Real PostgreSQL, synthetic extension transport; no actual HTTP or hosted SQL."""
import os,json,pathlib,subprocess,time
root=pathlib.Path(__file__).resolve().parents[2]
database=os.environ.get('PGDATABASE','')
assert database.startswith('vinpoker_backup_observation_test_'), 'Disposable named DB required'
def sql(q,actor=None):
 env=os.environ.copy()
 if actor: env['PGUSER']=actor
 return subprocess.check_output(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],input=q,text=True,env=env).strip()
assert sql('SELECT current_database();')==database
original=(root/'supabase/migrations/20270128000020_dealer_ready_backup_private_cron_v1.sql').read_text().split('-- Update the existing single job')[0]+'\nCOMMIT;'
sql(original,'postgres')
sql("""DO $$DECLARE d text;BEGIN
 SELECT pg_get_functiondef('public.run_dealer_ready_backup_cron_v1()'::regprocedure) INTO d;
 EXECUTE replace(d,'public.run_dealer_ready_backup_cron_v1()','public.backup_observer_test_baseline()');
END$$;""",'postgres')
before=json.loads(sql("SELECT jsonb_build_object('acl',proacl,'owner',proowner,'definer',prosecdef,'config',proconfig) FROM pg_proc WHERE oid='public.run_dealer_ready_backup_cron_v1()'::regprocedure;"))
migration=(root/'supabase/migrations/20270128000337_dealer_backup_indexed_response_observation.sql').read_text()
def rejects(token,actor=None):
 env=os.environ.copy()
 if actor:env['PGUSER']=actor
 result=subprocess.run(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],input=migration,text=True,env=env,capture_output=True)
 assert result.returncode!=0 and token in result.stderr,'Migration guard did not reject expected drift'
wrong_actor_tested=sql('SELECT current_user;')!='postgres'
if wrong_actor_tested:rejects('backup_observer_wrong_actor')
sql("ALTER FUNCTION public.run_dealer_ready_backup_cron_v1() SET search_path='public';",'postgres')
rejects('backup_observer_predecessor_or_acl_drift','postgres')
sql("ALTER FUNCTION public.run_dealer_ready_backup_cron_v1() SET search_path='';GRANT EXECUTE ON FUNCTION public.run_dealer_ready_backup_cron_v1() TO anon;",'postgres')
rejects('backup_observer_predecessor_or_acl_drift','postgres')
sql("REVOKE EXECUTE ON FUNCTION public.run_dealer_ready_backup_cron_v1() FROM anon;CREATE INDEX dealer_ready_backup_pending_requested_idx ON public.dealer_ready_backup_cron_runs(requested_at);",'postgres')
rejects('backup_observer_table_or_index_drift','postgres')
sql('DROP INDEX public.dealer_ready_backup_pending_requested_idx;','postgres')
sql("""INSERT INTO net._http_response(id,status_code,timed_out,created,content)
 SELECT n,200,false,now()-(100000-n)*interval '200 milliseconds',repeat(md5(n::text),90) FROM generate_series(1,100000)n;
INSERT INTO public.dealer_ready_backup_cron_runs(request_id,requested_at,result_state)
 SELECT n+300000,now()-interval '1 day','success' FROM generate_series(1,45000)n;
ANALYZE net._http_response;ANALYZE public.dealer_ready_backup_cron_runs;""")
sql(migration,'postgres')
after=json.loads(sql("SELECT jsonb_build_object('acl',proacl,'owner',proowner,'definer',prosecdef,'config',proconfig) FROM pg_proc WHERE oid='public.run_dealer_ready_backup_cron_v1()'::regprocedure;"))
assert before==after,'Caller boundary or metadata changed'

cases=[('no-pending',None,'1 second','ok',True),('recent-success',99999,'1 second','ok',True),('clock-shifted-response',1,'1 second','ok',True),
 ('missing-inflight',200001,'1 second','ok',True),('missing-expired',200001,'3 minutes','ok',True),
 ('exact-expiry-boundary',200001,'2 minutes','ok',True),('missing-secret',99999,'1 second','ok',False),
 ('enqueue-exception',99999,'1 second','error',True),('enqueue-null',99999,'1 second','null',True),
 ('null-request-id',None,'3 minutes','ok',True),('http-failure',99999,'1 second','ok',True),
 ('response-timeout',99999,'1 second','ok',True),('null-response-status',99999,'1 second','ok',True),
 ('null-response-timeout',99999,'1 second','ok',True)]
results=[]
for name,request,age,mode,secret in cases:
 status={'http-failure':'500','null-response-status':'NULL'}.get(name,'200')
 timed_out={'response-timeout':'true','null-response-timeout':'NULL'}.get(name,'false')
 query="""BEGIN;
 UPDATE net._http_response SET created=now()-interval '100 milliseconds',status_code="""+status+",timed_out="+timed_out+" WHERE id=99999;"+"""
 UPDATE net.observation_test_mode SET mode='"""+mode+"';"+("DELETE FROM vault.decrypted_secrets;" if not secret else '')+"""
 """+('' if name=='no-pending' else "INSERT INTO public.dealer_ready_backup_cron_runs(request_id,requested_at,result_state) VALUES("+('NULL' if request is None else str(request))+",now()-interval '"+age+"','pending');")+"""
 CREATE TEMP TABLE original_max ON COMMIT DROP AS SELECT coalesce(max(id),0) AS id FROM public.dealer_ready_backup_cron_runs;
 CREATE TEMP TABLE observed_ids ON COMMIT DROP AS SELECT id FROM public.dealer_ready_backup_cron_runs WHERE result_state='pending';
 CREATE TEMP TABLE initial_rows ON COMMIT DROP AS SELECT r.* FROM public.dealer_ready_backup_cron_runs r JOIN observed_ids i USING(id);
 CREATE TEMP TABLE comparison(kind text,elapsed_ms numeric,rows jsonb,new_state text) ON COMMIT DROP;
 DO $$DECLARE t timestamptz;BEGIN
 t:=clock_timestamp();PERFORM public.backup_observer_test_baseline();
 INSERT INTO comparison SELECT 'baseline',extract(epoch FROM(clock_timestamp()-t))*1000,
  (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.dealer_ready_backup_cron_runs r JOIN observed_ids i USING(id)),
  (SELECT result_state||':'||coalesce(error_code,'') FROM public.dealer_ready_backup_cron_runs WHERE id>(SELECT id FROM original_max) ORDER BY id DESC LIMIT 1);
 DELETE FROM public.dealer_ready_backup_cron_runs WHERE id>(SELECT id FROM original_max) OR id IN(SELECT id FROM observed_ids);
 INSERT INTO public.dealer_ready_backup_cron_runs OVERRIDING SYSTEM VALUE SELECT * FROM initial_rows;
 t:=clock_timestamp();PERFORM public.run_dealer_ready_backup_cron_v1();
 INSERT INTO comparison SELECT 'candidate',extract(epoch FROM(clock_timestamp()-t))*1000,
  (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.dealer_ready_backup_cron_runs r JOIN observed_ids i USING(id)),
  (SELECT result_state||':'||coalesce(error_code,'') FROM public.dealer_ready_backup_cron_runs WHERE id>(SELECT id FROM original_max) ORDER BY id DESC LIMIT 1);
 END$$;
 SELECT jsonb_build_object('equal',(SELECT rows FROM comparison WHERE kind='baseline') IS NOT DISTINCT FROM (SELECT rows FROM comparison WHERE kind='candidate'),
 'newStateEqual',(SELECT new_state FROM comparison WHERE kind='baseline') IS NOT DISTINCT FROM (SELECT new_state FROM comparison WHERE kind='candidate'),
 'timings',(SELECT jsonb_object_agg(kind,elapsed_ms) FROM comparison),'queued',(SELECT count(*) FROM net.observation_test_queue));
 ROLLBACK;"""
 r=json.loads(sql(query));assert r['equal'] and r['newStateEqual'],(name,r)
 assert r['queued']==(2 if mode=='ok' and secret else 0),(name,r)
 r['case']=name;results.append(r)
# Conflicting duplicate IDs have no unique winner under the predecessor UPDATE FROM.
# Check both functions choose an actual matching reply; do not claim exact equivalence.
duplicate_results=[]
for function in ['backup_observer_test_baseline','run_dealer_ready_backup_cron_v1']:
 q="""BEGIN;
 INSERT INTO net._http_response(id,status_code,timed_out,created) VALUES
 (700001,500,false,now()-interval '1 day'),(700001,200,false,now());
 INSERT INTO public.dealer_ready_backup_cron_runs(request_id,requested_at,result_state)
 VALUES(700001,now()-interval '1 second','pending');
 SELECT public."""+function+"""();
 SELECT jsonb_build_object('status',response_status,'state',result_state,'error',error_code,
 'queued',(SELECT count(*) FROM net.observation_test_queue))
 FROM public.dealer_ready_backup_cron_runs WHERE request_id=700001;
 ROLLBACK;"""
 r=json.loads(sql(q).splitlines()[-1]);assert r['queued']==1
 assert (r['status'],r['state'],r['error']) in [(200,'success',None),(500,'failed','http_failed')],r
 r['function']=function;duplicate_results.append(r)
actor_superuser=sql("SELECT rolsuper FROM pg_roles WHERE rolname='postgres';")=='t'
managed_create=sql("SELECT has_schema_privilege('postgres','net','CREATE');")=='t'
if os.environ.get('EXPECT_MANAGED_NO_CREATE')=='1':
 assert not actor_superuser and not managed_create,'Fixture accidentally gave managed DDL privileges'
 assert wrong_actor_tested,'Hosted-shaped fixture skipped wrong actor guard'
report={'kind':'REAL_POSTGRES_FULL_BACKUP_CALLER_FAKE_NET_TRANSPORT','passed':True,'database':database,'sourceRows':100000,'metadataUnchanged':True,'migrationActorSuperuser':actor_superuser,'migrationActorCanCreateNet':managed_create,'wrongActorTested':wrong_actor_tested,'wrongActorRejected':True if wrong_actor_tested else None,'configAclAndIndexDriftRejected':True,'cases':results,'conflictingDuplicatePermittedOutcomes':duplicate_results,'conflictingDuplicateExactEquivalenceClaim':False,'productionChanged':False,'realHttpDelivery':False}
output=os.environ.get('BACKUP_OBSERVER_REPORT')
if output:
 destination=pathlib.Path(output);assert destination.is_absolute();destination.parent.mkdir(parents=True,exist_ok=True);destination.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
