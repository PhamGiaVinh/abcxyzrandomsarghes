-- Candidate only. Roll back by disabling the editor and snapshot trigger first.
-- Keep the immutable published thumbnails: existing hand snapshots reference them.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

CREATE TABLE floor_private.club_member_portrait_versions (
  id uuid PRIMARY KEY,
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.club_members(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL,
  replaces uuid,
  capture_context jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  is_current boolean NOT NULL DEFAULT false,
  CHECK (NOT is_current OR published_at IS NOT NULL)
);
CREATE UNIQUE INDEX club_member_one_current_portrait
 ON floor_private.club_member_portrait_versions (club_id,member_id) WHERE is_current;
ALTER TABLE floor_private.club_member_portrait_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.club_member_portrait_versions FROM PUBLIC, anon, authenticated;

-- Only the resized display copy goes here. Opaque keys reveal no member or club ID.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('club-player-portraits','club-player-portraits',true,131072,ARRAY['image/jpeg']);

CREATE FUNCTION floor_private.club_portrait_staff(p_club uuid,p_actor uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT p_actor IS NOT NULL AND
  (EXISTS (SELECT 1 FROM public.club_floors WHERE club_id=p_club AND user_id=p_actor)
   OR EXISTS (SELECT 1 FROM public.club_cashiers WHERE club_id=p_club AND user_id=p_actor)
   OR EXISTS (SELECT 1 FROM public.clubs WHERE id=p_club AND owner_id=p_actor))
$$;

CREATE FUNCTION floor_private.club_portrait_upload_allowed(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS (SELECT 1 FROM floor_private.club_member_portrait_versions v
  JOIN public.club_members m ON m.id=v.member_id AND m.club_id=v.club_id
  WHERE v.id=CASE WHEN p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]jpg$'
    THEN left(p_name,36)::uuid END
   AND v.actor_id=auth.uid() AND v.published_at IS NULL
   AND v.replaces IS NOT DISTINCT FROM (SELECT live.id FROM floor_private.club_member_portrait_versions live
    WHERE live.club_id=v.club_id AND live.member_id=v.member_id AND live.is_current)
   AND v.created_at > now()-interval '30 minutes' AND floor_private.club_portrait_staff(m.club_id,auth.uid()))
$$;
REVOKE ALL ON FUNCTION floor_private.club_portrait_staff(uuid,uuid),
 floor_private.club_portrait_upload_allowed(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION floor_private.club_portrait_upload_allowed(text) TO authenticated;

CREATE POLICY club_portrait_upload ON storage.objects FOR INSERT TO authenticated
 WITH CHECK (bucket_id='club-player-portraits' AND floor_private.club_portrait_upload_allowed(name));
CREATE POLICY club_portrait_upload_scope ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK (bucket_id<>'club-player-portraits' OR floor_private.club_portrait_upload_allowed(name));
CREATE POLICY club_portrait_no_anon_upload ON storage.objects AS RESTRICTIVE FOR INSERT TO anon
 WITH CHECK (bucket_id<>'club-player-portraits');
CREATE POLICY club_portrait_immutable ON storage.objects AS RESTRICTIVE FOR UPDATE TO anon,authenticated
 USING (bucket_id<>'club-player-portraits') WITH CHECK (bucket_id<>'club-player-portraits');
CREATE POLICY club_portrait_keep_snapshot ON storage.objects AS RESTRICTIVE FOR DELETE TO anon,authenticated
 USING (bucket_id<>'club-player-portraits');
CREATE POLICY club_portrait_no_directory ON storage.objects AS RESTRICTIVE FOR SELECT TO anon,authenticated
 USING (bucket_id<>'club-player-portraits');

CREATE FUNCTION floor_private.club_portrait_member(p_club uuid,p_member uuid,p_player uuid)
RETURNS uuid LANGUAGE sql STABLE SET search_path='' AS $$
 -- An explicit foreign-club or obsolete member link must never fall back to a different person.
 SELECT CASE WHEN count(*)=1 THEN (array_agg(m.id))[1] END FROM public.club_members m
 WHERE m.club_id=p_club AND (m.id=p_member OR (p_member IS NULL AND m.player_user_id=p_player))
$$;
-- The release controller installs the verified public Storage origin for this instance.
-- An unconfigured preview cannot accidentally serve images from production.
CREATE TABLE floor_private.club_portrait_storage_origin (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 origin text NOT NULL CHECK (origin ~ '^https://[a-z0-9]{20}[.]supabase[.]co$' OR origin ~ '^http://127[.]0[.]0[.]1:[0-9]{1,5}$')
);
ALTER TABLE floor_private.club_portrait_storage_origin ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.club_portrait_storage_origin FROM PUBLIC,anon,authenticated;
CREATE FUNCTION floor_private.club_portrait_url(p_id uuid)
RETURNS text LANGUAGE plpgsql STABLE STRICT SET search_path='' AS $$
DECLARE base text;
BEGIN
 SELECT origin INTO base FROM floor_private.club_portrait_storage_origin WHERE singleton;
 IF base IS NULL THEN RAISE EXCEPTION 'portrait_storage_unconfigured'; END IF;
 RETURN base || '/storage/v1/object/public/club-player-portraits/' || p_id::text || '.jpg';
END $$;

CREATE FUNCTION floor_private.club_player_portrait_intent(p_actor uuid,p_context jsonb,p_action text DEFAULT 'read',
 p_expected uuid DEFAULT NULL,p_upload uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 club uuid; member uuid; member_name text; current_id uuid;
 version floor_private.club_member_portrait_versions%ROWTYPE;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('read','prepare','publish') OR p_actor IS NULL THEN
  RAISE EXCEPTION 'portrait_forbidden' USING ERRCODE='42501'; END IF;
 IF p_context->>'kind'='member' THEN
  club:=(p_context->>'club')::uuid; member:=(p_context->>'member')::uuid;
 ELSIF p_context->>'kind' IN ('seat','booking') THEN
  SELECT t.club_id INTO club FROM public.tournaments t WHERE t.id=(p_context->>'tour')::uuid;
 ELSE RAISE EXCEPTION 'portrait_unknown_context'; END IF;
 IF NOT coalesce(floor_private.club_portrait_staff(club,p_actor),false) THEN
  RAISE EXCEPTION 'portrait_forbidden' USING ERRCODE='42501'; END IF;
 IF p_context->>'kind'='seat' THEN
  SELECT floor_private.club_portrait_member(club,e.member_id,e.player_id) INTO member
   FROM public.tournament_seats s JOIN public.tournament_entries e ON e.id=s.entry_id
    AND e.tournament_id=s.tournament_id AND e.player_id=s.player_id AND e.entry_no=s.entry_number
   WHERE s.id=(p_context->>'seat')::uuid AND s.player_id=(p_context->>'player')::uuid
    AND s.tournament_id=(p_context->>'tour')::uuid AND s.is_active;
 ELSIF p_context->>'kind'='booking' THEN
  SELECT floor_private.club_portrait_member(club,NULL,b.player_id) INTO member
   FROM public.booking_chats b WHERE b.id=(p_context->>'chat')::uuid
    AND b.tournament_id=(p_context->>'tour')::uuid AND b.club_id=club AND b.player_id=(p_context->>'player')::uuid;
 END IF;
 IF p_action<>'read' AND member IS DISTINCT FROM (p_context->>'expected_member')::uuid THEN
  RAISE EXCEPTION 'portrait_changed'; END IF;
 IF p_action='read' THEN
  SELECT full_name INTO member_name FROM public.club_members WHERE id=member AND club_id=club;
 ELSE
  SELECT full_name INTO member_name FROM public.club_members WHERE id=member AND club_id=club FOR UPDATE;
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'portrait_member_unavailable'; END IF;
 SELECT id INTO current_id FROM floor_private.club_member_portrait_versions
  WHERE club_id=club AND member_id=member AND is_current;
 IF p_action<>'read' THEN
  IF p_upload IS NULL THEN RAISE EXCEPTION 'portrait_upload_required'; END IF;
  PERFORM floor_private.club_portrait_url(p_upload);
  SELECT * INTO version FROM floor_private.club_member_portrait_versions WHERE id=p_upload;
  IF FOUND AND (version.actor_id<>p_actor OR version.club_id<>club OR version.member_id<>member
      OR version.replaces IS DISTINCT FROM p_expected) THEN RAISE EXCEPTION 'portrait_upload_conflict'; END IF;
  IF current_id IS DISTINCT FROM p_upload THEN
   IF current_id IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'portrait_changed'; END IF;
   IF version.id IS NOT NULL AND (version.published_at IS NOT NULL OR version.created_at<=now()-interval '30 minutes')
    THEN RAISE EXCEPTION 'portrait_upload_expired'; END IF;
   IF p_action='prepare' THEN
    IF version.id IS NULL THEN
     INSERT INTO floor_private.club_member_portrait_versions(id,club_id,member_id,actor_id,replaces,capture_context)
      VALUES(p_upload,club,member,p_actor,p_expected,p_context);
    END IF;
   ELSE
    IF version.id IS NULL OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id='club-player-portraits'
     AND o.name=p_upload::text||'.jpg' AND o.owner_id=p_actor::text
     AND o.metadata->>'mimetype'='image/jpeg' AND (o.metadata->>'size')::bigint BETWEEN 1 AND 131072)
     THEN RAISE EXCEPTION 'portrait_upload_missing'; END IF;
    UPDATE floor_private.club_member_portrait_versions SET is_current=false WHERE id=current_id;
    UPDATE floor_private.club_member_portrait_versions SET is_current=true,published_at=now() WHERE id=p_upload;
    current_id:=p_upload;
   END IF;
  END IF;
 END IF;
 RETURN jsonb_build_object('member',member,'club',club,'name',member_name,'version',current_id,
  'url',floor_private.club_portrait_url(current_id));
END $$;
REVOKE ALL ON FUNCTION floor_private.club_player_portrait_intent(uuid,jsonb,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.club_player_portrait_v1(p_context jsonb,p_action text DEFAULT 'read',
 p_expected uuid DEFAULT NULL,p_upload uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT floor_private.club_player_portrait_intent(auth.uid(),p_context,p_action,p_expected,p_upload)
$$;

-- Link the immutable thumbnail in the same transaction in which Storage makes
-- its metadata visible. Failed or superseded uploads never acquire a public object.
CREATE FUNCTION floor_private.commit_club_portrait_object()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v floor_private.club_member_portrait_versions%ROWTYPE;
BEGIN
 SELECT * INTO STRICT v FROM floor_private.club_member_portrait_versions
  WHERE id=left(NEW.name,36)::uuid AND actor_id::text=NEW.owner_id;
 IF NEW.name<>v.id::text||'.jpg' THEN RAISE EXCEPTION 'portrait_upload_conflict'; END IF;
 PERFORM floor_private.club_player_portrait_intent(v.actor_id,v.capture_context,'publish',v.replaces,v.id);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION floor_private.commit_club_portrait_object() FROM PUBLIC,anon,authenticated;
-- Authorize the real write when final JPEG metadata arrives. Storage may first
-- issue a trial INSERT without metadata and roll it back before transferring bytes.
CREATE TRIGGER publish_club_portrait_jpeg AFTER INSERT OR UPDATE ON storage.objects
 FOR EACH ROW WHEN (NEW.bucket_id='club-player-portraits' AND NEW.metadata->>'mimetype'='image/jpeg'
  AND NEW.metadata->>'size' IS NOT NULL) EXECUTE FUNCTION floor_private.commit_club_portrait_object();
-- Storage authorizes uploads using a trial INSERT which it rolls back. A deferred
-- constraint fires at COMMIT of the real object only, once its final metadata exists.
CREATE CONSTRAINT TRIGGER commit_club_portrait_object AFTER INSERT ON storage.objects
 DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW WHEN (NEW.bucket_id='club-player-portraits') EXECUTE FUNCTION floor_private.commit_club_portrait_object();

REVOKE ALL ON FUNCTION public.club_player_portrait_v1(jsonb,text,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.club_player_portrait_v1(jsonb,text,uuid,uuid) TO authenticated;

-- Active dealer consoles read the roster before a hand exists. Resolve a portrait
-- at enrollment as well as at the hand boundary, including late member links.
CREATE FUNCTION floor_private.club_portrait_for_entry(p_tour uuid,p_entry uuid,p_player uuid,p_number integer)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT floor_private.club_portrait_url(v.id)
 FROM public.tournaments t JOIN public.tournament_entries e ON e.tournament_id=t.id
 JOIN floor_private.club_member_portrait_versions v ON v.club_id=t.club_id AND v.is_current
  AND v.member_id=floor_private.club_portrait_member(t.club_id,e.member_id,e.player_id)
 WHERE t.id=p_tour AND e.id=p_entry AND e.player_id=p_player AND e.entry_no=p_number
$$;
-- Read the photo after the existing scoped roster reader has authorized the exact
-- table session. The token and every game field still come from the original reader.
CREATE FUNCTION public.get_tracker_roster_with_portraits_v1(p_tournament_id uuid,p_tournament_table_id uuid,
 p_table_session_id uuid,p_expected_epoch bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE roster jsonb; seats jsonb;
BEGIN
 roster:=public.get_tracker_roster_snapshot_v2(p_tournament_id,p_tournament_table_id,p_table_session_id,p_expected_epoch);
 IF roster->>'ok' IS DISTINCT FROM 'true' THEN RETURN roster; END IF;
 SELECT jsonb_agg(CASE WHEN item->'seat'='null'::jsonb OR nullif(item#>>'{seat,avatar_url}','') IS NOT NULL THEN item
  ELSE jsonb_set(item,'{seat,avatar_url}',coalesce(to_jsonb(floor_private.club_portrait_for_entry(p_tournament_id,
   (item#>>'{seat,entry_id}')::uuid,(item#>>'{seat,player_id}')::uuid,(item#>>'{seat,entry_number}')::int)),'null'::jsonb)) END
  ORDER BY n) INTO seats FROM jsonb_array_elements(roster->'seats') WITH ORDINALITY AS r(item,n);
 RETURN jsonb_set(roster,'{seats}',coalesce(seats,'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION floor_private.club_portrait_for_entry(uuid,uuid,uuid,integer),
 public.get_tracker_roster_with_portraits_v1(uuid,uuid,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_tracker_roster_with_portraits_v1(uuid,uuid,uuid,bigint) TO authenticated;

CREATE FUNCTION floor_private.snapshot_club_player_portrait()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF nullif(NEW.avatar_url,'') IS NOT NULL AND NEW.avatar_url NOT LIKE '%/storage/v1/object/public/club-player-portraits/%' THEN RETURN NEW; END IF;
 SELECT floor_private.club_portrait_url(v.id) INTO NEW.avatar_url
 FROM public.tournament_hands h JOIN public.tournaments t ON t.id=h.tournament_id
 JOIN public.tournament_seats s ON s.tournament_id=t.id AND s.is_active
  AND s.tournament_table_id=h.tournament_table_id AND s.table_session_id=h.table_session_id
  AND s.seat_number=NEW.seat_number AND s.player_id=NEW.player_id AND s.entry_number=NEW.entry_number
 JOIN public.tournament_entries e ON e.id=s.entry_id AND e.tournament_id=t.id
  AND e.player_id=s.player_id AND e.entry_no=s.entry_number
 JOIN floor_private.club_member_portrait_versions v ON v.club_id=t.club_id AND v.is_current
  AND v.member_id=floor_private.club_portrait_member(t.club_id,e.member_id,e.player_id)
 WHERE h.id=NEW.hand_id AND h.tournament_id=NEW.tournament_id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION floor_private.club_portrait_member(uuid,uuid,uuid),
 floor_private.club_portrait_url(uuid), floor_private.snapshot_club_player_portrait() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER snapshot_club_player_portrait BEFORE INSERT ON public.hand_players
 FOR EACH ROW EXECUTE FUNCTION floor_private.snapshot_club_player_portrait();
COMMIT;
