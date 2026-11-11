CREATE TABLE public.cron_retention_predecessor AS
SELECT pg_get_functiondef(oid) AS definition,
 md5(replace(prosrc,chr(13),'')) AS source_md5,proacl,proconfig,proowner,prosecdef
FROM pg_proc WHERE oid='public.cleanup_cron_job_run_details(integer)'::regprocedure;
REVOKE ALL ON public.cron_retention_predecessor FROM PUBLIC,anon,authenticated,service_role;

