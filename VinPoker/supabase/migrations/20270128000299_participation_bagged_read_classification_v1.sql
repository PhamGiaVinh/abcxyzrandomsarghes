-- Candidate business READ projection only. No record, money, bag, privilege or history writes.
-- Bagged is an existing tournament_entries.status; preserve it in participation projection.
DO $bagged299$
DECLARE definition text;
 anchor text := '    WHEN e.status=''busted'' THEN ''busted''';
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='floor_private.tournament_participation_v1(uuid)'::regprocedure)<>'b9624adaa8d7bb35713917486c40fe67' THEN
  RAISE EXCEPTION 'participation299_baseline_drift';
 END IF;
 SELECT replace(pg_get_functiondef('floor_private.tournament_participation_v1(uuid)'::regprocedure),chr(13),'') INTO definition;
 IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'participation299_anchor_missing'; END IF;
 definition:=replace(definition,anchor,E'    WHEN e.status=''bagged'' THEN ''bagged''\n'||anchor);
 EXECUTE definition;
END;
$bagged299$;
