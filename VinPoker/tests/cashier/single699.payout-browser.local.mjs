import assert from 'node:assert/strict';
import {createComputePayoutsLocalHandler} from './computePayouts.handler.local.mjs';

// Two exact retained TEST scopes only. Parent models Auth; every read/apply uses native
// authenticated SQL. No hosted/provider/payment proof and no payment endpoint.
export function createSingle699Payout({sql,query,fixture,actor,log,recovery700=false}) {
  assert.equal(typeof recovery700,'boolean');
  const tour=recovery700?'6a7fb4a3-8b46-44be-a71a-ca12a052ee08':'c367013a-3ed3-48af-ad48-3915acadc50e';
  const club=recovery700?'7f3c6f90-3667-4c8c-9a00-6f00da680d84':'d4427834-5f5f-48ef-bde5-e2dc388ed00b';
  const entries=recovery700?3:9,prefix=recovery700?'PAYOUT700':'SINGLE699';
  assert.equal(fixture.tour,tour);assert.equal(fixture.club,club);
  assert.equal(actor,recovery700?'40b8f243-bf3b-4aaa-962b-db788380207c':'febf2b51-fdb7-42ff-886c-b3bb1fffdc3e');
  assert.equal(sql("SELECT md5(replace(pg_get_functiondef('public.prepare_payout_snapshot(uuid,numeric,text,numeric,bigint,bigint,text,boolean,text,jsonb)'::regprocedure),chr(13),''));"),'9b5d19f330a6a02f801a6591251bfb86');
  assert.equal(sql("SELECT md5(replace(pg_get_functiondef('public.apply_payout_run(uuid,jsonb,bigint,integer,bigint,jsonb,text,text)'::regprocedure),chr(13),''));"),'71b9b435c5e94d69dd6e068decdc6e49');
  assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.tournaments WHERE id='${tour}' AND club_id='${club}' AND status='${recovery700?'active':'completed'}' AND buy_in=100000 AND rake_amount=0 AND event_id IS NULL)
    AND (SELECT count(*)=${entries} AND sum(applied_amount)=${entries*100000} FROM public.cashier_buyin_movements WHERE tournament_id='${tour}')
    AND (SELECT count(*)=${recovery700?0:8} FROM public.tournament_entries WHERE tournament_id='${tour}' AND finished_place IS NOT NULL)
    ${recovery700?`AND (SELECT count(*)=3 AND sum(chip_count)=60000 FROM public.tournament_seats WHERE tournament_id='${tour}' AND is_active)`:`AND NOT EXISTS(SELECT 1 FROM public.tournament_seats WHERE tournament_id='${tour}' AND is_active)`}
    AND NOT EXISTS(SELECT 1 FROM public.tournament_prize_payments WHERE tournament_id='${tour}')
    ${recovery700?'':`AND EXISTS(SELECT 1 FROM public.tournament_close_report WHERE id='95fc8d98-a056-45f2-9803-d505a58c686e' AND tournament_id='${tour}' AND prize_total=0)`};`),'t');
  const quote=value=>`'${String(value).replaceAll("'","''")}'`;
  const uuid=value=>typeof value==='string'&&/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value);
  const protectedFingerprint=()=>sql(`SELECT md5(jsonb_build_array(
    ${['tournament_entries','tournament_seats','table_sessions','tournament_tables','tournament_hands','hand_players','hand_actions','tournament_settlement_outcomes','tracker_historical_display_queue','cashier_buyin_movements','chip_inventory_ledger','chip_bank_ledger','tournament_prize_payments','tournament_close_report','dealer_attendance','dealer_assignments','notifications','tournament_events'].map(table=>`(SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text) FROM public.${table} r)`).join(',')},
    (SELECT jsonb_agg(CASE WHEN id='${tour}' THEN to_jsonb(r)-'registration_closed_at'-'prize_pool'-'itm_places'-'updated_at' ELSE to_jsonb(r) END ORDER BY id) FROM public.tournaments r),
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_payout_runs r WHERE tournament_id<>'${tour}'),
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_prizes r WHERE tournament_id<>'${tour}'))::text);`);
  const before=protectedFingerprint();
  let dropPrepare=true,dropCompute=true;
  const service={
    rpc:async(name,args)=>{
      assert.ok(['is_club_owner','is_club_admin','is_club_cashier'].includes(name));
      assert.equal(args._user_id,actor);assert.equal(args._club_id,club);
      return {data:query(`SELECT to_jsonb(public.${name}('${actor}'::uuid,'${club}'::uuid));`),error:null};
    },
    from:table=>{
      assert.ok(['tournament_payout_runs','tournaments'].includes(table));let columns,id;
      const builder={select:value=>{columns=value.replaceAll(/\s/g,'');return builder;},eq:(key,value)=>{assert.equal(key,'id');assert.ok(uuid(value));id=value;return builder;},maybeSingle:async()=>{
        if(table==='tournaments'){assert.equal(id,tour);assert.equal(columns,'club_id');}
        else assert.ok(['id,tournament_id,status,entries_snapshot,prize_pool_snapshot,effective_floor,itm_percent,archetype,rounding_unit','custom_percents'].includes(columns));
        return {data:query(`SELECT coalesce((SELECT to_jsonb(r) FROM (SELECT ${columns} FROM public.${table} WHERE id='${id}' ${table==='tournament_payout_runs'?`AND tournament_id='${tour}'`:''}) r),'null'::jsonb);`),error:null};
      }};return builder;
    },
  };
  const caller={auth:{getUser:async()=>({data:{user:{id:actor}},error:null})},from:table=>{
    assert.equal(table,'tournaments');let columns;
    const builder={select:value=>{columns=value.replaceAll(/\s/g,'');return builder;},eq:(key,value)=>{assert.equal(key,'id');assert.equal(value,tour);return builder;},maybeSingle:async()=>{
      assert.equal(columns,'id,club_id,buy_in,rake_amount,event_id');
      return {data:query(`SELECT coalesce((SELECT to_jsonb(r) FROM(SELECT ${columns} FROM public.tournaments WHERE id='${tour}') r),'null'::jsonb);`),error:null};
    }};return builder;
  },rpc:async(name,args)=>{
    assert.equal(name,'apply_payout_run');assert.ok(uuid(args.p_run_id));
    assert.equal(query(`SELECT count(*) FROM public.tournament_payout_runs WHERE id='${args.p_run_id}' AND tournament_id='${tour}';`),1);
    const value=query(`SELECT public.apply_payout_run(p_run_id=>'${args.p_run_id}',p_rows=>${quote(JSON.stringify(args.p_rows))}::jsonb,
      p_prize_pool=>${quote(args.p_prize_pool)}::bigint,p_itm_places=>${quote(args.p_itm_places)}::integer,
      p_effective_floor=>${quote(args.p_effective_floor)}::bigint,p_warnings=>${quote(JSON.stringify(args.p_warnings))}::jsonb,
      p_engine_version=>${quote(args.p_engine_version)},p_alpha_version=>${quote(args.p_alpha_version)});`);
    log.push({test:`${prefix}_CANONICAL_APPLY_COMMITTED`,runId:args.p_run_id,rows:args.p_rows,mutation:true});
    return {data:value,error:null};
  }};
  const handler=createComputePayoutsLocalHandler({service,caller});
  const tourColumns=[
    'satellite_payout',
    'id,club_id,operations_mode,buy_in,rake_amount,prize_pool,itm_places,registration_closed_at,live_status,event_id',
    'id,buy_in,rake_amount,prize_pool,itm_places,registration_closed_at,live_status,event_id,club_id,planned_itm_percent,planned_payout_archetype,planned_min_cash_x,planned_rounding_unit',
    'id,buy_in,rake_amount,prize_pool,itm_places,registration_closed_at,live_status,event_id,club_id,planned_itm_percent,planned_payout_archetype,planned_min_cash_x,planned_rounding_unit,operations_mode',
  ];
  return {
    verify(){
      assert.equal(protectedFingerprint(),before);
      assert.equal(sql(`SELECT count(*)<=1 AND count(*) FILTER(WHERE entries_snapshot<>${entries} OR prize_pool_snapshot<>${entries*100000} OR buy_in_snapshot<>100000 OR rake_snapshot<>0 OR archetype<>'DAILY' OR min_cash_x<>2 OR rounding_unit<>100000 OR itm_percent<>0.15 OR status NOT IN('draft_snapshot','applied'))=0 FROM public.tournament_payout_runs WHERE tournament_id='${tour}';`),'t');
      console.log(`${prefix}_ALL_CASH_CHIP_PAYMENT_ENTRY_HAND_PROOF_CLOSE_DEALER_OTHER_SCOPE_UNCHANGED_PASS`);
    },
    async handle(url,method,body,res,send){
      if(method==='POST'&&url.pathname==='/rest/v1/rpc/prepare_payout_snapshot'){
        if(body.p_tournament_id!==tour||body.p_regenerate!==false){send(403,{message:'LOCAL_SINGLE699_EXACT_PREPARE_ONLY'});return true;}
        assert.deepEqual(body,{p_tournament_id:tour,p_itm_percent:0.15,p_archetype:'DAILY',p_min_cash_x:2,p_rounding_unit:100000,
          p_prize_pool_override:null,p_override_reason:null,p_regenerate:false,p_reason:null,p_custom_percents:null});
        const value=query(`SELECT public.prepare_payout_snapshot('${tour}',0.15,'DAILY',2,100000,NULL,NULL,false,NULL,NULL);`);
        assert.ok(['prepared','resumed','already_applied'].includes(value.status));assert.ok(uuid(value.run_id));
        log.push({test:`${prefix}_PREPARE_COMMITTED`,runId:value.run_id,outcome:value.status,mutation:true});
        if(dropPrepare&&value.status==='prepared'){
          dropPrepare=false;log.push({test:`${prefix}_${recovery700?'PREPARE_503':'DROP_PREPARE_RESPONSE'}_AFTER_COMMIT`,runId:value.run_id});
          if(recovery700)send(503,{message:'LOCAL_PREPARE_OUTCOME_UNAVAILABLE_AFTER_COMMIT'});else res.destroy();
        }
        else send(200,value);return true;
      }
      if(method==='POST'&&url.pathname==='/functions/v1/compute-payouts'){
        if(recovery700&&body.mode==='preview'&&body.tournament_id===tour){
          const fingerprint=()=>sql(`SELECT md5(jsonb_build_array((SELECT to_jsonb(t) FROM public.tournaments t WHERE id='${tour}'),
            (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_payout_runs r WHERE tournament_id='${tour}'),
            (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_prizes r WHERE tournament_id='${tour}'))::text);`);
          const previewBefore=fingerprint();
          const response=await handler(new Request('http://127.0.0.1:54329/functions/v1/compute-payouts',{method:'POST',headers:{authorization:'Bearer LOCAL_VERIFIED_PARENT_SESSION','content-type':'application/json'},body:JSON.stringify(body)}));
          const value=await response.json();assert.equal(fingerprint(),previewBefore);
          log.push({test:'PAYOUT700_ACTUAL_PREVIEW_OFFICIAL_SNAPSHOT_UNCHANGED',status:response.status,mutation:false});
          send(response.status,value);return true;
        }
        if(body.mode!=='official'||!uuid(body.run_id)
          ||query(`SELECT count(*) FROM public.tournament_payout_runs WHERE id='${body.run_id}' AND tournament_id='${tour}';`)!==1){send(403,{message:'LOCAL_SINGLE699_EXACT_SAVED_RUN_ONLY'});return true;}
        const response=await handler(new Request('http://127.0.0.1:54329/functions/v1/compute-payouts',{method:'POST',headers:{authorization:'Bearer LOCAL_VERIFIED_PARENT_SESSION','content-type':'application/json'},body:JSON.stringify(body)}));
        const value=await response.json();
        if(response.status===200&&dropCompute){
          dropCompute=false;log.push({test:`${prefix}_${recovery700?'COMPUTE_503':'DROP_COMPUTE_RESPONSE'}_AFTER_COMMIT`,runId:body.run_id});
          if(recovery700)send(503,{message:'LOCAL_COMPUTE_OUTCOME_UNAVAILABLE_AFTER_COMMIT'});else res.destroy();
        }
        else send(response.status,value);return true;
      }
      if(method==='POST'&&url.pathname==='/rest/v1/rpc/get_tournament_prizes'){
        assert.deepEqual(body,{p_tournament_id:tour});send(200,query(`SELECT public.get_tournament_prizes('${tour}');`));return true;
      }
      if(method==='POST'&&url.pathname==='/rest/v1/rpc/get_tournament_payout_recipients'){
        assert.deepEqual(body,{p_tournament_id:tour});send(200,query(`SELECT public.get_tournament_payout_recipients('${tour}');`));return true;
      }
      if(method==='GET'&&url.pathname==='/rest/v1/tournaments'){
        assert.equal(url.searchParams.get('id'),`eq.${tour}`);const columns=url.searchParams.get('select');assert.ok(tourColumns.includes(columns));
        send(200,query(`SELECT coalesce((SELECT to_jsonb(r) FROM(SELECT ${columns} FROM public.tournaments WHERE id='${tour}') r),'null'::jsonb);`));return true;
      }
      if(method==='GET'&&url.pathname==='/rest/v1/tournament_payout_runs'){
        assert.equal(url.searchParams.get('select'),'*');assert.equal(url.searchParams.get('tournament_id'),`eq.${tour}`);
        const status=url.searchParams.get('status');assert.ok(['eq.applied','eq.draft_snapshot'].includes(status));
        const id=url.searchParams.get('id');if(id)assert.ok(id.startsWith('eq.')&&uuid(id.slice(3)));
        send(200,query(`SELECT coalesce((SELECT to_jsonb(r) FROM public.tournament_payout_runs r WHERE tournament_id='${tour}' AND status='${status.slice(3)}'${id?` AND id='${id.slice(3)}'`:''}),'null'::jsonb);`));return true;
      }
      if(method==='HEAD'&&url.pathname==='/rest/v1/tournament_entries'){
        assert.equal(url.searchParams.get('select'),'id');assert.equal(url.searchParams.get('tournament_id'),`eq.${tour}`);
        assert.equal(url.searchParams.get('or'),'(status.is.null,status.not.in.(void,voided,cancelled,canceled,refunded,rejected))');
        const count=query(`SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${tour}' AND COALESCE(status,'') NOT IN ('void','voided','cancelled','canceled','refunded','rejected');`);
        res.setHeader('Content-Range',`*/${count}`);send(200,null);return true;
      }
      return false;
    },
  };
}
