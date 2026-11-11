"""Actual caller, independent PG sessions; synthetic transport, no network."""
import os,subprocess,time,json,pathlib
assert os.environ.get('PGDATABASE','').startswith('vinpoker_backup_observation_test_')
args=['psql','-X','-qAt','-v','ON_ERROR_STOP=1']
def sql(q):return subprocess.check_output(args,input=q,text=True).strip()
sql("""CREATE FUNCTION public.backup_snapshot_test_barrier() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n int:=coalesce(nullif(current_setting('test.backup_update_count',true),''),'0')::int+1;
BEGIN
 PERFORM set_config('test.backup_update_count',n::text,true);
 IF n=2 THEN PERFORM pg_advisory_xact_lock(1626339); END IF;
 RETURN NULL;
END$$;
CREATE TRIGGER backup_snapshot_test_barrier BEFORE UPDATE ON public.dealer_ready_backup_cron_runs
FOR EACH STATEMENT EXECUTE FUNCTION public.backup_snapshot_test_barrier();""")
results=[]
try:
 for function,expected in [('backup_observer_test_337','failed'),('run_dealer_ready_backup_cron_v1','pending')]:
  sql("DELETE FROM public.dealer_ready_backup_cron_runs WHERE result_state='pending' OR request_id=900008; DELETE FROM net._http_response WHERE id=900008; INSERT INTO public.dealer_ready_backup_cron_runs(request_id,requested_at,result_state) VALUES(900008,now()-interval '3 minutes','pending');")
  holder=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
  holder.stdin.write("SELECT pg_advisory_lock(1626339);SELECT 'READY';\n");holder.stdin.flush()
  deadline=time.monotonic()+10
  while holder.stdout.readline().strip()!='READY':assert time.monotonic()<deadline
  env=dict(os.environ,PGUSER='postgres',PGAPPNAME='backup-snapshot-race-test')
  worker=subprocess.Popen(args+['-c',"SET statement_timeout='10s';SELECT public."+function+'();'],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  try:
   deadline=time.monotonic()+10
   while sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='backup-snapshot-race-test' AND wait_event='advisory';")!='1':
    assert time.monotonic()<deadline,'fallback did not reach snapshot barrier'
    time.sleep(.05)
   sql('INSERT INTO net._http_response(id,status_code,timed_out,created) VALUES(900008,200,false,clock_timestamp());')
   holder.stdin.write('SELECT pg_advisory_unlock(1626339);\n\\q\n');holder.stdin.flush()
   out,err=worker.communicate(timeout=12);assert worker.returncode==0,err
   state=sql('SELECT result_state FROM public.dealer_ready_backup_cron_runs WHERE request_id=900008;')
   assert state==expected,(function,state,expected)
   if expected=='pending':
    subprocess.run(args+['-c','SELECT public.run_dealer_ready_backup_cron_v1();'],env=env,check=True,capture_output=True,text=True)
    assert sql('SELECT result_state FROM public.dealer_ready_backup_cron_runs WHERE request_id=900008;')=='success'
   results.append({'function':function,'afterRace':state,'reopenObservedSuccess':expected=='pending'})
  finally:
   if holder.poll() is None:holder.stdin.close();holder.wait(timeout=12)
   if worker.poll() is None:worker.communicate(timeout=12)
finally:
 sql('DROP TRIGGER backup_snapshot_test_barrier ON public.dealer_ready_backup_cron_runs;DROP FUNCTION public.backup_snapshot_test_barrier();')
report={'kind':'ACTUAL_CALLER_RESPONSE_SNAPSHOT_RACE','passed':True,'cases':results,'realHttpDelivery':False,'productionChanged':False}
if os.environ.get('BACKUP_OBSERVER_REPORT'):
 destination=pathlib.Path(os.environ['BACKUP_OBSERVER_REPORT']).with_name('snapshot-race.json')
 destination.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
