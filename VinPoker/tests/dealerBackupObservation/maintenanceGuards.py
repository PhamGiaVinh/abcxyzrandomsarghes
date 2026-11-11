"""Disposable native maintenance rejection cases; no production credentials."""
import os,subprocess,pathlib,json,tempfile
assert os.environ.get('PGDATABASE','').startswith('vinpoker_backup_observation_test_')
root=pathlib.Path(__file__).resolve().parents[2]
args=['psql','-X','-qAt','-v','ON_ERROR_STOP=1']
def sql(q):return subprocess.check_output(args,input=q,text=True).strip()
script=root/'scripts/ops/maintain-http-response.sh'
original=sql("SELECT pg_get_functiondef('public.run_dealer_ready_backup_cron_v1()'::regprocedure);")
stamp=sql("SELECT coalesce(last_vacuum::text,'none') FROM pg_stat_all_tables WHERE relid='net._http_response'::regclass;")
cases=[]
# Mirror a pooler that retains the role default despite startup PGOPTIONS.
# The maintenance connection must explicitly SET its own budgets; the role
# default must remain unchanged after both rejected and successful operations.
sql("ALTER ROLE postgres SET statement_timeout='2min';")
def denied(name,env=None):
 e=dict(os.environ,PGUSER='postgres');e.update(env or {})
 result=subprocess.run(['bash',str(script),'--fixture'],env=e,capture_output=True,text=True)
 assert result.returncode!=0,name
 assert sql("SELECT coalesce(last_vacuum::text,'none') FROM pg_stat_all_tables WHERE relid='net._http_response'::regclass;")==stamp,name
 cases.append({'case':name,'rejectedBeforeVacuum':True})
fixed_script=script
with tempfile.TemporaryDirectory() as temp:
 old_script=pathlib.Path(temp)/'old-maintenance.sh'
 text=script.read_text()
 start=text.index('query() {')
 end=text.index('\npreflight=',start)
 old_script.write_text(text[:start]+'''query() { "${psql_cmd[@]}" -X -qAt -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate 2>"$work/diagnostics.log"; }'''+text[end:])
 script=old_script
 denied('pooler-ignores-startup-options-old-preflight-rejected')
 script=fixed_script

denied('nonlocal-fixture-host',{'PGHOST':'example.invalid'})
denied('wrong-actor',{'PGUSER':'anon'})
holder=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
try:
 holder.stdin.write("BEGIN;LOCK TABLE net._http_response IN SHARE UPDATE EXCLUSIVE MODE;SELECT 'LOCK_READY';\n");holder.stdin.flush()
 while holder.stdout.readline().strip()!='LOCK_READY':
  assert holder.poll() is None,'fixture lock holder failed'
 denied('skip-locked-is-not-completion')
finally:
 if holder.poll() is None:
  holder.stdin.write('ROLLBACK;\n\\q\n');holder.stdin.flush();holder.wait(timeout=10)
sql('REVOKE MAINTAIN ON net._http_response FROM postgres;')
denied('missing-maintain')
sql('GRANT MAINTAIN ON net._http_response TO postgres;')
sql(original.replace('BEGIN','BEGIN\n-- test-only source drift',1))
denied('source-drift')
sql(original)
sql('ALTER TABLE net._http_response OWNER TO postgres;')
denied('owner-drift')
sql('ALTER TABLE net._http_response OWNER TO maintenance_test_admin;GRANT SELECT,MAINTAIN ON net._http_response TO postgres;')
report={'kind':'NATIVE_MAINTENANCE_NEGATIVE_FIXTURE','passed':True,'cases':cases,'productionChanged':False}
destination=pathlib.Path(os.environ['HTTP_MAINTENANCE_REPORT']).with_name('negative-guards.json')
destination.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
