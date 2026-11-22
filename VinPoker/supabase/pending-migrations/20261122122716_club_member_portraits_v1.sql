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

CREATE FUNCTION floor_private.club_portrait_staff(p_club uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND
  (EXISTS (SELECT 1 FROM public.club_floors WHERE club_id=p_club AND user_id=auth.uid())
   OR EXISTS (SELECT 1 FROM public.club_cashiers WHERE club_id=p_club AND user_id=auth.uid())
   OR EXISTS (SELECT 1 FROM public.clubs WHERE id=p_club AND owner_id=auth.uid()))
$$;

CREATE FUNCTION floor_private.club_portrait_upload_allowed(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS (SELECT 1 FROM floor_private.club_member_portrait_versions v
  JOIN public.club_members m ON m.id=v.member_id AND m.club_id=v.club_id
  WHERE v.id=CASE WHEN p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]jpg$'
    THEN left(p_name,36)::uuid END
   AND v.actor_id=auth.uid() AND v.published_at IS NULL
   AND v.created_at > now()-interval '30 minutes' AND floor_private.club_portrait_staff(m.club_id))
$$;
REVOKE ALL ON FUNCTION floor_private.club_portrait_staff(uuid),
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

CREATE FUNCTION public.club_player_portrait_v1(p_context jsonb,p_action text DEFAULT 'read',
 p_expected uuid DEFAULT NULL,p_upload uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 club uuid; member uuid; member_name text; current_id uuid;
 version floor_private.club_member_portrait_versions%ROWTYPE;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('read','prepare','publish') OR auth.uid() IS NULL THEN
  RAISE EXCEPTION 'portrait_forbidden' USING ERRCODE='42501'; END IF;
 IF p_context->>'kind'='member' THEN
  club:=(p_context->>'club')::uuid; member:=(p_context->>'member')::uuid;
 ELSIF p_context->>'kind' IN ('seat','booking') THEN
  SELECT t.club_id INTO club FROM public.tournaments t WHERE t.id=(p_context->>'tour')::uuid;
 ELSE RAISE EXCEPTION 'portrait_unknown_context'; END IF;
 IF NOT coalesce(floor_private.club_portrait_staff(club),false) THEN
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
  IF FOUND AND (version.actor_id<>auth.uid() OR version.club_id<>club OR version.member_id<>member
      OR version.replaces IS DISTINCT FROM p_expected) THEN RAISE EXCEPTION 'portrait_upload_conflict'; END IF;
  IF current_id IS DISTINCT FROM p_upload THEN
   IF current_id IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'portrait_changed'; END IF;
   IF version.id IS NOT NULL AND (version.published_at IS NOT NULL OR version.created_at<=now()-interval '30 minutes')
    THEN RAISE EXCEPTION 'portrait_upload_expired'; END IF;
   IF p_action='prepare' THEN
    IF version.id IS NULL THEN
     INSERT INTO floor_private.club_member_portrait_versions(id,club_id,member_id,actor_id,replaces)
      VALUES(p_upload,club,member,auth.uid(),p_expected);
    END IF;
   ELSE
    IF version.id IS NULL OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id='club-player-portraits'
     AND o.name=p_upload::text||'.jpg' AND o.owner_id=auth.uid()::text
     AND o.metadata->>'mimetype'='image/jpeg' AND (o.metadata->>'size')::bigint BETWEEN 1 AND 131072)
     THEN RAISE EXCEPTION 'portrait_upload_missing'; END IF;
    UPDATE floor_private.club_member_portrait_versions SET is_current=false WHERE id=current_id;
    UPDATE floor_private.club_member_portrait_versions SET is_current=true,published_at=now() WHERE id=p_upload;
    -- Only active seats bound to this member. Older hand_players rows are immutable snapshots.
    UPDATE public.tournament_seats s SET avatar_url=floor_private.club_portrait_url(p_upload)
    FROM public.tournament_entries e JOIN public.tournaments t ON t.id=e.tournament_id
    WHERE t.club_id=club AND e.id=s.entry_id AND e.tournament_id=s.tournament_id AND e.player_id=s.player_id
     AND e.entry_no=s.entry_number AND s.is_active
     AND (e.member_id=member OR (e.member_id IS NULL AND EXISTS(SELECT 1 FROM public.club_members m
         WHERE m.id=member AND m.player_user_id=e.player_id)
         AND floor_private.club_portrait_member(club,NULL,e.player_id)=member))
     AND (s.avatar_url IS NULL OR s.avatar_url LIKE '%/storage/v1/object/public/club-player-portraits/%');
    current_id:=p_upload;
   END IF;
  END IF;
 END IF;
 RETURN jsonb_build_object('member',member,'club',club,'name',member_name,'version',current_id,
  'url',floor_private.club_portrait_url(current_id));
END $$;
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
CREATE FUNCTION floor_private.seat_club_portrait()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.is_active AND (nullif(NEW.avatar_url,'') IS NULL OR NEW.avatar_url LIKE '%/storage/v1/object/public/club-player-portraits/%') THEN
  NEW.avatar_url:=floor_private.club_portrait_for_entry(NEW.tournament_id,NEW.entry_id,NEW.player_id,NEW.entry_number);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER seat_club_portrait BEFORE INSERT OR UPDATE OF entry_id,player_id,tournament_id,entry_number,is_active ON public.tournament_seats
 FOR EACH ROW EXECUTE FUNCTION floor_private.seat_club_portrait();

CREATE FUNCTION floor_private.link_entry_club_portrait()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE photo text;
BEGIN
 photo:=floor_private.club_portrait_for_entry(NEW.tournament_id,NEW.id,NEW.player_id,NEW.entry_no);
 UPDATE public.tournament_seats s SET avatar_url=photo
  WHERE s.entry_id=NEW.id AND s.tournament_id=NEW.tournament_id AND s.player_id=NEW.player_id AND s.entry_number=NEW.entry_no
   AND s.is_active AND s.avatar_url IS DISTINCT FROM photo
   AND (s.avatar_url IS NULL OR s.avatar_url LIKE '%/storage/v1/object/public/club-player-portraits/%');
 RETURN NEW;
END $$;
CREATE TRIGGER linked_entry_club_portrait AFTER UPDATE OF member_id ON public.tournament_entries
 FOR EACH ROW WHEN (OLD.member_id IS DISTINCT FROM NEW.member_id) EXECUTE FUNCTION floor_private.link_entry_club_portrait();
REVOKE ALL ON FUNCTION floor_private.club_portrait_for_entry(uuid,uuid,uuid,integer),
 floor_private.seat_club_portrait(),floor_private.link_entry_club_portrait() FROM PUBLIC,anon,authenticated;


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
