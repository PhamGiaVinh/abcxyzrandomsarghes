import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Exact retained, local TEST rows only. No arbitrary tournament or capability input.
export function createTvProjection166Browser({sql,log,terminal219=false,hangFirstFlightA851=false}){
 assert.ok(!hangFirstFlightA851||terminal219,'851 only reuses exact retained terminal219 displays');
 const tours={flightA:'782a5196-5ea1-44ed-8a27-1b872d5f88d9',flightB:'fdf91018-09f3-4cdc-b76a-f688eb216cee',zero:'58a903d2-2bba-4e95-aa0f-df2edfc1b05e'};
 if(terminal219){
  tours.final='4cd3af4d-7e1d-4042-855f-04fb6777e580';
  assert.equal(sql(`SELECT count(*) FROM public.multi_day_payout_finalizations_v1
   WHERE event_id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d' AND final_tournament_id='${tours.final}'
    AND request_id='264bdd6e-33a7-4d7b-837a-e3a6b60a16a6'
    AND direct_pool_vnd+recorded_overlay_vnd=2500000 AND paid_player_vnd=0;`),'1');
 }
 const ids=Object.values(tours).map(id=>`'${id}'::uuid`).join(',');
 assert.equal(sql(`SELECT count(*) FROM public.tournaments WHERE id IN(${ids}) AND name LIKE '%TEST%';`),String(Object.keys(tours).length));
 assert.equal(sql(`SELECT count(*) FROM public.tournaments t JOIN public.tournament_events e ON e.id=t.event_id AND e.club_id=t.club_id
  WHERE t.id IN('${tours.flightA}','${tours.flightB}') AND e.id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d'
   AND e.guarantee_amount=2500000;`),'2');
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_array(
  (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tournaments t WHERE id IN(${ids})),
  (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_events e WHERE id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d'),
  (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.tournament_levels l WHERE tournament_id IN(${ids})),
  (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id IN(${ids})),
  (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id IN(${ids})),
  (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_registrations r WHERE tournament_id IN(${ids})),
  (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m WHERE tournament_id IN(${ids})),
  (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.tournament_prize_payments p WHERE tournament_id IN(${ids}))
 )::text);`);
 const before=fingerprint(),displays={};
 for(const [label,tour] of Object.entries(tours)){
  const existing=JSON.parse(sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('tour',assigned_tournament_id,'id',id,'token',display_token)),'[]'::jsonb)
   FROM public.tv_displays WHERE name='Local166 ${label} TEST' AND assigned_tournament_id='${tour}' AND status='paired';`));
  assert.ok(existing.length<=1,'ambiguous local TV166 fixture; do not select an arbitrary token');
  if(hangFirstFlightA851)assert.equal(existing.length,1,'851 must not create or reset a display');
  displays[label]=existing[0]??{tour,id:randomUUID(),token:'fixture-only-tv166-'+randomUUID()};
  if(!existing.length){const d=displays[label];sql(`INSERT INTO public.tv_displays(id,club_id,display_token,assigned_tournament_id,status,name,layout)
   SELECT '${d.id}',club_id,'${d.token}',id,'paired','Local166 ${label} TEST','clock' FROM public.tournaments WHERE id='${tour}';`);}
 }
 const displayRows=()=>JSON.parse(sql(`SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY id),'[]'::jsonb) FROM public.tv_displays d;`));
 const displaysBefore=displayRows(),readIds=new Set();let hung=false;
 return {
  manifest:displays,
  holdResponse851(body){
   if(!hangFirstFlightA851||hung||body.p_display_token!==displays.flightA.token)return false;
   hung=true;return true;
  },
  read(body){
   assert.deepEqual(Object.keys(body).sort(),['p_display_token','p_include_branding']);
   const found=Object.entries(displays).find(([,d])=>d.token===body.p_display_token);
   assert.ok(found,'LOCAL_TV166_TOKEN_NOT_ALLOWED');assert.equal(typeof body.p_include_branding,'boolean');
   const [label,d]=found;
   const value=JSON.parse(sql(`BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL request.jwt.claim.role='anon';
    SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;
    SELECT public.get_tv_display_state_v4('${d.token}',${body.p_include_branding});COMMIT;`));
   assert.equal(value.tournament?.id,d.tour);assert.equal(value.display?.id,d.id);
   readIds.add(d.id);
   log.push({rpc:'get_tv_display_state_v4',role:'anon',fixture:label,tour:d.tour,display:d.id,
    mainEventGuarantee:value.main_event?.guarantee_amount??null,remaining:value.tournament.players_remaining,entries:value.entries.total_confirmed});
   return value;
  },
  verify(){assert.equal(fingerprint(),before,'TV reads must not change tournament/entry/seat/financial facts');
   const after=displayRows();assert.equal(after.length,displaysBefore.length);
   for(let i=0;i<after.length;i++){
    const old=displaysBefore[i],current=after[i];
    if(!readIds.has(current.id)){assert.deepEqual(current,old);continue;}
    const {last_seen_at:oldSeen,updated_at:oldUpdated,...oldFields}=old;
    const {last_seen_at:seen,updated_at:updated,...fields}=current;
    assert.deepEqual(fields,oldFields,'TV polls may not change assignment or settings');
    if(seen!==oldSeen||updated!==oldUpdated){
     // The existing BEFORE UPDATE trigger stamps updated_at on a heartbeat.
     assert.equal(updated,seen);assert.ok(Date.parse(seen)>=Date.parse(oldSeen??oldUpdated));
    }
   }
   console.log('TV166_BROWSER_READ_NO_TOUR_ENTRY_SEAT_FINANCIAL_DELTA_HEARTBEAT_ONLY_PASS');},
 };
}
