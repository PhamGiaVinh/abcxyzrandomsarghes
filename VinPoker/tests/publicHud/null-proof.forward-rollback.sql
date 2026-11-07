BEGIN;
DO $guard$ BEGIN
 IF md5(replace(pg_get_functiondef('tracker_analytics_v1.safe_integer(jsonb)'::regprocedure),chr(13),''))<>'a3615d0068110c9bf33939ecf8f29024' THEN
  RAISE EXCEPTION 'HUD numeric validator recovery preimage differs';
 END IF;
END $guard$;
ALTER FUNCTION tracker_analytics_v1.safe_integer(jsonb) CALLED ON NULL INPUT;
COMMIT;
