import assert from 'node:assert/strict';

// Exact retained TEST fixture. Auth transport is modeled by the parent adapter;
// each business read below still executes under its actual authenticated SQL role.
export function createPayout379Read({sql,query,fixture,actor,log,hangingReads}) {
  assert.equal(fixture.tour,'6a7fb4a3-8b46-44be-a71a-ca12a052ee08');
  assert.equal(fixture.club,'7f3c6f90-3667-4c8c-9a00-6f00da680d84');
  assert.equal(actor,'40b8f243-bf3b-4aaa-962b-db788380207c');
  let holds=Number(process.env.VINPOKER_PAYOUT379_HANG_COUNT??0);
  assert.ok(Number.isInteger(holds)&&holds>=0&&holds<=2);
  let satelliteHolds=Number(process.env.VINPOKER_PAYOUT380_SATELLITE_HANG_COUNT??0);
  assert.ok(Number.isInteger(satelliteHolds)&&satelliteHolds>=0&&satelliteHolds<=2);
  const operatorRead=process.env.VINPOKER_OPERATOR382_READ==='1';
  let operatorFault=operatorRead;
  const tables=['tournaments','tournament_entries','tournament_prizes','tournament_payout_runs','cashier_buyin_movements','tournament_prize_payments'];
  const fingerprint=()=>sql(`SELECT md5(jsonb_build_array(${tables.map(table=>`(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.${table} t)`).join(',')})::text);`);
  const before=fingerprint();
  const columns=[
    'satellite_payout',
    'id,club_id,operations_mode,buy_in,rake_amount,prize_pool,itm_places,registration_closed_at,live_status,event_id',
    'id,buy_in,rake_amount,prize_pool,itm_places,registration_closed_at,live_status,event_id,club_id,planned_itm_percent,planned_payout_archetype,planned_min_cash_x,planned_rounding_unit,operations_mode',
    'id,buy_in,rake_amount,prize_pool,itm_places,registration_closed_at,live_status,event_id,club_id,planned_itm_percent,planned_payout_archetype,planned_min_cash_x,planned_rounding_unit',
  ];
  return {
    verify(){assert.equal(fingerprint(),before);console.log('PAYOUT379_GLOBAL_TOUR_ENTRY_PRIZE_RUN_CASH_PAYMENT_UNCHANGED');},
    handle(url,method,body,res,send){
      if(operatorRead&&method==='POST'&&['/rest/v1/rpc/get_my_floor_operator_scope','/rest/v1/rpc/dealer_control_club_ids'].includes(url.pathname)){
        const dealer=url.pathname.endsWith('/dealer_control_club_ids');
        assert.deepEqual(body,dealer?{_user_id:actor}:{});
        const value=dealer?query(`SELECT coalesce(jsonb_agg(id),'[]'::jsonb) FROM public.dealer_control_club_ids('${actor}') id;`)
          :query("SELECT coalesce(jsonb_agg(s),'[]'::jsonb) FROM public.get_my_floor_operator_scope() s;");
        assert.ok(Array.isArray(value)&&value.every(row=>dealer?row===fixture.club:row.club_id===fixture.club));
        if(dealer&&operatorFault){operatorFault=false;log.push({test:'OPERATOR382_DEALER_SCOPE_503_AFTER_NATIVE_READ',mutation:false});send(503,{message:'LOCAL_OPERATOR382_SCOPE_UNAVAILABLE'});return true;}
        log.push({test:dealer?'OPERATOR382_NATIVE_DEALER_SCOPE':'OPERATOR382_NATIVE_FLOOR_SCOPE',rows:value.length,mutation:false});send(200,value);return true;
      }
      if(method==='POST'&&url.pathname==='/rest/v1/rpc/get_tournament_prizes'){
        assert.deepEqual(body,{p_tournament_id:fixture.tour});
        const value=query(`SELECT public.get_tournament_prizes('${fixture.tour}');`);
        assert.ok(Array.isArray(value));log.push({test:'PAYOUT379_NATIVE_PRIZES',rows:value.length,mutation:false});
        if(holds>0){holds--;const held={response:res,shutdown:false};hangingReads.add(held);
          res.once('close',()=>{hangingReads.delete(held);log.push({test:held.shutdown?'PAYOUT379_SERVER_SHUTDOWN':'PAYOUT379_CLIENT_ABORT',mutation:false});});
          log.push({test:'PAYOUT379_HELD_AFTER_NATIVE_SQL',mutation:false});return true;}
        send(200,value);return true;
      }
      if(method==='GET'&&url.pathname==='/rest/v1/tournaments'){
        assert.equal(url.searchParams.get('id'),`eq.${fixture.tour}`);
        const select=url.searchParams.get('select').replaceAll(/\s/g,'');assert.ok(columns.includes(select),select);
        const value=query(`SELECT (SELECT to_jsonb(t) FROM (SELECT ${select} FROM public.tournaments WHERE id='${fixture.tour}') t);`);
        if(select==='satellite_payout'&&satelliteHolds>0){
          satelliteHolds--;const held={response:res,shutdown:false};hangingReads.add(held);
          res.once('close',()=>{hangingReads.delete(held);log.push({test:held.shutdown?'SATELLITE380_SERVER_SHUTDOWN':'SATELLITE380_CLIENT_ABORT',mutation:false});});
          log.push({test:'SATELLITE380_HELD_AFTER_NATIVE_SQL',mutation:false});return true;
        }
        log.push({test:'PAYOUT379_NATIVE_TOUR',mutation:false});send(200,value);return true;
      }
      if(method==='GET'&&url.pathname==='/rest/v1/tournament_payout_runs'){
        assert.equal(url.searchParams.get('select'),'*');assert.equal(url.searchParams.get('tournament_id'),`eq.${fixture.tour}`);
        const status=url.searchParams.get('status');assert.ok(['eq.applied','eq.draft_snapshot'].includes(status));
        // Exact allowlist above, never interpolate arbitrary filters into SQL.
        const value=query(`SELECT coalesce((SELECT to_jsonb(r) FROM public.tournament_payout_runs r WHERE tournament_id='${fixture.tour}' AND status='${status.slice(3)}'),'null'::jsonb);`);
        log.push({test:'PAYOUT379_NATIVE_RUN',mutation:false});send(200,value);return true;
      }
      if(method==='GET'&&url.pathname==='/rest/v1/payout_templates'){
        assert.equal(url.searchParams.get('select').replaceAll(/\s/g,''),'id,name,custom_percents,rounding_unit,min_cash_x');
        assert.equal(url.searchParams.get('club_id'),`eq.${fixture.club}`);assert.equal(url.searchParams.get('archetype'),'eq.CUSTOM');assert.equal(url.searchParams.get('order'),'created_at.desc');
        const value=query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY created_at DESC),'[]'::jsonb) FROM (SELECT id,name,custom_percents,rounding_unit,min_cash_x,created_at FROM public.payout_templates WHERE club_id='${fixture.club}' AND archetype='CUSTOM') t;`);
        log.push({test:'PAYOUT379_NATIVE_TEMPLATES',rows:value.length,mutation:false});send(200,value);return true;
      }
      if(method==='HEAD'&&url.pathname==='/rest/v1/tournament_entries'){
        assert.equal(url.searchParams.get('select'),'id');assert.equal(url.searchParams.get('tournament_id'),`eq.${fixture.tour}`);
        assert.equal(url.searchParams.get('or'),'(status.is.null,status.not.in.(void,voided,cancelled,canceled,refunded,rejected))');
        assert.equal(url.searchParams.has('status'),false);
        const count=query(`SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${fixture.tour}' AND COALESCE(status,'') NOT IN ('void','voided','cancelled','canceled','refunded','rejected');`);
        res.setHeader('Content-Range',`*/${count}`);log.push({test:'PAYOUT379_NATIVE_ENTRIES',count,mutation:false});send(200,null);return true;
      }
      return false;
    },
  };
}
