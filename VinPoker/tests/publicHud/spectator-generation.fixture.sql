-- Isolated generation/outbox fixture. realtime.send records its arguments;
-- this fixture is NOT a real WebSocket transport or business-payout proof.
CREATE SEQUENCE spectator_projection_v2.publication_revision_seq;
ALTER TABLE spectator_projection_v2.publications ADD COLUMN source_vector jsonb NOT NULL DEFAULT '{}',
 ADD COLUMN publication_revision bigint NOT NULL DEFAULT nextval('spectator_projection_v2.publication_revision_seq'),
 ADD COLUMN published_at timestamptz NOT NULL DEFAULT clock_timestamp();
CREATE TABLE spectator_projection_v2.entity_markers(tournament_id uuid NOT NULL,component text NOT NULL,entity_key text NOT NULL,
 source_revision bigint NOT NULL DEFAULT 1,source_changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(tournament_id,component,entity_key));
CREATE TABLE spectator_projection_v2.work_groups(tournament_id uuid NOT NULL,component text NOT NULL,group_key text NOT NULL,
 dirty_ids jsonb NOT NULL DEFAULT '[]',source_vector jsonb NOT NULL DEFAULT '{}',oldest_pending_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(),claimed_until timestamptz,fencing_token uuid,attempts integer NOT NULL DEFAULT 0,last_error text,
 PRIMARY KEY(tournament_id,component,group_key));
CREATE TABLE spectator_projection_v2.notification_throttle(tournament_id uuid PRIMARY KEY,last_sent_at timestamptz NOT NULL DEFAULT '-infinity');
CREATE TABLE public.tournament_tables(id uuid PRIMARY KEY,tournament_id uuid);
ALTER TABLE public.tournament_tables ADD COLUMN table_session_id uuid;
CREATE TABLE public.table_sessions(id uuid PRIMARY KEY,closed_at timestamptz);
ALTER TABLE public.tournament_hands ADD COLUMN tracker_small_blind bigint,ADD COLUMN tracker_big_blind bigint,
 ADD COLUMN tracker_level_number integer,ADD COLUMN tracker_bba bigint;
CREATE FUNCTION public.get_public_tournament_hand_v2(p_tournament_id uuid,p_hand_id uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('id',p_hand_id) $$;
CREATE OR REPLACE FUNCTION public.get_public_tournament_table_live_or_last_hand_v2(p_tournament_id uuid, p_tournament_table_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
WITH scope AS (
  SELECT tt.id AS table_id, tt.table_session_id, ts.closed_at
  FROM public.tournament_tables tt
  JOIN public.tournaments t ON t.id = tt.tournament_id
  LEFT JOIN public.table_sessions ts ON ts.id = tt.table_session_id
  WHERE tt.id = p_tournament_table_id
    AND tt.tournament_id = p_tournament_id
    AND t.deleted_at IS NULL
), picked AS (
  SELECT s.table_id, s.table_session_id, s.closed_at, h.id AS hand_id, h.display_state
  FROM scope s
  LEFT JOIN LATERAL (
    SELECT candidate.id, candidate.display_state
    FROM (
      SELECT th.id, th.created_at, 'live'::text AS display_state, 0 AS priority
      FROM public.tournament_hands th
      WHERE th.tournament_id = p_tournament_id
        AND th.tournament_table_id = s.table_id
        AND th.table_session_id = s.table_session_id
        AND th.status = 'in_progress'
        AND NOT COALESCE(th.is_voided, false)
      UNION ALL
      SELECT th.id, th.created_at, 'last_completed'::text AS display_state, 1 AS priority
      FROM public.tournament_hands th
      WHERE th.tournament_id = p_tournament_id
        AND th.tournament_table_id = s.table_id
        AND th.table_session_id = s.table_session_id
        AND th.status <> 'in_progress'
        AND NOT COALESCE(th.is_voided, false)
    ) candidate
    ORDER BY candidate.priority, candidate.created_at DESC, candidate.id DESC
    LIMIT 1
  ) h ON s.table_session_id IS NOT NULL AND s.closed_at IS NULL
)
SELECT CASE
  WHEN p_tournament_id IS NULL OR p_tournament_table_id IS NULL
    THEN jsonb_build_object('error', 'invalid_request')
  WHEN NOT EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = p_tournament_id AND t.deleted_at IS NULL)
    THEN jsonb_build_object('access', 'revoked')
  WHEN NOT EXISTS (SELECT 1 FROM scope)
    THEN jsonb_build_object('error', 'table_out_of_scope')
  ELSE COALESCE((
    SELECT jsonb_build_object(
      'access', 'public',
      'tableId', p.table_id,
      'tableSessionId', p.table_session_id,
      'state', CASE
        WHEN p.table_session_id IS NULL THEN 'inactive'
        WHEN p.closed_at IS NOT NULL THEN 'closed'
        WHEN p.hand_id IS NULL THEN 'waiting'
        ELSE p.display_state
      END,
      'hand', CASE WHEN p.hand_id IS NULL THEN NULL
        ELSE (
          SELECT public.get_public_tournament_hand_v2(p_tournament_id, h.id)
            || jsonb_build_object(
              'smallBlind', h.tracker_small_blind,
              'bigBlind', h.tracker_big_blind,
              'levelNumber', h.tracker_level_number,
              'ante', h.tracker_bba
            )
          FROM public.tournament_hands h WHERE h.id = p.hand_id
        )
      END
    )
    FROM picked p
  ), jsonb_build_object('error', 'table_out_of_scope'))
END;
$function$
;
CREATE SCHEMA floor_private;
CREATE FUNCTION floor_private.payout_public_rows_after_payment_v1(tournament uuid,payload jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT payload||jsonb_build_object('maskChecked',true) $$;
CREATE SCHEMA IF NOT EXISTS realtime;
CREATE TABLE realtime.fixture_messages(payload jsonb,event text,topic text,private boolean);
DO $bootstrap$ BEGIN
 IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN
  EXECUTE $definition$ CREATE FUNCTION realtime.send(payload jsonb,event text,topic text,private boolean) RETURNS void LANGUAGE sql AS $$ INSERT INTO realtime.fixture_messages VALUES(payload,event,topic,private) $$ $definition$;
 END IF;
END $bootstrap$;
CREATE OR REPLACE FUNCTION spectator_projection_v2.mark_dirty(p_tournament_id uuid, p_component text, p_entity_key text, p_group_key text DEFAULT 'event'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_revision bigint;
  v_dirty_id text := gen_random_uuid()::text;
BEGIN
  IF p_tournament_id IS NULL OR p_component NOT IN ('tables','ranking','payout','visibility') THEN RETURN; END IF;
  INSERT INTO spectator_projection_v2.entity_markers(tournament_id, component, entity_key)
  VALUES (p_tournament_id, p_component, COALESCE(NULLIF(p_entity_key,''),'set'))
  ON CONFLICT (tournament_id, component, entity_key) DO UPDATE
    SET source_revision = spectator_projection_v2.entity_markers.source_revision + 1,
        source_changed_at = clock_timestamp()
  RETURNING source_revision INTO v_revision;

  INSERT INTO spectator_projection_v2.work_groups(tournament_id, component, group_key, dirty_ids, source_vector)
  VALUES (p_tournament_id, p_component, p_group_key,
          jsonb_build_array(v_dirty_id), jsonb_build_object(COALESCE(NULLIF(p_entity_key,''),'set'), v_revision::text))
  ON CONFLICT (tournament_id, component, group_key) DO UPDATE
    SET dirty_ids = spectator_projection_v2.work_groups.dirty_ids || EXCLUDED.dirty_ids,
        source_vector = spectator_projection_v2.work_groups.source_vector || EXCLUDED.source_vector,
        oldest_pending_at = LEAST(spectator_projection_v2.work_groups.oldest_pending_at, EXCLUDED.oldest_pending_at),
        available_at = LEAST(spectator_projection_v2.work_groups.available_at, EXCLUDED.available_at),
        claimed_until = NULL, fencing_token = NULL, attempts = 0, last_error = NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.publish_public_spectator_projection_v2(p_tournament_id uuid, p_component text, p_group_key text, p_fencing_token uuid, p_source_vector jsonb, p_payload jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_current jsonb; v_notify boolean:=false; BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM spectator_projection_v2.work_groups w
   WHERE w.tournament_id=p_tournament_id AND w.component=p_component AND w.group_key=p_group_key
     AND w.fencing_token=p_fencing_token AND w.claimed_until>clock_timestamp()
   FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RETURN false; END IF;
  -- Lock the exact source markers in a deterministic order before comparing
  -- the vector. This fences concurrent publication without touching business rows.
  PERFORM 1 FROM spectator_projection_v2.entity_markers m
   WHERE m.tournament_id=p_tournament_id AND m.component=p_component
   ORDER BY m.entity_key FOR UPDATE NOWAIT;
  SELECT COALESCE(jsonb_object_agg(m.entity_key,m.source_revision::text),'{}'::jsonb) INTO v_current
    FROM spectator_projection_v2.entity_markers m WHERE m.tournament_id=p_tournament_id AND m.component=p_component;
  IF v_current IS DISTINCT FROM p_source_vector THEN
    UPDATE spectator_projection_v2.work_groups SET claimed_until=NULL,fencing_token=NULL,available_at=clock_timestamp() WHERE tournament_id=p_tournament_id AND component=p_component AND group_key=p_group_key;
    RETURN false;
  END IF;
  INSERT INTO spectator_projection_v2.publications(tournament_id,component,source_vector,payload)
  VALUES(p_tournament_id,p_component,p_source_vector,p_payload)
  ON CONFLICT(tournament_id,component) DO UPDATE SET source_vector=EXCLUDED.source_vector,payload=EXCLUDED.payload,
    publication_revision=nextval('spectator_projection_v2.publication_revision_seq'),published_at=clock_timestamp();
  -- The payload is a full component snapshot. Clear every older group whose
  -- requested revisions are covered by this exact source vector. A concurrent
  -- newer revision cannot pass this predicate and remains pending.
  DELETE FROM spectator_projection_v2.work_groups w
  WHERE w.tournament_id=p_tournament_id AND w.component=p_component
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_each_text(w.source_vector) requested
      WHERE p_source_vector->>requested.key IS NULL
         OR (p_source_vector->>requested.key)::bigint < requested.value::bigint
    );
  INSERT INTO spectator_projection_v2.notification_throttle(tournament_id,last_sent_at) VALUES(p_tournament_id,clock_timestamp())
  ON CONFLICT(tournament_id) DO UPDATE SET last_sent_at=EXCLUDED.last_sent_at
    WHERE spectator_projection_v2.notification_throttle.last_sent_at<=clock_timestamp()-interval '1 second'
  RETURNING true INTO v_notify;
  IF COALESCE(v_notify,false) THEN
    PERFORM realtime.send(jsonb_build_object('tournamentId',p_tournament_id),'changed','public:tournament-viewer-v2:'||p_tournament_id::text,false);
  END IF;
  RETURN true;
EXCEPTION WHEN lock_not_available THEN RETURN false;
END; $function$
;

CREATE OR REPLACE FUNCTION public.get_public_tournament_viewer_snapshot_v2(p_tournament_id uuid, p_table_ids uuid[] DEFAULT ARRAY[]::uuid[], p_sections text[] DEFAULT ARRAY['tables'::text, 'ranking'::text, 'payout'::text], p_known_revisions jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_sections jsonb := '{}'::jsonb; v_component text; v_pub record; v_now timestamptz:=clock_timestamp(); v_oldest timestamptz; v_source_changed timestamptz; v_source_vector jsonb; v_payload jsonb; v_unchanged boolean; v_public_revision text; BEGIN
  IF p_tournament_id IS NULL OR p_table_ids IS NULL OR p_sections IS NULL OR cardinality(p_table_ids)>16 OR EXISTS(SELECT 1 FROM unnest(p_sections) s WHERE s NOT IN ('tables','ranking','payout')) THEN RAISE EXCEPTION 'invalid_request'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.tournaments t WHERE t.id=p_tournament_id AND t.deleted_at IS NULL) THEN
    RETURN jsonb_build_object('ok',true,'access','revoked','tournamentId',p_tournament_id,'sections','{}'::jsonb);
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(p_table_ids) x(id) LEFT JOIN public.tournament_tables tt ON tt.id=x.id AND tt.tournament_id=p_tournament_id WHERE tt.id IS NULL) THEN RAISE EXCEPTION 'table_out_of_scope'; END IF;
  FOREACH v_component IN ARRAY p_sections LOOP
    SELECT p.* INTO v_pub FROM spectator_projection_v2.publications p WHERE p.tournament_id=p_tournament_id AND p.component=v_component;
    SELECT min(w.oldest_pending_at) INTO v_oldest FROM spectator_projection_v2.work_groups w WHERE w.tournament_id=p_tournament_id AND w.component=v_component;
    SELECT COALESCE(jsonb_object_agg(m.entity_key,m.source_revision::text),'{}'::jsonb),max(m.source_changed_at)
      INTO v_source_vector,v_source_changed FROM spectator_projection_v2.entity_markers m WHERE m.tournament_id=p_tournament_id AND m.component=v_component;
    v_payload:=COALESCE(v_pub.payload,'{}'::jsonb);
    -- A payout source change invalidates cached confirmation immediately. The
    -- worker may still be catching up, but stale names must not remain official.
    IF v_component='payout' AND v_source_vector IS DISTINCT FROM COALESCE(v_pub.source_vector,'{}'::jsonb) THEN
      v_payload:=jsonb_set(v_payload,'{items}',COALESCE((SELECT jsonb_agg(
        i || jsonb_build_object('playerName',NULL,'avatarUrl',NULL,'resultStatus','open'))
        FROM jsonb_array_elements(COALESCE(v_payload->'items','[]'::jsonb)) i),'[]'::jsonb));
    END IF;
    v_public_revision:=coalesce(v_pub.publication_revision::text,'0');
    IF v_component='payout' THEN
      v_payload:=floor_private.payout_public_rows_after_payment_v1(p_tournament_id,v_payload);
      v_public_revision:=md5(v_public_revision||':'||v_payload::text);
    END IF;
    v_unchanged:=COALESCE(p_known_revisions->>v_component,'')=v_public_revision
      AND v_source_vector=COALESCE(v_pub.source_vector,'{}'::jsonb);
    IF v_unchanged THEN
      v_payload:='{}'::jsonb;
    ELSIF v_component='tables' THEN
      v_payload:=jsonb_set(v_payload,'{catalog}',COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'tableId',i->>'tableId','name',i->>'name','playerCount',jsonb_array_length(COALESCE(i->'players','[]'::jsonb)),
        'searchPlayers',COALESCE((SELECT jsonb_agg(player->>'name') FROM jsonb_array_elements(COALESCE(i->'players','[]'::jsonb)) player),'[]'::jsonb)))
        FROM jsonb_array_elements(COALESCE(v_payload->'items','[]'::jsonb)) i),'[]'::jsonb));
      v_payload:=jsonb_set(v_payload,'{items}',COALESCE((SELECT jsonb_agg(i) FROM jsonb_array_elements(COALESCE(v_payload->'items','[]'::jsonb)) i WHERE (i->>'tableId')::uuid=ANY(p_table_ids)),'[]'::jsonb));
    END IF;
    v_sections:=v_sections||jsonb_build_object(v_component,v_payload||jsonb_build_object(
      'revision',v_public_revision,
      'unchanged',v_unchanged,
      'freshness',jsonb_build_object('sourceRevision',v_source_vector::text,'projectedSourceRevision',COALESCE(v_pub.source_vector,'{}'::jsonb)::text,
        'sourceChangedAt',v_source_changed,'publishedAt',v_pub.published_at,'serverCheckedAt',v_now,'oldestPendingAt',v_oldest,
        'state',CASE WHEN v_source_vector=COALESCE(v_pub.source_vector,'{}'::jsonb) AND v_oldest IS NULL THEN 'current' WHEN v_oldest IS NOT NULL AND v_now-v_oldest>interval '10 seconds' THEN 'stale' ELSE 'updating' END)));
  END LOOP;
  RETURN jsonb_build_object('ok',true,'access','public','tournamentId',p_tournament_id,'sections',v_sections);
END; $function$
;

CREATE OR REPLACE FUNCTION public.get_public_spectator_projection_source_v2(p_tournament_id uuid, p_component text, p_fencing_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_payload jsonb;
  v_vector jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM spectator_projection_v2.work_groups w
    WHERE w.tournament_id = p_tournament_id
      AND w.component = p_component
      AND w.fencing_token = p_fencing_token
      AND w.claimed_until > clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'lease_expired';
  END IF;

  SELECT COALESCE(jsonb_object_agg(m.entity_key, m.source_revision::text), '{}'::jsonb)
    INTO v_vector
  FROM spectator_projection_v2.entity_markers m
  WHERE m.tournament_id = p_tournament_id AND m.component = p_component;

  IF p_component = 'tables' THEN
    SELECT jsonb_build_object(
      'items', COALESCE(jsonb_agg(x ORDER BY x->>'name'), '[]'::jsonb),
      'removed', '[]'::jsonb
    ) INTO v_payload
    FROM (
      SELECT jsonb_build_object(
        'tableId', tt.id,
        'tableSessionId', tt.table_session_id,
        'name', tt.table_name,
        'handId', h.id,
        'handNumber', h.hand_number,
        'buttonSeat', h.button_seat,
        'street', CASE WHEN h.id IS NULL THEN NULL ELSE CASE jsonb_array_length(COALESCE(h.community_cards, '[]'::jsonb))
          WHEN 0 THEN 'preflop' WHEN 3 THEN 'flop' WHEN 4 THEN 'turn' ELSE 'river' END END,
        'board', CASE WHEN h.id IS NULL THEN NULL ELSE COALESCE(h.community_cards, '[]'::jsonb) END,
        'pot', CASE WHEN h.id IS NULL THEN NULL ELSE h.pot_size END,
        'actions', CASE WHEN h.id IS NULL THEN NULL ELSE COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'playerId', a.player_id, 'entryNumber', a.entry_number, 'street', a.street,
            'actionType', a.action_type, 'amount', a.action_amount, 'order', a.action_order
          ) ORDER BY a.action_order)
          FROM public.hand_actions a WHERE a.hand_id = h.id
        ), '[]'::jsonb) END,
        'smallBlind', CASE WHEN h.id IS NULL THEN current_level.small_blind ELSE h.tracker_small_blind END,
        'bigBlind', CASE WHEN h.id IS NULL THEN current_level.big_blind ELSE h.tracker_big_blind END,
        'levelNumber', CASE WHEN h.id IS NULL THEN current_level.level_number ELSE h.tracker_level_number END,
        'ante', CASE WHEN h.id IS NULL THEN current_level.ante ELSE h.tracker_bba END,
        'trackerState', CASE
          WHEN tt.table_session_id IS NULL THEN 'inactive'
          WHEN session_row.closed_at IS NOT NULL THEN 'closed'
          WHEN h.id IS NULL THEN 'waiting'
          ELSE h.display_state
        END,
        'latestAction', CASE WHEN h.id IS NULL THEN NULL ELSE (
          SELECT jsonb_build_object(
            'playerId', a.player_id, 'entryNumber', a.entry_number,
            'actionType', a.action_type, 'amount', a.action_amount
          ) FROM public.hand_actions a WHERE a.hand_id = h.id ORDER BY a.action_order DESC LIMIT 1
        ) END,
        'players', CASE WHEN h.id IS NOT NULL THEN COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'entryId', e.id, 'playerId', hp.player_id, 'entryNumber', hp.entry_number,
            'seatNumber', hp.seat_number, 'name', COALESCE(NULLIF(hp.player_name, ''), 'Người chơi'),
            'avatarUrl', hp.avatar_url, 'startingStack', hp.starting_stack,
            'stack', CASE WHEN h.display_state = 'last_completed' THEN hp.ending_stack ELSE NULL END,
            'holeCards', COALESCE(hp.hole_cards, '[]'::jsonb),
            'isFolded', EXISTS (SELECT 1 FROM public.hand_actions a WHERE a.hand_id = h.id AND a.player_id = hp.player_id AND a.action_type = 'fold'),
            'isAllIn', EXISTS (SELECT 1 FROM public.hand_actions a WHERE a.hand_id = h.id AND a.player_id = hp.player_id AND a.action_type = 'all_in')
          ) ORDER BY hp.seat_number)
          FROM public.hand_players hp
          LEFT JOIN public.tournament_entries e ON e.tournament_id = p_tournament_id
            AND e.player_id = hp.player_id AND e.entry_no = hp.entry_number
          WHERE hp.hand_id = h.id
        ), '[]'::jsonb) ELSE '[]'::jsonb END
      ) AS x
      FROM public.tournament_tables tt
      JOIN public.tournaments tour ON tour.id = tt.tournament_id
      LEFT JOIN public.table_sessions session_row ON session_row.id = tt.table_session_id
      LEFT JOIN LATERAL (
        SELECT lv.small_blind, lv.big_blind, lv.ante, lv.level_number
        FROM public.tournament_levels lv
        WHERE lv.tournament_id = tour.id
          AND ((tour.current_level_id IS NOT NULL AND lv.id = tour.current_level_id)
            OR (tour.current_level_id IS NULL AND lv.level_number = tour.current_level))
        ORDER BY lv.id LIMIT 1
      ) current_level ON true
      LEFT JOIN LATERAL (
        SELECT candidate.*
        FROM (
          SELECT th.*, 'live'::text AS display_state, 0 AS priority
          FROM public.tournament_hands th
          WHERE th.tournament_id = p_tournament_id
            AND th.tournament_table_id = tt.id
            AND th.table_session_id = tt.table_session_id
            AND th.status = 'in_progress'
            AND NOT COALESCE(th.is_voided, false)
          UNION ALL
          SELECT th.*, 'last_completed'::text AS display_state, 1 AS priority
          FROM public.tournament_hands th
          WHERE th.tournament_id = p_tournament_id
            AND th.tournament_table_id = tt.id
            AND th.table_session_id = tt.table_session_id
            AND th.status <> 'in_progress'
            AND NOT COALESCE(th.is_voided, false)
        ) candidate
        ORDER BY candidate.priority, candidate.created_at DESC, candidate.id DESC
        LIMIT 1
      ) h ON tt.table_session_id IS NOT NULL AND session_row.closed_at IS NULL
      WHERE tt.tournament_id = p_tournament_id
    ) table_rows;
  ELSIF p_component = 'ranking' THEN
    SELECT jsonb_build_object(
      'bigBlind', (SELECT l.big_blind FROM public.tournaments t
        LEFT JOIN public.tournament_levels l ON l.tournament_id = t.id
          AND ((t.current_level_id IS NOT NULL AND l.id = t.current_level_id)
            OR (t.current_level_id IS NULL AND l.level_number = t.current_level))
        WHERE t.id = p_tournament_id LIMIT 1),
      'items', COALESCE(jsonb_agg(x ORDER BY (x->>'chips')::numeric DESC NULLS LAST), '[]'::jsonb)
    ) INTO v_payload
    FROM (
      SELECT jsonb_build_object(
        'entryId', e.id, 'playerId', c.player_id, 'entryNumber', c.entry_number,
        'name', COALESCE(NULLIF(s.player_name, ''), 'Người chơi'), 'avatarUrl', s.avatar_url,
        'chips', c.chip_count, 'updatedAt', c.updated_at
      ) x
      FROM public.tournament_chip_counts c
      LEFT JOIN public.tournament_entries e ON e.tournament_id = c.tournament_id
        AND e.player_id = c.player_id AND e.entry_no = c.entry_number
      LEFT JOIN LATERAL (
        SELECT seat.player_name, seat.avatar_url FROM public.tournament_seats seat
        WHERE seat.tournament_id = c.tournament_id
          AND ((e.id IS NOT NULL AND seat.entry_id = e.id)
            OR (e.id IS NULL AND seat.player_id = c.player_id AND seat.entry_number = c.entry_number))
        ORDER BY seat.is_active DESC, seat.created_at DESC LIMIT 1
      ) s ON true
      WHERE c.tournament_id = p_tournament_id AND c.chip_count > 0
    ) ranking_rows;
  ELSIF p_component = 'payout' THEN
    SELECT jsonb_build_object(
      'published', COUNT(*) > 0,
      'items', COALESCE(jsonb_agg(x ORDER BY (x->>'fromPlace')::int), '[]'::jsonb)
    ) INTO v_payload
    FROM (
      SELECT jsonb_build_object(
        'fromPlace', p.position, 'toPlace', p.position, 'amountPerPlayer', p.amount,
        'playerName', CASE WHEN e.finished_place = p.position THEN COALESCE(NULLIF(s.player_name, ''), NULL) ELSE NULL END,
        'avatarUrl', CASE WHEN e.finished_place = p.position THEN s.avatar_url ELSE NULL END,
        'resultStatus', CASE WHEN e.finished_place = p.position THEN 'official' ELSE 'open' END
      ) x
      FROM public.tournament_prizes p
      LEFT JOIN LATERAL (
        SELECT candidate.tournament_id, (array_agg(candidate.player_id))[1] AS player_id,
          (array_agg(candidate.entry_no))[1] AS entry_no, candidate.finished_place
        FROM public.tournament_entries candidate
        WHERE candidate.tournament_id = p.tournament_id AND candidate.finished_place = p.position
        GROUP BY candidate.tournament_id, candidate.finished_place
        HAVING count(*) = 1
      ) e ON true
      LEFT JOIN LATERAL (
        SELECT seat.player_name, seat.avatar_url FROM public.tournament_seats seat
        WHERE seat.tournament_id = e.tournament_id
          AND seat.player_id = e.player_id AND seat.entry_number = e.entry_no
        ORDER BY seat.is_active DESC, seat.created_at DESC LIMIT 1
      ) s ON true
      WHERE p.tournament_id = p_tournament_id
    ) payout_rows;
  ELSE
    v_payload := '{}'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'tournamentId', p_tournament_id,
    'component', p_component,
    'sourceVector', v_vector,
    'payload', COALESCE(v_payload, '{}'::jsonb)
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.dispatch_public_spectator_projection_v2()
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_url text; v_secret text; v_request_id bigint; BEGIN
  IF NOT EXISTS(SELECT 1 FROM spectator_projection_v2.work_groups w WHERE w.available_at<=clock_timestamp() AND (w.claimed_until IS NULL OR w.claimed_until<clock_timestamp())) THEN RETURN NULL; END IF;
  v_url:=COALESCE(NULLIF(current_setting('app.supabase_url',true),''),'https://orlesggcjamwuknxwcpk.supabase.co');
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name='PUBLIC_SPECTATOR_WORKER_SECRET';
  IF v_secret IS NULL OR btrim(v_secret)='' THEN RAISE LOG 'spectator v2 dispatcher skipped: secret missing'; RETURN NULL; END IF;
  SELECT net.http_post(url:=v_url||'/functions/v1/public-spectator-projector-v2',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_secret),
    body:='{}'::jsonb,timeout_milliseconds:=8000) INTO v_request_id;
  RETURN v_request_id;
EXCEPTION WHEN OTHERS THEN RAISE LOG 'spectator v2 dispatcher failed: %',SQLERRM; RETURN NULL;
END; $function$
;
CREATE OR REPLACE FUNCTION spectator_projection_v2.mark_hand_child_dirty()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_row jsonb;
  v_tid uuid;
  v_hand_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := to_jsonb(OLD); ELSE v_row := to_jsonb(NEW); END IF;
  v_hand_id := NULLIF(v_row->>'hand_id','')::uuid;
  SELECT h.tournament_id INTO v_tid FROM public.tournament_hands h WHERE h.id = v_hand_id;
  PERFORM spectator_projection_v2.mark_dirty(v_tid, 'tables', v_hand_id::text, v_hand_id::text);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION spectator_projection_v2.mark_row_dirty()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_row jsonb;
  v_tid uuid;
  v_entity text;
  v_component text := TG_ARGV[0];
  v_group text;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := to_jsonb(OLD); ELSE v_row := to_jsonb(NEW); END IF;
  v_tid := NULLIF(COALESCE(v_row->>'tournament_id',CASE WHEN TG_TABLE_NAME='tournaments' THEN v_row->>'id' END),'')::uuid;
  v_entity := COALESCE(v_row->>'id', v_row->>'player_id', v_row->>'position', 'set');
  -- Ranking and payout rows written by one business transaction must publish as
  -- one unit. pg_current_xact_id() is stable for every trigger in that commit.
  v_group := CASE WHEN v_component IN ('ranking','payout') THEN 'tx:' || pg_current_xact_id()::text ELSE COALESCE(NULLIF(v_row->>'hand_id',''), v_entity) END;
  PERFORM spectator_projection_v2.mark_dirty(v_tid, v_component, v_entity, v_group);
  IF TG_OP = 'DELETE' OR TG_OP = 'INSERT' THEN
    PERFORM spectator_projection_v2.mark_dirty(v_tid, v_component, 'set', v_group);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION spectator_projection_v2.fixture_mark_tour() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM spectator_projection_v2.mark_dirty(NEW.id,'visibility',NEW.id::text); RETURN NEW; END $$;
CREATE TRIGGER spectator_v2_tournaments_dirty AFTER INSERT OR UPDATE ON public.tournaments FOR EACH ROW EXECUTE FUNCTION spectator_projection_v2.fixture_mark_tour();
REVOKE ALL ON SCHEMA spectator_projection_v2 FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA spectator_projection_v2 TO service_role;
REVOKE ALL ON FUNCTION public.get_public_spectator_projection_source_v2(uuid,text,uuid),public.publish_public_spectator_projection_v2(uuid,text,text,uuid,jsonb,jsonb),public.dispatch_public_spectator_projection_v2() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_spectator_projection_source_v2(uuid,text,uuid),public.publish_public_spectator_projection_v2(uuid,text,text,uuid,jsonb,jsonb),public.dispatch_public_spectator_projection_v2() TO service_role;
