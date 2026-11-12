-- Disposable PG17 only. No pg_net extension; launcher MUST stay off until retired.
DO $$ BEGIN
 IF current_setting('cron.launch_active_jobs') <> 'off'
 OR EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN
   RAISE EXCEPTION 'unsafe_fixture_environment';
 END IF;
END $$;
SELECT setval('cron.jobid_seq',22,false);
SET ROLE postgres;
SELECT cron.schedule('enforce-break-balance','*/5 * * * *',
$legacy22$
  SELECT net.http_post(
    url := 'https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/enforceBreakBalance',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $legacy22$);
SELECT cron.schedule('fixture-sentinel','1 second','SELECT 1;');
RESET ROLE;
