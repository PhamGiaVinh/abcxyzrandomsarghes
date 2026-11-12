"""Real background-worker busy guard with target22 committed inactive."""
import os
import pathlib
import subprocess
import time

def sql(source, actor="cron_test_admin", error=None):
    r = subprocess.run(["psql", "-X", "-At", "-v", "ON_ERROR_STOP=1"],
                       input=source, text=True, capture_output=True,
                       env=dict(os.environ, PGUSER=actor))
    if error:
        assert r.returncode != 0 and error in r.stderr, r.stderr
    else:
        assert r.returncode == 0, r.stderr
    return r.stdout.strip()

assert sql("SELECT NOT active FROM cron.job WHERE jobid=22") == "t"
sql("SELECT cron.alter_job(23,command:='SELECT pg_sleep(4);')")
for _ in range(200):
    if sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE backend_type='pg_cron' AND usename='postgres' AND datname='postgres')") == "t":
        break
    time.sleep(0.05)
else:
    raise AssertionError("real pg_cron worker not observed: " + sql(
        "SELECT jsonb_agg(jsonb_build_object('application',application_name,"
        "'backend_type',backend_type,'state',state)) FROM pg_stat_activity "
        "WHERE backend_type LIKE 'pg_cron%' OR application_name LIKE 'pg_cron%'"))

root = pathlib.Path(__file__).resolve().parents[2]
source = (root / "supabase/migrations/20270128000341_retire_legacy_break_bounded_preflight.sql").read_text()
body = source[source.index("DO $retire$"):source.index("COMMIT;")]
# Only this uncommitted transaction sees22active; scheduler continues to see
# committed22inactive, so its legacy command cannot launch during this test.
sql("BEGIN; SELECT cron.alter_job(22,active:=true); " + body,
    actor="postgres", error="legacy_break_retirement_job_busy")
assert sql("SELECT NOT active FROM cron.job WHERE jobid=22") == "t"
sql("SELECT cron.alter_job(23,command:='SELECT 1;')")
time.sleep(5)
print("PASS: real pg_cron background worker blocks retirement; uncommitted22activation rolled back")
