-- Read-only financial projections. Never changes receipts, money lists or payouts.
-- Recovery: revoke these additive RPCs through a new reviewed migration.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$BEGIN
 IF current_user<>'postgres' OR to_regprocedure('public.get_owner_player_financial_report_v1(uuid,uuid,text,integer,integer,integer)') IS NOT NULL
 OR to_regprocedure('public.get_public_player_paid_winnings_v1(uuid)') IS NOT NULL
 OR to_regprocedure('floor_private.tournament_prize_result_contexts_v1(uuid)') IS NULL
 THEN RAISE EXCEPTION 'player_finance_catalog_or_dependency'; END IF;
END $$;

CREATE FUNCTION private.club_financial_customer_ref_v1(p_club_id uuid,p_player_id uuid,p_member_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE n integer; result uuid;
BEGIN
 IF p_member_id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.club_members WHERE id=p_member_id AND club_id=p_club_id)
  THEN RAISE EXCEPTION 'financial_member_out_of_club'; END IF;
  RETURN p_member_id;
 END IF;
 SELECT count(*),(min(id::text))::uuid INTO n,result FROM public.club_members WHERE club_id=p_club_id AND player_user_id=p_player_id;
 IF n>1 THEN RAISE EXCEPTION 'financial_member_ambiguous'; END IF;
 RETURN coalesce(result,p_player_id);
END $$;
REVOKE ALL ON FUNCTION private.club_financial_customer_ref_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.player_cashier_prize_facts_v1(p_club_id uuid,p_player_id uuid,p_pending boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE t public.tournaments; payment public.tournament_prize_payments; e public.tournament_entries;
 c record; reversal record; ctx jsonb; result jsonb:='[]'; who uuid; member uuid; entry uuid; n integer;
 verified boolean; paid numeric; total numeric;
BEGIN
 FOR t IN SELECT * FROM public.tournaments x WHERE (p_club_id IS NULL OR x.club_id=p_club_id)
  AND (p_player_id IS NULL OR EXISTS(SELECT 1 FROM public.tournament_entries z WHERE z.tournament_id=x.id AND z.player_id=p_player_id)
   OR EXISTS(SELECT 1 FROM private.multi_day_payment_commits_v1 z WHERE z.tournament_id=x.id AND z.player_id=p_player_id)
   OR EXISTS(SELECT 1 FROM private.multi_day_individual_payment_commits_v1 z WHERE z.tournament_id=x.id AND z.player_id=p_player_id)) LOOP
  FOR payment IN SELECT * FROM public.tournament_prize_payments x WHERE x.tournament_id=t.id AND x.club_id=t.club_id AND x.status='paid' LOOP
   who:=NULL; member:=NULL; entry:=NULL; verified:=false;
   IF payment.multi_day_participation_id IS NULL THEN
    SELECT count(*) INTO n FROM public.tournament_entries x WHERE x.tournament_id=t.id
     AND x.finished_place=payment.finished_place AND coalesce(x.member_id,x.player_id)=payment.recipient_ref;
    IF n=1 THEN
     SELECT * INTO STRICT e FROM public.tournament_entries x WHERE x.tournament_id=t.id
      AND x.finished_place=payment.finished_place AND coalesce(x.member_id,x.player_id)=payment.recipient_ref;
     who:=e.player_id; member:=e.member_id; entry:=e.id;
     verified:=EXISTS(SELECT 1 FROM public.tournament_prizes z WHERE z.tournament_id=t.id
      AND z.position=payment.finished_place AND z.amount=payment.prize_amount);
    END IF;
   ELSE
    SELECT count(*) INTO n FROM (
     SELECT payment_id FROM private.multi_day_payment_commits_v1 WHERE payment_id=payment.id
     UNION ALL SELECT payment_id FROM private.multi_day_individual_payment_commits_v1 WHERE payment_id=payment.id
    ) z;
    IF n=1 THEN
     SELECT * INTO STRICT c FROM (
      SELECT player_id,participation_id,tournament_id,club_id,finished_place,amount_vnd,recipient_name,method,paid_at
       FROM private.multi_day_payment_commits_v1 WHERE payment_id=payment.id
      UNION ALL SELECT player_id,participation_id,tournament_id,club_id,finished_place,amount_vnd,recipient_name,method,paid_at
       FROM private.multi_day_individual_payment_commits_v1 WHERE payment_id=payment.id
     ) z;
     who:=c.player_id;
     verified:=c.participation_id=payment.multi_day_participation_id AND c.tournament_id=t.id AND c.club_id=t.club_id
      AND c.finished_place=payment.finished_place AND c.amount_vnd=payment.prize_amount
      AND c.recipient_name=payment.recipient_name AND c.method=payment.method AND c.paid_at=payment.paid_at
      AND payment.recipient_ref=c.player_id;
     SELECT s.entry_id,x.member_id INTO entry,member FROM public.multi_day_final_seatings_v1 s
      JOIN public.tournament_entries x ON x.id=s.entry_id AND x.player_id=c.player_id
      WHERE s.participation_id=c.participation_id AND s.final_tournament_id=t.id AND s.player_id=c.player_id;
     verified:=verified AND entry IS NOT NULL;
    END IF;
   END IF;
   IF who IS NULL THEN
    SELECT count(*),min(x.player_id::text)::uuid,min(x.member_id::text)::uuid INTO n,who,member
     FROM public.tournament_entries x WHERE x.tournament_id=t.id AND coalesce(x.member_id,x.player_id)=payment.recipient_ref;
    IF n<>1 THEN who:=NULL;member:=NULL;END IF;
   END IF;
   IF p_player_id IS NOT NULL AND who IS DISTINCT FROM p_player_id AND payment.recipient_ref<>p_player_id THEN CONTINUE; END IF;
   result:=result||jsonb_build_array(jsonb_build_object('kind','prize','id',payment.id,
    'customerRef',coalesce(private.club_financial_customer_ref_v1(t.club_id,who,member),payment.recipient_ref),'playerId',who,'entryId',entry,
    'tournamentId',t.id,'tournamentName',t.name,'eventDate',(t.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
    'at',payment.paid_at,'name',payment.recipient_name,'rank',payment.finished_place,
    'paidPrize',payment.prize_amount,'pendingPrize',0,'verified',coalesce(verified,false),
    'publicEligible',coalesce(verified,false) AND t.deleted_at IS NULL));
   -- Approved corrections are immutable deltas. Keep both payment and reversal
   -- in owner history; net them for winnings and outstanding obligations.
   FOR reversal IN SELECT z.* FROM public.multi_day_payout_corrections_v1 z
    WHERE z.kind='PAYMENT_REVERSAL' AND z.original_payment_id=payment.id LOOP
    IF reversal.club_id<>t.club_id OR reversal.participation_id IS DISTINCT FROM payment.multi_day_participation_id
     OR reversal.delta_vnd>=0 OR -reversal.delta_vnd>payment.prize_amount
     OR NOT EXISTS(SELECT 1 FROM public.multi_day_payout_finalizations_v1 f
      WHERE f.event_id=reversal.event_id AND f.final_tournament_id=t.id AND f.club_id=t.club_id)
    THEN RAISE EXCEPTION 'prize_reversal_scope_mismatch'; END IF;
    result:=result||jsonb_build_array(jsonb_build_object('kind','prize_reversal','id',reversal.id,
     'originalPaymentId',payment.id,'customerRef',coalesce(private.club_financial_customer_ref_v1(t.club_id,who,member),payment.recipient_ref),
     'playerId',who,'entryId',entry,'tournamentId',t.id,'tournamentName',t.name,
     'eventDate',(t.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'at',reversal.created_at,
     'name',payment.recipient_name,'rank',payment.finished_place,'paidPrize',reversal.delta_vnd,
     'pendingPrize',0,'verified',coalesce(verified,false),'publicEligible',coalesce(verified,false) AND t.deleted_at IS NULL));
   END LOOP;
  END LOOP;
  IF p_pending AND t.deleted_at IS NULL THEN
   FOR ctx IN SELECT value FROM jsonb_array_elements(floor_private.tournament_prize_result_contexts_v1(t.id)) LOOP
    IF ctx->>'official'<>'true' THEN CONTINUE; END IF;
    SELECT * INTO e FROM public.tournament_entries x WHERE x.tournament_id=t.id AND x.finished_place=(ctx->>'finishedPlace')::integer;
    IF NOT FOUND THEN
     SELECT x.* INTO e FROM private.multi_day_individual_obligations_v1 o
      JOIN public.tournament_entries x ON x.id=o.entry_id AND x.tournament_id=t.id
      WHERE o.tournament_id=t.id AND o.finished_place=(ctx->>'finishedPlace')::integer;
    END IF;
    IF e.id IS NULL THEN RAISE EXCEPTION 'prize_customer_identity_unavailable'; END IF;
    IF p_player_id IS NOT NULL AND e.player_id IS DISTINCT FROM p_player_id THEN CONTINUE; END IF;
    total:=(ctx->>'prizeAmount')::numeric;
    SELECT coalesce(sum((x->>'paidPrize')::numeric),0) INTO paid FROM jsonb_array_elements(result) x
     WHERE x->>'kind' IN ('prize','prize_reversal') AND x->>'entryId'=e.id::text AND x->>'verified'='true';
    IF paid>total THEN RAISE EXCEPTION 'prize_paid_obligation_mismatch'; END IF;
    IF total>paid THEN
     result:=result||jsonb_build_array(jsonb_build_object('kind','obligation','id',e.id,
      'customerRef',private.club_financial_customer_ref_v1(t.club_id,e.player_id,e.member_id),'playerId',e.player_id,'entryId',e.id,
      'tournamentId',t.id,'tournamentName',t.name,'at',NULL,'name',ctx->>'recipientName',
      'rank',(ctx->>'finishedPlace')::integer,'paidPrize',0,'pendingPrize',total-paid,'verified',true,'publicEligible',false));
    END IF;
   END LOOP;
  END IF;
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION private.player_cashier_prize_facts_v1(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_public_player_paid_winnings_v1(p_player_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE facts jsonb; total numeric; recent jsonb; complete boolean;
BEGIN
 IF p_player_id IS NULL THEN RAISE EXCEPTION 'invalid_player'; END IF;
 facts:=private.player_cashier_prize_facts_v1(NULL,p_player_id,false);
 SELECT coalesce(sum((x->>'paidPrize')::numeric) FILTER(WHERE x->>'publicEligible'='true'),0),
  NOT coalesce(bool_or(x->>'verified'<>'true'),false) INTO total,complete FROM jsonb_array_elements(facts) x;
 IF total<0 OR total>9007199254740991 OR total<>trunc(total) THEN RAISE EXCEPTION 'winnings_out_of_range'; END IF;
 SELECT coalesce(jsonb_agg(r ORDER BY r->>'eventDate' DESC,r->>'tournamentId'),'[]') INTO recent FROM (
  SELECT jsonb_build_object('tournamentId',x->>'tournamentId','tournamentName',max(x->>'tournamentName'),
   'eventDate',max(x->>'eventDate'),'rank',min((x->>'rank')::integer),'prize',sum((x->>'paidPrize')::numeric)) r
  FROM jsonb_array_elements(facts) x WHERE x->>'publicEligible'='true' GROUP BY x->>'tournamentId'
  HAVING sum((x->>'paidPrize')::numeric)>0
  ORDER BY max(x->>'eventDate') DESC,x->>'tournamentId' LIMIT 5
 ) q;
 RETURN jsonb_build_object('playerId',p_player_id,'totalWinnings',CASE WHEN complete THEN total END,
  'complete',complete,'recentResults',recent,'scope','cashier-confirmed','asOf',statement_timestamp());
END $$;
REVOKE ALL ON FUNCTION public.get_public_player_paid_winnings_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_public_player_paid_winnings_v1(uuid) TO anon,authenticated;

CREATE FUNCTION private.club_customer_financial_facts_v1(p_club_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE r record; price jsonb; price_ok boolean; cost_ok boolean; rake numeric;
 result jsonb; gross numeric; refunds numeric; movements jsonb; ref uuid; member_count integer;
BEGIN
 result:=private.player_cashier_prize_facts_v1(p_club_id,NULL,true);
 FOR r IN SELECT z.*,t.name tournament_name FROM public.tournament_registrations z
  JOIN public.tournaments t ON t.id=z.tournament_id AND t.club_id=p_club_id WHERE z.club_id=p_club_id LOOP
  SELECT count(DISTINCT e.member_id),(min(e.member_id::text))::uuid INTO member_count,ref
   FROM public.tournament_entries e WHERE e.registration_id=r.id AND e.tournament_id=r.tournament_id AND e.player_id=r.player_id;
  IF member_count>1 THEN RAISE EXCEPTION 'registration_customer_ambiguous'; END IF;
  ref:=private.club_financial_customer_ref_v1(p_club_id,r.player_id,ref);
  SELECT coalesce(sum(m.applied_amount) FILTER(WHERE m.direction='in' AND m.purpose='buyin'),0),
   coalesce(sum(m.applied_amount) FILTER(WHERE m.direction='out' AND m.purpose='refund'),0),
   coalesce(jsonb_agg(jsonb_build_object('id',m.id,'at',m.created_at,'kind',m.purpose,'amount',m.applied_amount,'method',m.method)
    ORDER BY m.created_at,m.id),'[]') INTO gross,refunds,movements
   FROM public.cashier_buyin_movements m WHERE m.registration_id=r.id AND m.club_id=p_club_id AND m.tournament_id=r.tournament_id;
  cost_ok:=NOT ((r.status='confirmed' OR r.cashier_paid_at IS NOT NULL) AND gross=0)
   AND refunds<=gross AND NOT EXISTS(SELECT 1 FROM public.cashier_buyin_movements m WHERE m.registration_id=r.id
    AND (m.club_id<>p_club_id OR m.tournament_id IS DISTINCT FROM r.tournament_id))
   AND refunds=(SELECT coalesce(sum(f.amount),0) FROM public.cashier_refund_requests f WHERE f.registration_id=r.id AND f.status='paid');
  price:=r.price_snapshot;
  price_ok:=jsonb_typeof(price)='object' AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['buy_in','rake','service_fee','platform_fee','total_pay']) k
   WHERE jsonb_typeof(price->k) IS DISTINCT FROM 'number');
  IF price_ok THEN
   price_ok:=NOT EXISTS(SELECT 1 FROM unnest(ARRAY['buy_in','rake','service_fee','platform_fee','total_pay']) k
    WHERE (price->>k)::numeric<0 OR (price->>k)::numeric<>trunc((price->>k)::numeric))
    AND (price->>'buy_in')::numeric=r.buy_in AND (price->>'total_pay')::numeric=r.total_pay
    AND (price->>'buy_in')::numeric+(price->>'rake')::numeric+(price->>'service_fee')::numeric+(price->>'platform_fee')::numeric=r.total_pay;
  END IF;
  rake:=CASE WHEN cost_ok AND gross=refunds THEN 0
   WHEN cost_ok AND gross-refunds=r.total_pay AND price_ok THEN (price->>'rake')::numeric END;
  result:=result||jsonb_build_array(jsonb_build_object('kind',CASE WHEN r.source_entry_id IS NULL THEN 'buyin' ELSE 'reentry' END,
   'id',r.id,'customerRef',ref,'playerId',r.player_id,'tournamentId',r.tournament_id,'tournamentName',r.tournament_name,
   'at',r.created_at,'paidAt',movements->0->>'at','amountDue',r.total_pay,'grossPaid',gross,'refunded',refunds,
   'cost',CASE WHEN cost_ok THEN gross-refunds END,'rake',rake,'verified',cost_ok,'movements',movements,
   'name',coalesce((SELECT full_name FROM public.club_members WHERE id=ref AND club_id=p_club_id),
    (SELECT display_name FROM public.profiles WHERE user_id=r.player_id),'Khách')));
 END LOOP;
 -- A played entry without an explicitly linked registration is not proof of
 -- a free ticket. Preserve the unknown cost instead of publishing a windfall.
 FOR r IN SELECT e.*,t.name tournament_name FROM public.tournament_entries e
  JOIN public.tournaments t ON t.id=e.tournament_id AND t.club_id=p_club_id
  LEFT JOIN public.tournament_registrations z ON z.id=e.registration_id AND z.tournament_id=e.tournament_id
   AND z.club_id=p_club_id AND z.player_id=e.player_id
  WHERE e.status IN('seated','busted','finished','bagged') AND z.id IS NULL LOOP
  ref:=private.club_financial_customer_ref_v1(p_club_id,r.player_id,r.member_id);
  result:=result||jsonb_build_array(jsonb_build_object('kind','unverified_entry','id',r.id,'customerRef',ref,
   'playerId',r.player_id,'tournamentId',r.tournament_id,'tournamentName',r.tournament_name,
   'at',coalesce(r.checked_in_at,r.created_at),'cost',NULL,'rake',NULL,'verified',false,
   'name',coalesce((SELECT full_name FROM public.club_members WHERE id=ref AND club_id=p_club_id),
    (SELECT display_name FROM public.profiles WHERE user_id=r.player_id),'Khách')));
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION private.club_customer_financial_facts_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Explicit player_ref only: a table/guest name is never sufficient identity.
-- Pending orders are order amounts, not a customer debt/balance ledger.
CREATE FUNCTION private.club_customer_fnb_facts_v1(p_club_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',o.id,'customerRef',private.club_financial_customer_ref_v1(p_club_id,o.player_ref,NULL),
  'name',coalesce(p.display_name,o.customer_name,'Khách'),'createdAt',o.created_at,
  'paidAt',o.paid_at,'cancelledAt',o.cancelled_at,'status',o.status,'method',o.payment_method,
  'isComp',o.is_comp,'amount',o.subtotal_vnd,
  'paid',CASE WHEN o.paid_at IS NOT NULL AND NOT o.is_comp THEN o.subtotal_vnd ELSE 0 END,
  'refunded',CASE WHEN o.status='cancelled' AND o.paid_at IS NOT NULL AND NOT o.is_comp THEN o.subtotal_vnd ELSE 0 END,
  'net',CASE WHEN o.paid_at IS NOT NULL AND NOT o.is_comp AND o.status<>'cancelled' THEN o.subtotal_vnd ELSE 0 END,
  'pending',CASE WHEN o.status='pending' AND o.paid_at IS NULL AND NOT o.is_comp THEN o.subtotal_vnd ELSE 0 END,
  'comp',CASE WHEN o.is_comp AND o.paid_at IS NOT NULL AND o.status<>'cancelled' THEN lines.total ELSE 0 END,
  'verified',o.subtotal_vnd>=0 AND CASE WHEN o.is_comp THEN o.subtotal_vnd=0 ELSE lines.total=o.subtotal_vnd END AND lines.valid AND
   CASE WHEN o.paid_at IS NOT NULL THEN o.status IN('paid','shipped','cancelled') AND
    (o.is_comp OR o.payment_method IN('cash','bank_transfer')) AND (o.status<>'cancelled' OR o.cancelled_at IS NOT NULL)
   ELSE o.status IN('pending','cancelled','expired') END,
  'items',lines.items) ORDER BY o.created_at DESC,o.id),'[]'::jsonb)
 FROM public.fnb_orders o LEFT JOIN public.profiles p ON p.user_id=o.player_ref
 CROSS JOIN LATERAL (
  SELECT coalesce(sum(i.unit_price_snapshot::numeric*i.qty),0) total,
   count(*)>0 AND bool_and(i.club_id=p_club_id AND i.qty>0 AND i.unit_price_snapshot>=0) valid,
   coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.name_snapshot,'quantity',i.qty,'unitPrice',i.unit_price_snapshot) ORDER BY i.id),'[]'::jsonb) items
  FROM public.fnb_order_items i WHERE i.order_id=o.id
 ) lines WHERE o.club_id=p_club_id AND o.player_ref IS NOT NULL
$$;
REVOKE ALL ON FUNCTION private.club_customer_fnb_facts_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_owner_player_financial_report_v1(p_club_id uuid DEFAULT NULL,p_customer_ref uuid DEFAULT NULL,
 p_query text DEFAULT '',p_offset integer DEFAULT 0,p_limit integer DEFAULT 50,p_fnb_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); clubs jsonb; facts jsonb; customers jsonb; selected jsonb; history jsonb;
 total_count integer; history_count integer; fnb_facts jsonb; fnb jsonb; fnb_orders jsonb; fnb_count integer;
BEGIN
 IF actor IS NULL OR p_offset IS NULL OR p_limit IS NULL OR p_fnb_offset IS NULL OR p_fnb_offset NOT BETWEEN 0 AND 100000 OR p_offset<0 OR p_offset>100000 OR p_limit NOT BETWEEN 1 AND 100 OR length(coalesce(p_query,''))>100
 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) ORDER BY c.name,c.id),'[]') INTO clubs
  FROM public.clubs c WHERE c.owner_id=actor OR EXISTS(SELECT 1 FROM public.user_roles u WHERE u.user_id=actor AND u.role='super_admin');
 IF p_club_id IS NULL THEN RETURN jsonb_build_object('clubId',NULL,'clubs',clubs,'customers','[]'::jsonb,'totalCount',0,'history','[]'::jsonb,'totalHistory',0); END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(clubs) c WHERE c->>'id'=p_club_id::text) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 facts:=private.club_customer_financial_facts_v1(p_club_id);
 fnb_facts:=private.club_customer_fnb_facts_v1(p_club_id);
 WITH roster AS (
  SELECT id customer_ref,full_name name FROM public.club_members WHERE club_id=p_club_id
  UNION SELECT (x->>'customerRef')::uuid,x->>'name' FROM jsonb_array_elements(facts) x
  UNION SELECT (x->>'customerRef')::uuid,x->>'name' FROM jsonb_array_elements(fnb_facts) x
  UNION SELECT private.club_financial_customer_ref_v1(p_club_id,e.player_id,e.member_id),coalesce(cm.full_name,p.display_name,'Khách') FROM public.tournament_entries e
   JOIN public.tournaments t ON t.id=e.tournament_id AND t.club_id=p_club_id
   LEFT JOIN public.club_members cm ON cm.id=e.member_id AND cm.club_id=p_club_id LEFT JOIN public.profiles p ON p.user_id=e.player_id
 ), summary AS (
  SELECT z.customer_ref,max(z.name) name,
   coalesce(sum((x->>'cost')::numeric),0) cost,coalesce(sum((x->>'rake')::numeric),0) rake,
   coalesce(sum((x->>'paidPrize')::numeric),0) paid,coalesce(sum((x->>'pendingPrize')::numeric),0) pending,
   count(*) FILTER(WHERE x->>'verified'='false') unavailable,
   count(*) FILTER(WHERE x->>'kind' IN ('buyin','reentry') AND x->>'rake' IS NULL) rake_unavailable,
   count(*) FILTER(WHERE x->>'kind' IN ('buyin','reentry') AND (x->>'grossPaid')::numeric>0) paid_buys,
   count(DISTINCT x->>'tournamentId') FILTER(WHERE x->>'kind' IN ('buyin','reentry') AND (x->>'grossPaid')::numeric>0) tours
  FROM (SELECT customer_ref,max(name) name FROM roster WHERE customer_ref IS NOT NULL GROUP BY customer_ref) z
  LEFT JOIN LATERAL jsonb_array_elements(facts) x ON x->>'customerRef'=z.customer_ref::text GROUP BY z.customer_ref
 ), rows AS (
  SELECT jsonb_build_object('customerRef',s.customer_ref,'name',s.name,'cost',CASE WHEN unavailable=0 THEN cost END,
   'rake',CASE WHEN unavailable=0 AND rake_unavailable=0 THEN rake END,'paidPrize',paid,'pendingPrize',pending,
   'fnbNet',(SELECT CASE WHEN NOT coalesce(bool_or(x->>'verified' IS DISTINCT FROM 'true'),false) THEN coalesce(sum((x->>'net')::numeric),0) END
    FROM jsonb_array_elements(fnb_facts) x WHERE x->>'customerRef'=s.customer_ref::text),
   'profit',CASE WHEN unavailable=0 THEN paid-cost END,'roi',CASE WHEN unavailable=0 AND cost>0 THEN round((paid-cost)*100/cost,4) END,
   'unavailableCount',unavailable,'paidBuys',paid_buys,'tournaments',tours,
   'visits',(SELECT count(DISTINCT ((m->>'at')::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
    FROM jsonb_array_elements(facts) f CROSS JOIN LATERAL jsonb_array_elements(coalesce(f->'movements','[]')) m
    WHERE f->>'customerRef'=s.customer_ref::text AND m->>'kind'='buyin' AND (m->>'amount')::numeric>0),
   'lastPaidAt',(SELECT max((m->>'at')::timestamptz)
    FROM jsonb_array_elements(facts) f CROSS JOIN LATERAL jsonb_array_elements(coalesce(f->'movements','[]')) m
    WHERE f->>'customerRef'=s.customer_ref::text AND m->>'kind'='buyin' AND (m->>'amount')::numeric>0),
   'averageSpend',CASE WHEN unavailable=0 AND paid_buys>0 THEN round(cost/paid_buys,0) END,
   'activeTournaments',(SELECT count(DISTINCT e.tournament_id) FROM public.tournament_entries e JOIN public.tournaments t ON t.id=e.tournament_id
    WHERE t.club_id=p_club_id AND t.deleted_at IS NULL AND t.status NOT IN ('completed','cancelled') AND e.status='seated'
     AND private.club_financial_customer_ref_v1(p_club_id,e.player_id,e.member_id)=s.customer_ref)) value
  FROM summary s
 ) SELECT coalesce(jsonb_agg(value ORDER BY value->>'name',value->>'customerRef'),'[]') INTO customers FROM rows;
 SELECT value INTO selected FROM jsonb_array_elements(customers) WHERE value->>'customerRef'=p_customer_ref::text;
 IF p_customer_ref IS NOT NULL AND selected IS NULL THEN RAISE EXCEPTION 'customer_not_in_club' USING ERRCODE='42501'; END IF;
 SELECT count(*) INTO total_count FROM jsonb_array_elements(customers) x WHERE position(lower(coalesce(p_query,'')) IN lower(x->>'name'))>0;
 SELECT coalesce(jsonb_agg(x),'[]') INTO customers FROM (SELECT value x FROM jsonb_array_elements(customers)
  WHERE position(lower(coalesce(p_query,'')) IN lower(value->>'name'))>0 OFFSET p_offset LIMIT p_limit) q;
 SELECT count(*) INTO history_count FROM jsonb_array_elements(facts) x WHERE x->>'customerRef'=p_customer_ref::text;
 SELECT coalesce(jsonb_agg(x),'[]') INTO history FROM (SELECT value x FROM jsonb_array_elements(facts)
  WHERE value->>'customerRef'=p_customer_ref::text ORDER BY value->>'at' DESC NULLS LAST,value->>'id' OFFSET p_offset LIMIT p_limit) q;
 SELECT count(*) INTO fnb_count FROM jsonb_array_elements(fnb_facts) x WHERE x->>'customerRef'=p_customer_ref::text;
 SELECT coalesce(jsonb_agg(x),'[]') INTO fnb_orders FROM (SELECT value x FROM jsonb_array_elements(fnb_facts)
  WHERE value->>'customerRef'=p_customer_ref::text ORDER BY value->>'createdAt' DESC,value->>'id' OFFSET p_fnb_offset LIMIT p_limit) q;
 SELECT jsonb_build_object('paid',CASE WHEN quality=0 THEN paid END,'refunded',CASE WHEN quality=0 THEN refunded END,
  'net',CASE WHEN quality=0 THEN net END,'pending',CASE WHEN quality=0 THEN pending END,'comp',CASE WHEN quality=0 THEN comp END,
  'unavailableCount',quality,'orders',fnb_orders,'totalCount',fnb_count,
  'unlinkedOrderCount',(SELECT count(*) FROM public.fnb_orders WHERE club_id=p_club_id AND player_ref IS NULL)) INTO fnb
 FROM (SELECT coalesce(sum((x->>'paid')::numeric),0) paid,coalesce(sum((x->>'refunded')::numeric),0) refunded,
  coalesce(sum((x->>'net')::numeric),0) net,coalesce(sum((x->>'pending')::numeric),0) pending,coalesce(sum((x->>'comp')::numeric),0) comp,
  count(*) FILTER(WHERE x->>'verified' IS DISTINCT FROM 'true') quality
  FROM jsonb_array_elements(fnb_facts) x WHERE x->>'customerRef'=p_customer_ref::text) totals;
 RETURN jsonb_build_object('clubId',p_club_id,'clubs',clubs,'asOf',statement_timestamp(),'metricVersion','cashier-cashflow-v1',
  'customers',customers,'totalCount',total_count,'selected',selected,'history',history,'totalHistory',history_count,'fnb',fnb);
END $$;
REVOKE ALL ON FUNCTION public.get_owner_player_financial_report_v1(uuid,uuid,text,integer,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_owner_player_financial_report_v1(uuid,uuid,text,integer,integer,integer) TO authenticated;
COMMIT;
