import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function runPayrollCancelOverlap({sql,session,until}) {
  const club='9ef80c7a-cb97-4acc-b81c-5bf34d49317f',actor='065801a0-565e-4bd6-9c2d-ee252b7e6494';
  const auth=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET LOCAL ROLE authenticated;`;
  for(const order of ['cancel','save']){
    const year=order==='cancel'?2100:2099,month=order==='cancel'?1:12;
    const start=`${year}-${String(month).padStart(2,'0')}-01`,end=`${year}-${String(month).padStart(2,'0')}-31`,request=randomUUID();
    assert.equal(sql(`SELECT count(*) FROM public.payroll_periods WHERE club_id='${club}' AND period_year=${year} AND period_month=${month};`),'0','cancel overlap period occupied');
    const roster=JSON.parse(sql(`BEGIN;${auth}SELECT jsonb_agg(value ORDER BY key) FROM jsonb_each(public.calculate_club_payroll('${club}','${start}','${end}')->'dealers');ROLLBACK;`));
    const payload=JSON.stringify(roster).replaceAll("'","''");
    const save=`public.save_payroll_period_v2('${club}',${year},${month},'${start}','${end}','${payload}'::jsonb,'${request}')`;
    const cancel=`public.cancel_unresolved_payroll_save_v2('${request}','${club}',${year},${month})`;
    let holder,waiter;
    try {
      holder=session(`payroll169_${order}_holder`);
      holder.child.stdin.write(`BEGIN;${auth}SELECT 'RESULT:'||(${order==='cancel'?cancel:save})::text;\n\\echo HELD\n`);
      await until(()=>holder.output().includes('HELD'));
      const first=JSON.parse(holder.output().split('\n').find(line=>line.startsWith('RESULT:')).slice(7));
      waiter=session(`payroll169_${order}_waiter`);
      waiter.child.stdin.end(`BEGIN;${auth}SELECT 'RESULT:'||(${order==='cancel'?save:cancel})::text;COMMIT;\n`);
      await until(()=>sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='payroll169_${order}_waiter' AND wait_event_type='Lock');`)==='t');
      holder.child.stdin.end('COMMIT;\n');await holder.closed;
      if(order==='cancel'){
        await assert.rejects(waiter.closed,/payroll_request_payload_conflict/);
        assert.equal(first.outcome,'cancelled');
        assert.equal(sql(`SELECT count(*) FROM public.payroll_periods WHERE club_id='${club}' AND period_year=${year} AND period_month=${month};`),'0');
      }else{
        const output=await waiter.closed;
        assert.deepEqual(JSON.parse(output.split('\n').find(line=>line.startsWith('RESULT:')).slice(7)),first);
        assert.equal(first.outcome,'saved');
        assert.equal(sql(`SELECT status FROM public.payroll_periods WHERE id='${first.periodId}';`),'draft');
      }
      assert.equal(sql(`SELECT count(*) FROM floor_private.payroll_save_receipts_v2 WHERE actor_id='${actor}' AND request_id='${request}';`),'1');
      console.log(`PAYROLL_${order.toUpperCase()}_FIRST_REAL_LOCK_CANCEL_SAVE_PASS`,JSON.stringify({request,period:first.periodId??null,year,month,outcome:first.outcome,retained:'synthetic local evidence, no payment'}));
    } finally {
      for(const handle of [holder,waiter])if(handle){
        if(!handle.child.stdin.writableEnded&&!handle.child.stdin.destroyed)handle.child.stdin.end('ROLLBACK;\n');
        await handle.closed.catch(()=>{});
      }
    }
  }
}

export async function runPayrollReceiptOverlap({sql,session,until}) {
  const club='9ef80c7a-cb97-4acc-b81c-5bf34d49317f',actor='065801a0-565e-4bd6-9c2d-ee252b7e6494',request=randomUUID();
  assert.equal(sql(`SELECT count(*) FROM public.payroll_periods WHERE club_id='${club}' AND period_year=2099 AND period_month=11;`),'0','receipt overlap canary occupied');
  const auth=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET LOCAL ROLE authenticated;`;
  const roster=JSON.parse(sql(`BEGIN;${auth}SELECT jsonb_agg(value ORDER BY key) FROM jsonb_each(public.calculate_club_payroll('${club}','2099-11-01','2099-11-30')->'dealers');ROLLBACK;`));
  const payload=JSON.stringify(roster).replaceAll("'","''");
  const call=(rows)=>`SELECT 'RECEIPT:'||public.save_payroll_period_v2('${club}',2099,11,'2099-11-01','2099-11-30','${rows}'::jsonb,'${request}')::text;`;
  let first,retry,conflict;
  try {
    first=session('payroll168_receipt_holder');
    first.child.stdin.write(`BEGIN;${auth}${call(payload)}\n\\echo RECEIPT_UNCOMMITTED\n`);
    await until(()=>first.output().includes('RECEIPT_UNCOMMITTED'));
    const receipt=JSON.parse(first.output().split('\n').find(line=>line.startsWith('RECEIPT:')).slice(8));
    // Own uncommitted rows are visible to holder, so capture exact timestamps
    // before either retry can run; retry must not rewrite the payroll snapshot.
    first.child.stdin.write(`RESET ROLE;SELECT 'BEFORE:'||md5(jsonb_agg(to_jsonb(d) ORDER BY d.id)::text) FROM public.dealer_payroll d WHERE period_id='${receipt.periodId}';\n\\echo SNAPSHOT_READY\n`);
    await until(()=>first.output().includes('SNAPSHOT_READY'));
    const before=first.output().split('\n').find(line=>line.startsWith('BEFORE:')).slice(7);
    retry=session('payroll168_receipt_retry');retry.child.stdin.end(`BEGIN;${auth}${call(payload)}COMMIT;\n`);
    conflict=session('payroll168_receipt_conflict');conflict.child.stdin.end(`BEGIN;${auth}${call('[]')}COMMIT;\n`);
    await until(()=>sql("SELECT count(*) FROM pg_stat_activity WHERE application_name IN('payroll168_receipt_retry','payroll168_receipt_conflict') AND wait_event_type='Lock';")==='2');
    first.child.stdin.end('COMMIT;\n');await first.closed;
    const output=await retry.closed;
    assert.deepEqual(JSON.parse(output.split('\n').find(line=>line.startsWith('RECEIPT:')).slice(8)),receipt);
    await assert.rejects(conflict.closed,/payroll_request_payload_conflict/);
    assert.equal(sql(`SELECT md5(jsonb_agg(to_jsonb(d) ORDER BY d.id)::text) FROM public.dealer_payroll d WHERE period_id='${receipt.periodId}';`),before);
    assert.equal(sql(`SELECT count(*) FROM floor_private.payroll_save_receipts_v2 WHERE actor_id='${actor}' AND request_id='${request}';`),'1');
    assert.equal(sql(`SELECT count(*) FROM public.payroll_periods WHERE club_id='${club}' AND period_year=2099 AND period_month=11;`),'1');
    console.log('PAYROLL_RECEIPT_TWO_WAITERS_EXACT_REPLAY_CONFLICT_NO_REWRITE_PASS',JSON.stringify({period:receipt.periodId,request,rows:roster.length,retained:'synthetic draft, no payment'}));
  } finally {
    for(const handle of [first,retry,conflict])if(handle){
      if(!handle.child.stdin.writableEnded&&!handle.child.stdin.destroyed)handle.child.stdin.end('ROLLBACK;\n');
      await handle.closed.catch(()=>{});
    }
  }
}

export async function runPayrollSourceOverlap({sql,session,until}) {
  const club='9ef80c7a-cb97-4acc-b81c-5bf34d49317f',actor='065801a0-565e-4bd6-9c2d-ee252b7e6494',dealer='0d617281-35e5-43cc-87f2-86e5094bc403';
  assert.equal(sql(`SELECT count(*) FROM public.payroll_periods WHERE club_id='${club}' AND period_year=2099 AND period_month=9;`),'0');
  const employment=sql(`SELECT employment_type FROM public.dealers WHERE id='${dealer}' AND club_id='${club}';`);
  assert.ok(['full_time','part_time'].includes(employment));
  const field=employment==='full_time'?'monthly_salary_vnd':'hourly_rate_vnd';
  const original=JSON.parse(sql(`SELECT coalesce(to_jsonb(${field}),'null'::jsonb) FROM public.dealers WHERE id='${dealer}' AND club_id='${club}';`));
  assert.ok(original===null||typeof original==='number'&&Number.isSafeInteger(original));
  const changed=(original??0)+1;
  const auth=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET LOCAL ROLE authenticated;`;
  const roster=JSON.parse(sql(`BEGIN;${auth}SELECT jsonb_agg(value ORDER BY key) FROM jsonb_each(public.calculate_club_payroll('${club}','2099-09-01','2099-09-30')->'dealers');ROLLBACK;`));
  assert.ok(roster.some(row=>row.dealer_id===dealer));const payload=JSON.stringify(roster).replaceAll("'","''");
  let writer,saver,committed=false;
  try {
    writer=session('payroll166_source_holder');
    writer.child.stdin.write(`BEGIN;SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';UPDATE public.dealers SET ${field}=${changed} WHERE id='${dealer}' AND club_id='${club}';
      SELECT 'SOURCE_VALUE:'||(public.calculate_club_payroll('${club}','2099-09-01','2099-09-30')->'dealers'->'${dealer}'->>'${field}');\n\\echo SOURCE_LOCKED\n`);
    await until(()=>writer.output().includes('SOURCE_LOCKED'));
    assert.ok(writer.output().includes(`SOURCE_VALUE:${changed}`),'source perturbation did not affect calculator payload');
    saver=session('payroll166_source_waiter');
    saver.child.stdin.end(`BEGIN;${auth}SELECT public.save_payroll_period_secure('${club}',2099,9,'2099-09-01','2099-09-30','${payload}'::jsonb);COMMIT;\n`);
    await until(()=>sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='payroll166_source_waiter' AND wait_event_type='Lock');")==='t');
    writer.child.stdin.end('COMMIT;\n');await writer.closed;committed=true;
    await assert.rejects(saver.closed,/payroll_source_changed_refresh_required/);
    assert.equal(sql(`SELECT count(*) FROM public.payroll_periods WHERE club_id='${club}' AND period_year=2099 AND period_month=9;`),'0','stale source created a period');
    console.log('PAYROLL_TWO_SESSION_RATE_CHANGE_STALE_SAVE_DENIED_PASS');
  } finally {
    for(const handle of [writer,saver])if(handle){
      if(!handle.child.stdin.writableEnded&&!handle.child.stdin.destroyed)handle.child.stdin.end('ROLLBACK;\n');
      await handle.closed.catch(()=>{});
    }
    if(committed){
      assert.equal(sql(`UPDATE public.dealers SET ${field}=${original??'NULL'} WHERE id='${dealer}' AND club_id='${club}' AND ${field}=${changed} RETURNING id;`),dealer,'source restoration CAS failed');
      assert.equal(JSON.parse(sql(`SELECT coalesce(to_jsonb(${field}),'null'::jsonb) FROM public.dealers WHERE id='${dealer}';`)),original);
      console.log('PAYROLL_LOCAL_TEST_RATE_RESTORED_PASS');
    }
  }
}

export async function runPayrollSaveOverlap({sql,session,until}) {
  const club='9ef80c7a-cb97-4acc-b81c-5bf34d49317f',actor='065801a0-565e-4bd6-9c2d-ee252b7e6494';
  const start='2099-07-01',end='2099-07-31';
  assert.equal(sql(`SELECT count(*) FROM public.payroll_periods WHERE club_id='${club}' AND period_year=2099 AND period_month=7;`),'0','do not overwrite an existing canary period');
  const auth=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET LOCAL ROLE authenticated;`;
  const roster=JSON.parse(sql(`BEGIN;${auth}SELECT coalesce(jsonb_agg(value ORDER BY key),'[]'::jsonb) FROM jsonb_each(public.calculate_club_payroll('${club}','${start}','${end}')->'dealers');ROLLBACK;`));
  assert.ok(roster.length>0);const payload=JSON.stringify(roster).replaceAll("'","''");
  const save=`SELECT 'PAYROLL_PERIOD:'||public.save_payroll_period_secure('${club}',2099,7,'${start}','${end}','${payload}'::jsonb);`;
  let first,second,transition,stale;
  try {
    first=session('payroll166_create_holder');
    first.child.stdin.write(`BEGIN;${auth}${save}\n\\echo FIRST_SAVED\n`);
    await until(()=>first.output().includes('FIRST_SAVED'));
    second=session('payroll166_create_waiter');
    second.child.stdin.write(`BEGIN;${auth}${save}\n\\echo SECOND_SAVED\n`);
    await until(()=>sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='payroll166_create_waiter' AND wait_event_type='Lock');")==='t');
    first.child.stdin.end('COMMIT;\n');const one=await first.closed;
    await until(()=>second.output().includes('SECOND_SAVED'));
    second.child.stdin.end('COMMIT;\n');const two=await second.closed;
    const id=one.match(/PAYROLL_PERIOD:([a-f0-9-]{36})/)?.[1];
    assert.ok(id);assert.equal(two.match(/PAYROLL_PERIOD:([a-f0-9-]{36})/)?.[1],id,'concurrent saves created different periods');
    const before=sql(`SELECT md5(jsonb_agg(to_jsonb(dp) ORDER BY dp.id)::text) FROM public.dealer_payroll dp WHERE period_id='${id}';`);
    assert.equal(sql(`SELECT count(*) FROM public.payroll_periods WHERE club_id='${club}' AND period_year=2099 AND period_month=7;`),'1');
    assert.equal(Number(sql(`SELECT count(*) FROM public.dealer_payroll WHERE period_id='${id}';`)),roster.length);
    transition=session('payroll166_submit_holder');
    transition.child.stdin.write(`BEGIN;${auth}SELECT public.transition_payroll_status_secure('${id}','draft','submitted',NULL);\n\\echo SUBMITTED_UNCOMMITTED\n`);
    await until(()=>transition.output().includes('SUBMITTED_UNCOMMITTED'));
    stale=session('payroll166_save_after_submit');
    stale.child.stdin.end(`BEGIN;${auth}${save}COMMIT;\n`);
    await until(()=>sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='payroll166_save_after_submit' AND wait_event_type='Lock');")==='t');
    transition.child.stdin.end('COMMIT;\n');await transition.closed;
    await assert.rejects(stale.closed,/payroll_period_not_editable/);
    assert.equal(sql(`SELECT status FROM public.payroll_periods WHERE id='${id}';`),'submitted');
    assert.equal(sql(`SELECT md5(jsonb_agg(to_jsonb(dp) ORDER BY dp.id)::text) FROM public.dealer_payroll dp WHERE period_id='${id}';`),before,'rejected stale save changed payroll rows');
    console.log('PAYROLL_TWO_SESSION_CREATE_AND_SUBMIT_FENCE_PASS',JSON.stringify({period:id,year:2099,month:7,rows:roster.length,retained:'synthetic submitted canary; no payment'}));
  } finally {
    for(const handle of [first,second,transition,stale])if(handle){
      if(!handle.child.stdin.writableEnded&&!handle.child.stdin.destroyed)handle.child.stdin.end('ROLLBACK;\n');
      await handle.closed.catch(()=>{});
    }
  }
}
