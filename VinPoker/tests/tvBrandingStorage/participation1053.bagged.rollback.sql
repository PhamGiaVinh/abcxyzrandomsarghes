-- Business read projection rollback only; candidate hash required, no historical writes.
DO $undo299$
DECLARE definition text;
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='floor_private.tournament_participation_v1(uuid)'::regprocedure)<>'52c35e94cfaf361537ccb4f56a1cc57b' THEN
  RAISE EXCEPTION 'participation299_rollback_candidate_drift';
 END IF;
 SELECT replace(pg_get_functiondef('floor_private.tournament_participation_v1(uuid)'::regprocedure),chr(13),'') INTO definition;
 definition:=replace(definition,E'    WHEN e.status=''bagged'' THEN ''bagged''\n','');
 EXECUTE definition;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='floor_private.tournament_participation_v1(uuid)'::regprocedure)<>'b9624adaa8d7bb35713917486c40fe67' THEN
  RAISE EXCEPTION 'participation299_rollback_postcondition_drift';
 END IF;
END;
$undo299$;
