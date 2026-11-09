-- Disposable CI database only, retained across test sessions for recovery proof.
\set ON_ERROR_STOP on
CREATE TABLE public.rotation_budget_test_predecessor AS
 SELECT pg_get_functiondef(oid) AS definition,md5(replace(prosrc,chr(13),'')) AS source_md5,
 proowner,proacl,proconfig FROM pg_proc
 WHERE oid='public.cleanup_dealer_rotation_schedule(uuid,integer)'::regprocedure;
