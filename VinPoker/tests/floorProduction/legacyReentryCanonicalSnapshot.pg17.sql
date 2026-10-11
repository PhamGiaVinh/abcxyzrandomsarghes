-- Run before migration60, in the same owned disposable database as its postcheck.
-- No participation or buy-in mutation is needed to prove catalog preservation.
\set ON_ERROR_STOP on
CREATE TABLE public.lr01_canonical_snapshot AS
SELECT pg_get_functiondef(p.oid) definition, p.proowner, p.prosecdef,
       p.proconfig, p.proacl
FROM pg_proc p
WHERE p.oid = 'public.reenter_tournament_player(uuid,bigint,bigint,text)'::regprocedure;
REVOKE ALL ON public.lr01_canonical_snapshot FROM PUBLIC, anon, authenticated, service_role;
