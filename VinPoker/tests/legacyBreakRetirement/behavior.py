"""Real PG17/pg_cron; synthetic run metadata tests guards without external calls."""
import os
import pathlib
import subprocess
import time

root = pathlib.Path(__file__).resolve().parents[2]
migration = (root / "supabase/migrations/20270128000341_retire_legacy_break_bounded_preflight.sql").read_text()
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

assert sql("SELECT has_table_privilege('postgres','cron.job_run_details','SELECT')") == "f"
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
# Real same-actor client, both actively executing and idle at its prompt.
# Holding stdin open keeps the connection alive after SELECT completes.
for phase in ["active", "idle"]:
    env = dict(os.environ, PGUSER="postgres", PGAPPNAME="pg_cron fixture")
    p = subprocess.Popen(["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"],
                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                         text=True, env=env)
    try:
        p.stdin.write("SELECT pg_sleep(3);\n" if phase == "active" else "SELECT 1;\n")
        p.stdin.flush()
        for _ in range(100):
            if sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='pg_cron fixture' AND state='" + phase + "'") == "1":
                break
            time.sleep(0.02)
        else:
            raise AssertionError("fixture client never reached " + phase)
        sql(migration, actor="postgres", error="legacy_break_retirement_job_busy")
        unchanged()
    finally:
        p.stdin.close()
        p.wait(timeout=8)
        assert p.returncode == 0, p.stderr.read()

# Old history does not define current activity; caller lacks history SELECT.
sql("BEGIN; INSERT INTO cron.job_run_details(jobid,runid,status) VALUES(22,900001,'running'); SET ROLE postgres; " + body + " ROLLBACK;")
unchanged()

# Explicit transaction rollback restores exact row; migration contains no COMMIT here.
sql("BEGIN; SET ROLE postgres; " + body + " ROLLBACK;")
unchanged()
sql("CREATE TABLE public.fixture_job_preimage AS SELECT * FROM cron.job")
sql(migration, actor="postgres")
assert sql("SELECT NOT j.active AND (to_jsonb(j)-'active')=(to_jsonb(b)-'active') FROM cron.job j JOIN public.fixture_job_preimage b USING(jobid) WHERE j.jobid=22") == "t"
assert sql("SELECT to_jsonb(j)=to_jsonb(b) FROM cron.job j JOIN public.fixture_job_preimage b USING(jobid) WHERE j.jobid=23") == "t"
sql(migration, actor="postgres", error="legacy_break_retirement_catalog_drift")
print("PASS: exact retirement, actor, eight catalog drifts, credential, real active/idle cron clients, stale-history independence, rollback, retry, sentinel preservation")
