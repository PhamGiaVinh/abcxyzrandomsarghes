import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
const literal=value=>`'${String(value).replaceAll("'","''")}'`;

export function seedPayrollBrowserFixture(sql){
  assert.equal(process.env.VINPOKER_NATIVE_BROWSER,'1');
  assert.equal(process.env.VINPOKER_PAYROLL_BROWSER,'1');
  const existing=process.env.VINPOKER_PAYROLL_CLUB;
  if(existing){
    assert.ok(uuid(existing));
    const fixture=JSON.parse(sql(`SELECT jsonb_build_object('club',c.id,'tour',t.id,'payroll',jsonb_build_object(
      'dealer',d.id,'attendance',a.id,'year',extract(year FROM a.shift_date)::int,'month',extract(month FROM a.shift_date)::int,
      'start',date_trunc('month',a.shift_date)::date,'end',(date_trunc('month',a.shift_date)+interval '1 month - 1 day')::date))
      FROM public.clubs c JOIN public.tournaments t ON t.club_id=c.id JOIN public.dealers d ON d.club_id=c.id
      JOIN public.dealer_attendance a ON a.dealer_id=d.id WHERE c.id='${existing}' AND c.name='Payroll browser local TEST'
      AND t.name='Payroll browser local TEST' AND d.full_name='Payroll browser PT TEST' AND a.status='checked_out';`)||'null');
    assert.ok(fixture,'resume only exact independent payroll TEST fixture');return fixture;
  }
  const club=randomUUID(),tour=randomUUID(),dealer=randomUUID(),shift=randomUUID(),attendance=randomUUID();
  const actor=randomUUID();
  const now=new Date(),year=now.getFullYear(),month=now.getMonth()+1;
  const start=`${year}-${String(month).padStart(2,'0')}-01`;
  const end=`${year}-${String(month).padStart(2,'0')}-${new Date(year,month,0).getDate()}`;
  sql(`BEGIN;
    INSERT INTO auth.users(id) VALUES('${actor}');
    INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES('${club}','${actor}','Payroll browser local TEST','TEST','approved');
    INSERT INTO public.tournaments(id,club_id,name,status,live_status) VALUES('${tour}','${club}','Payroll browser local TEST','upcoming','registering');
    INSERT INTO public.dealer_shifts(id,club_id,tour_name,start_time,end_time) VALUES('${shift}','${club}','Payroll browser TEST','08:00','16:00');
    INSERT INTO public.dealers(id,club_id,full_name,status,employment_type,hourly_rate_vnd,standard_hours_per_shift)
      VALUES('${dealer}','${club}','Payroll browser PT TEST','active','part_time',50000,8);
    INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,check_in_time,check_out_time,current_state)
      VALUES('${attendance}','${dealer}','${shift}','${start}','checked_out','${start} 08:00+07','${start} 16:00+07','checked_out');
    COMMIT;`);
  return {club,tour,payroll:{dealer,attendance,year,month,start,end}};
}

export function createPayrollBrowser({sql,query,actor,fixture,log}){
  const {club,payroll}=fixture;let drop=true;
  const fault=process.env.VINPOKER_PAYROLL_FAULT??'after_commit';
  const readOnly=process.env.VINPOKER_PAYROLL_READ_ONLY==='1';
  const linkedMain=process.env.VINPOKER_PAYROLL_LINKED_MAIN227==='1';
  if(linkedMain){assert.ok(readOnly);assert.equal(club,'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760');assert.equal(actor,'675fe35e-60a8-4452-bb90-e79486d54da6');}
  let savedReadFault=process.env.VINPOKER_PAYROLL_SAVED_READ_FAULT??'none';
  assert.ok(['none','null_money','empty'].includes(savedReadFault));
  assert.ok(savedReadFault==='none'||readOnly,'saved-read fault requires readonly canary');
  const selfSalary=process.env.VINPOKER_DEALER_SELF_BROWSER==='1';
  assert.ok(['after_commit','before_commit'].includes(fault));
  assert.ok(uuid(club)&&uuid(actor)&&payroll);
  const envelope=query(`SELECT public.calculate_club_payroll('${club}','${payroll.start}','${payroll.end}');`);
  assert.equal(Object.keys(envelope.dealers).length,linkedMain?5:1);
  assert.equal(Number(envelope.dealers[payroll.dealer].total_hours),8);
  assert.equal(Number(envelope.dealers[payroll.dealer].net_pay_vnd),linkedMain?0:400000);
  const periodId=value=>{
    assert.ok(uuid(value));
    assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.payroll_periods WHERE id='${value}' AND club_id='${club}'
      AND period_year=${payroll.year} AND period_month=${payroll.month});`),'t');return value;
  };
  if(selfSalary){
    assert.ok(!readOnly,'readonly canary cannot change dealer identity');
    assert.equal(sql(`SELECT user_id IS NULL FROM public.dealers WHERE id='${payroll.dealer}' AND club_id='${club}' AND full_name='Payroll browser PT TEST';`),'t');
    assert.equal(sql(`WITH linked AS (UPDATE public.dealers SET user_id='${actor}' WHERE id='${payroll.dealer}' AND club_id='${club}' AND user_id IS NULL RETURNING 1) SELECT count(*) FROM linked;`),'1');
  }
  const snapshot=()=>sql(`SELECT md5(jsonb_build_object(
    'periods',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.payroll_periods p WHERE p.club_id='${club}'),
    'rows',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.dealer_payroll p WHERE p.club_id='${club}'),
    'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.request_id) FROM floor_private.payroll_save_receipts_v2 r WHERE r.club_id='${club}'),
    'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.payment_records p JOIN public.payroll_periods q ON q.id=p.period_id WHERE q.club_id='${club}')
  )::text);`);
  const before=readOnly?snapshot():null;
  return {
    manifest:payroll,
    setSavedReadFault(value){
      assert.ok(readOnly);assert.ok(['none','null_money','empty'].includes(value));savedReadFault=value;
      log.push({payrollSavedTransportFault:value,mutation:false});
    },
    route(url,method,body){
      const name=url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_0-9]+)$/)?.[1];
      if(method==='POST'&&name){
        if(readOnly&&!['get_my_floor_operator_scope','dealer_control_club_ids','calculate_club_payroll'].includes(name)){
          return{status:403,value:{message:'LOCAL_PAYROLL_READ_ONLY'}};
        }
        let statement;
        if(name==='get_my_pt_wage'&&selfSalary){
          assert.deepEqual(body,{p_dealer_id:payroll.dealer});statement=`SELECT public.get_my_pt_wage('${payroll.dealer}');`;
        }else if(name==='get_my_floor_operator_scope'){
          assert.deepEqual(body,{});
          statement="SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM public.get_my_floor_operator_scope() t;";
        }else if(name==='dealer_control_club_ids'){
          assert.deepEqual(body,{_user_id:actor});statement=`SELECT coalesce(jsonb_agg(t.id),'[]'::jsonb) FROM public.dealer_control_club_ids('${actor}') AS t(id);`;
        }else if(name==='calculate_club_payroll'){
          assert.deepEqual(body,{p_club_id:club,p_start_date:payroll.start,p_end_date:payroll.end});
          statement=`SELECT public.calculate_club_payroll('${club}','${payroll.start}','${payroll.end}');`;
        }else if(name==='save_payroll_period_v2'){
          assert.deepEqual(Object.keys(body).sort(),['p_club_id','p_end_date','p_month','p_payroll_rows','p_request_id','p_start_date','p_year']);
          assert.equal(body.p_club_id,club);assert.equal(body.p_year,payroll.year);assert.equal(body.p_month,payroll.month);
          assert.equal(body.p_start_date,payroll.start);assert.equal(body.p_end_date,payroll.end);assert.ok(uuid(body.p_request_id));
          assert.equal(body.p_payroll_rows.length,1);assert.equal(body.p_payroll_rows[0].dealer_id,payroll.dealer);
          statement=`SELECT public.save_payroll_period_v2('${club}',${payroll.year},${payroll.month},'${payroll.start}','${payroll.end}',${literal(JSON.stringify(body.p_payroll_rows))}::jsonb,'${body.p_request_id}');`;
        }else if(name==='get_payroll_save_receipt_v2'){
          assert.deepEqual(Object.keys(body).sort(),['p_club_id','p_request_id']);assert.equal(body.p_club_id,club);assert.ok(uuid(body.p_request_id));
          statement=`SELECT coalesce(public.get_payroll_save_receipt_v2('${body.p_request_id}','${club}'),'null'::jsonb);`;
        }else if(name==='cancel_unresolved_payroll_save_v2'){
          assert.deepEqual(Object.keys(body).sort(),['p_club_id','p_month','p_request_id','p_year']);assert.equal(body.p_club_id,club);
          assert.equal(body.p_year,payroll.year);assert.equal(body.p_month,payroll.month);assert.ok(uuid(body.p_request_id));
          statement=`SELECT public.cancel_unresolved_payroll_save_v2('${body.p_request_id}','${club}',${payroll.year},${payroll.month});`;
        }else return {status:403,value:{message:'LOCAL_PAYROLL_MUTATION_NOT_IN_CANARY_SCOPE'}};
        if(name==='save_payroll_period_v2'&&fault==='before_commit'){
          log.push({payrollFault:'LOCAL_REQUEST_NOT_DELIVERED_TO_DB',request:body.p_request_id});
          return{status:503,value:{message:'LOCAL_REQUEST_NOT_DELIVERED_TO_DB'}};
        }
        const value=query(statement);
        log.push({payrollRpc:name,request:body.p_request_id??null,outcome:value?.outcome??'read'});
        if(name==='get_my_pt_wage')log.push({dealerSelfRead:{dealer:payroll.dealer,balance:value.balance_vnd,rate:value.hourly_rate_vnd,open:value.current_shift_open}});
        if(name==='save_payroll_period_v2'&&drop){drop=false;log.push({payrollFault:'LOCAL_RESPONSE_LOST_AFTER_COMMIT',request:body.p_request_id});
          return{status:503,value:{message:'LOCAL_RESPONSE_LOST_AFTER_COMMIT'}};}
        return{status:200,value};
      }
      if(method!=='GET')return null;
      if(selfSalary&&url.pathname==='/rest/v1/dealers'&&url.searchParams.get('select')?.includes('clubs(name)')){
        assert.equal(url.searchParams.get('user_id'),`eq.${actor}`);assert.equal(url.searchParams.get('deleted_at'),'is.null');
        return{status:200,value:query(`SELECT coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('clubs',jsonb_build_object('name',c.name))),'[]'::jsonb)
          FROM public.dealers d JOIN public.clubs c ON c.id=d.club_id WHERE d.id='${payroll.dealer}' AND d.user_id='${actor}' AND d.deleted_at IS NULL;`)};
      }
      if(selfSalary&&url.pathname==='/rest/v1/profiles'&&url.searchParams.get('select')==='region,avatar_url,is_verified'){
        assert.equal(url.searchParams.get('user_id'),`eq.${actor}`);
        return{status:200,value:query(`SELECT coalesce((SELECT jsonb_build_object('region',region,'avatar_url',avatar_url,'is_verified',is_verified)
          FROM public.profiles WHERE user_id='${actor}'),'null'::jsonb);`)};
      }
      if(url.pathname==='/rest/v1/clubs'&&url.searchParams.has('id')){
        const ids=url.searchParams.get('id');assert.match(ids,/^in\.\([a-f0-9",-]+\)$/i);
        const parsed=ids.slice(4,-1).replaceAll('"','').split(',');assert.ok(parsed.every(uuid));
        return{status:200,value:query(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM (SELECT id,name FROM public.clubs WHERE id IN(${parsed.map(literal).join(',')})) t;`)};
      }
      if(url.pathname==='/rest/v1/payroll_periods'){
        assert.equal(url.searchParams.get('club_id'),`eq.${club}`);assert.equal(url.searchParams.get('period_year'),`eq.${payroll.year}`);
        assert.equal(url.searchParams.get('period_month'),`eq.${payroll.month}`);
        const value=query(`SELECT coalesce((SELECT to_jsonb(p) FROM public.payroll_periods p WHERE club_id='${club}' AND period_year=${payroll.year} AND period_month=${payroll.month}),'null'::jsonb);`);
        log.push({payrollRead:'period',found:!!value});return{status:200,value};
      }
      if(['/rest/v1/dealer_payroll','/rest/v1/payment_records'].includes(url.pathname)){
        const id=periodId(url.searchParams.get('period_id')?.replace(/^eq\./,''));
        if(url.pathname.endsWith('/payment_records'))return{status:200,value:query(`SELECT coalesce((SELECT to_jsonb(p) FROM public.payment_records p WHERE period_id='${id}'),'null'::jsonb);`)};
        const embed=url.searchParams.get('select')?.replaceAll(' ','')==='id,dealer_id,payroll_adjustments!payroll_adjustments_payroll_id_fkey(*)';
        assert.ok(embed||url.searchParams.get('select')==='*');
        const value=embed?query(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'dealer_id',p.dealer_id,'payroll_adjustments',
          (SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) FROM public.payroll_adjustments a WHERE a.payroll_id=p.id))),'[]'::jsonb)
          FROM public.dealer_payroll p WHERE period_id='${id}';`):query(`SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) FROM public.dealer_payroll p WHERE period_id='${id}';`);
        log.push({payrollRead:embed?'adjustments':'saved_rows',count:value.length});
        if(!embed&&savedReadFault!=='none'){
          assert.equal(value.length,1,'fault must start from exact canonical saved row');
          log.push({payrollSavedTransportFault:savedReadFault,mutation:false});
          return{status:200,value:savedReadFault==='empty'?[]:[{...value[0],net_pay_vnd:null}]};
        }
        return{status:200,value};
      }
      return null;
    },
    cleanup(){
      if(readOnly){assert.equal(snapshot(),before);console.log('LOCAL_PAYROLL_SAVED_READ_NO_PERIOD_ROW_RECEIPT_PAYMENT_DELTA_PASS');}
      if(!selfSalary)return;
      assert.equal(sql(`WITH restored AS (UPDATE public.dealers SET user_id=NULL WHERE id='${payroll.dealer}' AND club_id='${club}' AND user_id='${actor}' RETURNING 1) SELECT count(*) FROM restored;`),'1');
      assert.equal(sql(`SELECT user_id IS NULL FROM public.dealers WHERE id='${payroll.dealer}';`),'t');
      console.log('LOCAL_DEALER_SELF_SYNTHETIC_LINK_REMOVED_PASS');
    },
    evidence(){return JSON.parse(sql(`SELECT jsonb_build_object('club','${club}','dealer','${payroll.dealer}',
      'periods',(SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) FROM public.payroll_periods p WHERE club_id='${club}'),
      'rows',(SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) FROM public.dealer_payroll p WHERE club_id='${club}'),
      'receipts',(SELECT count(*) FROM floor_private.payroll_save_receipts_v2 WHERE club_id='${club}'),
      'receiptOutcomes',(SELECT coalesce(jsonb_agg(jsonb_build_object('request',request_id,'outcome',response->>'outcome')),'[]'::jsonb)
        FROM floor_private.payroll_save_receipts_v2 WHERE club_id='${club}'),
      'payrollFingerprint',(SELECT md5(jsonb_build_object('periods',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.payroll_periods p WHERE club_id='${club}'),
        'rows',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.dealer_payroll p WHERE club_id='${club}'))::text)),
      'payments',(SELECT count(*) FROM public.payment_records p JOIN public.payroll_periods q ON q.id=p.period_id WHERE q.club_id='${club}'));`));},
  };
}
