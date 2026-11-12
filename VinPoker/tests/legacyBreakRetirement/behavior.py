"""Real PG17/pg_cron; synthetic run metadata tests guards without external calls."""
import os
import pathlib
import subprocess

root = pathlib.Path(__file__).resolve().parents[2]
migration = (root / "supabase/migrations/20270128000340_retire_failing_legacy_break_enforcement.sql").read_text()
body = migration[migration.index("DO $retire$"):migration.index("COMMIT;")]

def sql(source, actor="cron_test_admin", error=None):
    env = dict(os.environ, PGUSER=actor)
    r = subprocess.run(["psql", "-X", "-At", "-v", "ON_ERROR_STOP=1"], input=source,
                       text=True, capture_output=True, env=env)
    if error:
        assert r.returncode != 0 and error in r.stderr, r.stderr
    else:
        assert r.returncode == 0, r.stderr
    return r.stdout.strip()

def unchanged():
    assert sql("SELECT active AND md5(command)='e55b52aa6ceb03f6f276bfd19e1f3769' FROM cron.job WHERE jobid=22") == "t"

sql(migration, error="legacy_break_retirement_wrong_actor")
unchanged()
for change in ["schedule='* * * * *'", "command='SELECT 1'", "jobname='changed'",
               "active=false", "username='cron_test_admin'", "database='template1'",
               "nodename='changed'", "nodeport=9999"]:
    sql("BEGIN; UPDATE cron.job SET " + change + " WHERE jobid=22; SET ROLE postgres; " + body,
        error="legacy_break_retirement_catalog_drift")
    unchanged()

sql("BEGIN; SET LOCAL app.settings.service_role_key='fixture-not-a-secret'; SET ROLE postgres; " + body,
    error="legacy_break_retirement_credential_state_changed")
unchanged()
for state in ["starting", "running"]:
    sql("BEGIN; INSERT INTO cron.job_run_details(jobid,runid,status) VALUES(22,900001,'" + state +
        "'); SET ROLE postgres; " + body, error="legacy_break_retirement_job_busy")
    unchanged()

# Explicit transaction rollback restores exact row; migration contains no COMMIT here.
sql("BEGIN; SET ROLE postgres; " + body + " ROLLBACK;")
unchanged()
sql("CREATE TABLE public.fixture_job_preimage AS SELECT * FROM cron.job")
sql(migration, actor="postgres")
assert sql("SELECT NOT active AND (to_jsonb(j)-'active')=(to_jsonb(b)-'active') FROM cron.job j JOIN public.fixture_job_preimage b USING(jobid) WHERE j.jobid=22") == "t"
assert sql("SELECT to_jsonb(j)=to_jsonb(b) FROM cron.job j JOIN public.fixture_job_preimage b USING(jobid) WHERE j.jobid=23") == "t"
sql(migration, actor="postgres", error="legacy_break_retirement_catalog_drift")
print("PASS: exact retirement, actor, eight catalog drifts, credential, busy, rollback, retry, sentinel preservation")
