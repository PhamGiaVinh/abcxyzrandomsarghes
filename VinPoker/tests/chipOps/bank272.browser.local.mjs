import assert from 'node:assert/strict';
export function createBank272Browser(sql,query,fixture){
 const f=JSON.parse(sql('SELECT fixture FROM floor_private.bank272_fixture;'));
 assert.equal(f.club,'e2720000-0000-4000-8000-000000000010');assert.equal(fixture.club,f.club);assert.equal(fixture.tour,f.tour);
 assert.equal(sql(`SELECT md5(pg_get_functiondef('public.chip_ops_bank_adjust_v2(uuid,uuid,text,bigint,uuid,integer,text,uuid)'::regprocedure));`),'c461ab265f313a2e7decfa94e184a138');
 assert.equal(sql(`SELECT md5(pg_get_functiondef('public.get_chip_bank_adjust_receipt_v2(uuid,uuid,text,bigint,uuid,integer,text,uuid)'::regprocedure));`),'e2a0d56e102078120832326098e8cb58');
 const extra=JSON.parse(sql(`SELECT coalesce(jsonb_agg(idempotency_key),'[]') FROM public.chip_bank_ledger WHERE club_id='${f.club}' AND idempotency_key NOT IN('bank272-same','bank272-cas-first');`));
 assert.ok(extra.length<=1);const keys=new Set(extra);
 const current=sql(`SELECT on_hand_count||':'||version FROM public.chip_bank WHERE club_id='${f.club}' AND denomination_id='${f.denom}';`);
 assert.equal(current,extra.length?'18:3':'13:2','exact retained overlap or completed browser canary; never reset');
 const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(x);
 const verify=()=>{
  assert.equal(sql(`SELECT on_hand_count||':'||version FROM public.chip_bank WHERE club_id='${f.club}' AND denomination_id='${f.denom}';`),'18:3');
  assert.equal(sql(`SELECT count(*) FROM public.chip_bank_ledger WHERE club_id='${f.club}';`),'3');
  assert.equal(sql(`SELECT count(*) FROM floor_private.chip_mutation_receipts WHERE actor_id='${f.actor}';`),'4');
  assert.equal(sql(`SELECT count(*) FROM public.chip_bank_ledger l JOIN floor_private.chip_mutation_receipts r
   ON r.actor_id=l.actor AND r.request_key=l.idempotency_key WHERE l.club_id='${f.club}' AND l.count=5 AND l.details->>'expected_version'='2'
   AND r.result->>'outcome'='applied' AND r.result->>'ledger_id'=l.id::text AND r.payload->>'count'='5';`),'1');
  const outside=sql(`SELECT md5(jsonb_build_array(
   (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
   (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x),
   (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
   (SELECT jsonb_agg(to_jsonb(x) ORDER BY club_id,denomination_id) FROM public.chip_bank x WHERE club_id<>'${f.club}'),
   (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bank_ledger x WHERE club_id<>'${f.club}'),
   (SELECT jsonb_agg(to_jsonb(x) ORDER BY actor_id,request_key) FROM floor_private.chip_mutation_receipts x WHERE actor_id NOT IN('${f.actor}','${f.otherActor}'))
  )::text);`);
  assert.equal(outside,sql('SELECT baseline FROM floor_private.bank272_fixture;'));
  console.log('BANK273_BROWSER_EXACT_ONE_ADJUSTMENT_RECEIPT_OTHER_BANK_CHIP_CASH_PAYOUT_UNCHANGED_PASS');
 };
 return {verify,rpc:(name,body)=>{
  if(name==='get_chip_bank'){
   assert.deepEqual(body,{p_club_id:f.club});return {write:false,value:query(`SELECT public.get_chip_bank('${f.club}');`)};
  }
  assert.ok(['chip_ops_bank_adjust_v2','get_chip_bank_adjust_receipt_v2'].includes(name));
  assert.deepEqual(Object.keys(body).sort(),['p_club_id','p_count','p_denomination_id','p_direction','p_expected_actor','p_idempotency_key','p_old_version','p_tournament_id'].sort());
  assert.equal(body.p_club_id,f.club);assert.equal(body.p_tournament_id,f.tour);assert.equal(body.p_denomination_id,f.denom);
  assert.equal(body.p_expected_actor,f.actor);assert.equal(body.p_direction,'thu');assert.equal(body.p_count,5);assert.equal(body.p_old_version,2);assert.ok(uuid(body.p_idempotency_key));
  assert.ok(keys.size===0||keys.has(body.p_idempotency_key),'only one unique browser adjustment may be submitted');
  if(name==='chip_ops_bank_adjust_v2')keys.add(body.p_idempotency_key);
  return {write:name==='chip_ops_bank_adjust_v2',value:query(`SELECT public.${name}('${f.club}','${f.denom}','thu',5,'${f.tour}',2,'${body.p_idempotency_key}','${f.actor}');`)};
 },ledger:url=>{
  assert.equal(url.searchParams.get('club_id'),`eq.${f.club}`);assert.equal(url.searchParams.get('select'),'id,denomination_id,direction,count,balance_after,reason,created_at');
  assert.equal(url.searchParams.get('order'),'created_at.desc');assert.equal(url.searchParams.get('limit'),'50');
  return query(`SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY created_at DESC),'[]') FROM
   (SELECT id,denomination_id,direction,count,balance_after,reason,created_at FROM public.chip_bank_ledger WHERE club_id='${f.club}' ORDER BY created_at DESC LIMIT 50) l;`);
 }};
}
