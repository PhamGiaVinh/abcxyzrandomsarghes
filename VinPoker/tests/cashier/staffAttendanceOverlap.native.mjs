import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Called only by the exact-loopback PG17 parent. Isolated synthetic records
// are retained as evidence, never linked to a real staff member or payment.
export async function runStaffAttendanceOverlap({sql,session,until}) {
  const actor=randomUUID(),staff=randomUUID(),attendance=randomUUID();
  const club='9755fe63-669c-49d0-bea9-75177a3d30fc';
  assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.clubs WHERE id='${club}');`),'t');
  sql(`BEGIN;INSERT INTO auth.users(id) VALUES('${actor}');
    INSERT INTO public.staff(id,user_id,club_id,full_name,department,employment_type,hourly_rate_vnd,status)
    VALUES('${staff}','${actor}','${club}','Staff checkout overlap local TEST','service','part_time',50000,'active');
    INSERT INTO public.staff_attendance(id,staff_id,shift_date,status,check_in_time)
    VALUES('${attendance}','${staff}',current_date,'checked_in',now()-interval '2 hours');COMMIT;`);
  const auth=`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;`;
  const call=`SELECT 'RECEIPT:'||public.staff_check_out('${staff}')::text;`;
  let first,second;
  try {
    first=session('staff_checkout_holder');
    first.child.stdin.write(`BEGIN;${auth}${call}
      SELECT 'ROW:'||to_jsonb(a)::text FROM public.staff_attendance a WHERE id='${attendance}';
      \n\\echo CHECKOUT_HELD\n`);
    await until(()=>first.output().includes('CHECKOUT_HELD'));
    const receipt=JSON.parse(first.output().split('\n').find(x=>x.startsWith('RECEIPT:')).slice(8));
    const row=first.output().split('\n').find(x=>x.startsWith('ROW:')).slice(4);
    assert.equal(receipt.outcome,'checked_out');assert.equal(receipt.attendance_id,attendance);
    second=session('staff_checkout_waiter');
    second.child.stdin.end(`BEGIN;${auth}${call}COMMIT;\n`);
    await until(()=>sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='staff_checkout_waiter' AND wait_event_type='Lock');")==='t');
    first.child.stdin.end('COMMIT;\n');await first.closed;
    const output=await second.closed;
    const repeated=JSON.parse(output.split('\n').find(x=>x.startsWith('RECEIPT:')).slice(8));
    console.log('STAFF_CHECKOUT_OVERLAP_OBSERVED',JSON.stringify({staff,attendance,first:receipt.outcome,second:repeated.outcome}));
    assert.equal(repeated.outcome,'no_open_shift','second tab must not confirm another checkout of the closed row');
    assert.equal(sql(`SELECT to_jsonb(a)::text FROM public.staff_attendance a WHERE id='${attendance}';`),row,'second checkout rewrote committed history');
    console.log('STAFF_CHECKOUT_REAL_TWO_SESSION_NO_REWRITE_PASS');
    // Existing unique-open guard must still make check-in from two tabs return
    // one canonical attendance, not two shifts or an empty success receipt.
    first=session('staff_checkin_holder');
    first.child.stdin.write(`BEGIN;${auth}SELECT 'RECEIPT:'||public.staff_check_in('${staff}')::text;\n\\echo CHECKIN_HELD\n`);
    await until(()=>first.output().includes('CHECKIN_HELD'));
    const opened=JSON.parse(first.output().split('\n').find(x=>x.startsWith('RECEIPT:')).slice(8));
    assert.equal(opened.outcome,'checked_in');assert.ok(opened.attendance_id);
    second=session('staff_checkin_waiter');
    second.child.stdin.end(`BEGIN;${auth}SELECT 'RECEIPT:'||public.staff_check_in('${staff}')::text;COMMIT;\n`);
    await until(()=>sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='staff_checkin_waiter' AND wait_event_type='Lock');")==='t');
    first.child.stdin.end('COMMIT;\n');await first.closed;
    const checkInOutput=await second.closed;
    const same=JSON.parse(checkInOutput.split('\n').find(x=>x.startsWith('RECEIPT:')).slice(8));
    assert.equal(same.outcome,'already_checked_in');assert.equal(same.attendance_id,opened.attendance_id);
    assert.equal(sql(`SELECT count(*) FROM public.staff_attendance WHERE staff_id='${staff}' AND status='checked_in';`),'1');
    const closed=JSON.parse(sql(`BEGIN;${auth}SELECT public.staff_check_out('${staff}');COMMIT;`));
    assert.equal(closed.attendance_id,opened.attendance_id);assert.equal(closed.outcome,'checked_out');
    assert.equal(sql(`SELECT to_jsonb(a)::text FROM public.staff_attendance a WHERE id='${attendance}';`),row);
    console.log('STAFF_CHECKIN_REAL_TWO_SESSION_SAME_ATTENDANCE_PASS');
  } finally {
    for(const handle of [first,second])if(handle){
      if(!handle.child.stdin.writableEnded&&!handle.child.stdin.destroyed)handle.child.stdin.end('ROLLBACK;\n');
      await handle.closed.catch(()=>{});
    }
    // No test shift may remain open even when an assertion fails.
    assert.equal(sql(`SELECT count(*) FROM public.staff_attendance WHERE staff_id='${staff}' AND status='checked_in';`),'0');
  }
}
