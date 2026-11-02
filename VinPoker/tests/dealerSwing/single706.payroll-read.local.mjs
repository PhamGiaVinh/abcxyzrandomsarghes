import assert from 'node:assert/strict';

// Read-only actual original Single244 owner/club. No synthetic payroll row and
// no finalize/payment endpoint; all values are obtained via native authorization.
export function createSingle706PayrollRead({sql,query,actor,club,log}){
 assert.equal(actor,'febf2b51-fdb7-42ff-886c-b3bb1fffdc3e');assert.equal(club,'d4427834-5f5f-48ef-bde5-e2dc388ed00b');
 assert.equal(sql('SELECT current_database();'),'vinpoker_ops_cash115_qualified_c');
 const tables=['dealer_attendance','dealer_assignments','dealer_rotation_schedule','payroll_periods','dealer_payroll','payroll_adjustments',
 'payment_records','cashier_buyin_movements','tournament_prize_payments','tournament_prizes','tournament_payout_runs','tournament_entries','tournament_seats','chip_inventory_ledger','chip_bank_ledger'];
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text);`);
 const before=fingerprint();let failPayroll=true;
 const rpcNames=['calculate_club_payroll','get_my_floor_operator_scope','dealer_control_club_ids','get_dealer_payroll_statement_rollout'];
 const paths=['/rest/v1/payroll_periods',...rpcNames.map(name=>'/rest/v1/rpc/'+name)];
 return {paths,verify(){assert.equal(fingerprint(),before);console.log('SINGLE706_READONLY_PAYROLL_DEALER_CASH_CHIP_PAYOUT_ENTRIES_UNCHANGED_PASS');},
 handle(url,method,body,res,send){
  if(method==='POST'){
   const name=url.pathname.split('/').pop();assert.ok(rpcNames.includes(name));let statement;
   if(name==='calculate_club_payroll'){
    assert.deepEqual(body,{p_club_id:club,p_start_date:'2026-10-01',p_end_date:'2026-10-31'});
    const value=query(`SELECT public.calculate_club_payroll('${club}','2026-10-01','2026-10-31');`);
    assert.equal(value.club_id,club);
    log.push({test:'SINGLE706_OWNER_NATIVE_PAYROLL',dealerIds:Object.keys(value.dealers),mutation:false,fault503:failPayroll});
    if(failPayroll){failPayroll=false;send(503,{message:'LOCAL706_PAYROLL_READ_TEMPORARILY_UNAVAILABLE'});}else send(200,value);return;
   }
   if(name==='get_my_floor_operator_scope'){
    assert.deepEqual(body,{});statement="SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM public.get_my_floor_operator_scope()x;";
   }else if(name==='dealer_control_club_ids'){
    assert.deepEqual(body,{_user_id:actor});statement=`SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM public.dealer_control_club_ids('${actor}')x;`;
   }else{
    assert.deepEqual(body,{p_expected_club_id:club});statement=`SELECT public.get_dealer_payroll_statement_rollout('${club}');`;
   }
   const value=query(statement);log.push({test:'SINGLE706_OWNER_SCOPE_OR_ROLLOUT',name,mutation:false});send(200,value);return;
  }
  assert.equal(method,'GET');assert.equal(url.pathname,'/rest/v1/payroll_periods');
  assert.equal(url.searchParams.get('club_id'),`eq.${club}`);assert.equal(url.searchParams.get('period_year'),'eq.2026');assert.equal(url.searchParams.get('period_month'),'eq.10');
  const select=url.searchParams.get('select');assert.equal(select,'id,status,submitted_by,submitted_at,approved_by,approved_at,locked_by,locked_at,rejected_by,rejected_at,rejection_reason,payment_prepared_by,payment_prepared_at,paid_by,paid_at,reconciled_by,reconciled_at');
  const value=query(`SELECT coalesce((SELECT to_jsonb(x) FROM(SELECT ${select} FROM public.payroll_periods WHERE club_id='${club}' AND period_year=2026 AND period_month=10)x),'null'::jsonb);`);
  assert.equal(value,null);log.push({test:'SINGLE706_NATIVE_NO_SAVED_PAYROLL',mutation:false});send(200,value);
 }};
}
