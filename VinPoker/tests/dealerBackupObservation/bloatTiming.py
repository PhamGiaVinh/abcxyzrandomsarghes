"""Actual caller timing on disposable sparse heap, before/after VACUUM.

Keep both results: the extra absence check can cost more on a dense/dead index.
Never infer production latency or a universal improvement from this fixture.
"""
import os,subprocess,json,pathlib
assert os.environ.get('PGDATABASE','').startswith('vinpoker_backup_observation_test_')
def sql(q):return subprocess.check_output(['psql','-X','-qAt','-v','ON_ERROR_STOP=1'],input=q,text=True).strip()
sql("DELETE FROM public.dealer_ready_backup_cron_runs WHERE result_state='pending';DELETE FROM net._http_response WHERE id<99000;")
def measure():
 results=[]
 for function in ['backup_observer_test_337','run_dealer_ready_backup_cron_v1']:
  for age in ['1 second','3 minutes']:
   q="""BEGIN;
   INSERT INTO public.dealer_ready_backup_cron_runs(request_id,requested_at,result_state) VALUES(800008,now()-interval '"""+age+"""','pending');
   CREATE TEMP TABLE timing(ms numeric) ON COMMIT DROP;
   DO $$DECLARE t timestamptz:=clock_timestamp();BEGIN
    PERFORM public."""+function+"""();
    INSERT INTO timing VALUES(extract(epoch FROM(clock_timestamp()-t))*1000);
   END$$;
   SELECT json_build_object('function','"""+function+"""','age','"""+age+"""','ms',(SELECT ms FROM timing),
    'state',(SELECT result_state FROM public.dealer_ready_backup_cron_runs WHERE request_id=800008));ROLLBACK;"""
   result=json.loads(sql(q));assert result['state']==('pending' if age=='1 second' else 'failed');results.append(result)
 return results
before=measure()
sql('VACUUM (ANALYZE) net._http_response;')
after=measure()
report={'kind':'ACTUAL_CALLER_SPARSE_HEAP_FIXTURE_TIMING','passed':True,'beforeDeadIndexCleanup':before,'afterDeadIndexCleanup':after,'fixture':json.loads(sql("SELECT json_build_object('rows',(SELECT count(*) FROM net._http_response),'heapBytes',pg_relation_size('net._http_response'));")),'productionChanged':False,'realHttpDelivery':False,'limits':['Single samples, not p95','Timing depends on heap/index/cache/planner state','Extra timeout absence recheck can be slower','Disposable ordinary VACUUM does not authorize managed production maintenance']}
if os.environ.get('BACKUP_OBSERVER_REPORT'):
 pathlib.Path(os.environ['BACKUP_OBSERVER_REPORT']).with_name('bloat-timing.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
