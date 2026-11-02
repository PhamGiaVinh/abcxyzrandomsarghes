import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

// Called only after the guarded native parent's exact database/directory checks.
// No selection RPC invocation: inspect its real candidate SELECT and roll back locks.
export function inspectSePayCatalogPlan(sql){
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 const source=readFileSync('supabase/migrations/20270128000142_sepay_settlement_fair_batch_v1.sql','utf8');
 const body=source.match(/AS \$\$([\s\S]*?)\$\$;/)?.[1];assert.ok(body);
 const expected=createHash('md5').update(body.replaceAll('\r','')).digest('hex');
 const catalog=JSON.parse(sql(`SELECT jsonb_build_object('body',md5(replace(p.prosrc,chr(13),'')),
  'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig,
  'anon',has_function_privilege('anon',p.oid,'EXECUTE'),
  'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
  'service',has_function_privilege('service_role',p.oid,'EXECUTE'))
  FROM pg_proc p WHERE p.oid='public.sepay_take_settlement_batch_v1(uuid,integer)'::regprocedure;`));
 assert.equal(catalog.body,expected);assert.equal(catalog.owner,'postgres');assert.equal(catalog.definer,true);
 assert.deepEqual(catalog.config,['search_path=""']);assert.equal(catalog.anon,false);
 assert.equal(catalog.authenticated,false);assert.equal(catalog.service,true);
 assert.equal(sql(`SELECT relrowsecurity FROM pg_class WHERE oid='private.sepay_settlement_attempts'::regclass;`),'t');
 for(const role of ['anon','authenticated','service_role']){
  assert.equal(sql(`SELECT has_table_privilege('${role}','private.sepay_settlement_attempts','SELECT,INSERT,UPDATE,DELETE');`),'f');
 }
 const fixture=JSON.parse(sql(`SELECT jsonb_build_object('account',c.master_account_number,'rows',count(*))
  FROM public.club_payment_config c JOIN public.bank_transactions b ON b.account_number=c.master_account_number
  WHERE c.master_account_number LIKE 'TEST-%' AND c.is_active AND c.api_token_vault_key IS NOT NULL
   AND b.provider='sepay' AND b.status='unmatched' AND b.transfer_type='in' AND b.api_verified_at IS NOT NULL
  GROUP BY c.master_account_number ORDER BY count(*) DESC,c.master_account_number LIMIT 1;`)||'null');
 assert.ok(fixture&&fixture.rows>=500,'retained synthetic backlog required; never seed or use a real account');
 const account="'"+fixture.account.replaceAll("'","''")+"'";
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('bank',(SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id)
  FROM public.bank_transactions b WHERE b.account_number=${account}),'attempts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.bank_transaction_id)
  FROM private.sepay_settlement_attempts a JOIN public.bank_transactions b ON b.id=a.bank_transaction_id WHERE b.account_number=${account}))::text);`);
 const before=fingerprint();
 const plan=JSON.parse(sql(`BEGIN;SET LOCAL statement_timeout='5s';
  EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT b.id FROM public.bank_transactions b
  LEFT JOIN private.sepay_settlement_attempts a ON a.bank_transaction_id=b.id
  WHERE b.provider='sepay' AND b.account_number=${account} AND b.status='unmatched'
   AND b.transfer_type='in' AND b.api_verified_at IS NOT NULL
  ORDER BY a.last_attempt_at ASC NULLS FIRST,b.id LIMIT 500 FOR UPDATE OF b SKIP LOCKED;
  ROLLBACK;`));
 assert.equal(fingerprint(),before,'plan diagnostic changed bank/attempt rows');
 assert.equal(plan[0].Plan['Actual Rows'],500);
 const indexes=JSON.parse(sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('table',tablename,'name',indexname,'definition',indexdef)),'[]'::jsonb)
  FROM pg_indexes WHERE schemaname IN('public','private') AND tablename IN('bank_transactions','sepay_settlement_attempts');`));
 console.log('SEPAY142_EXACT_CATALOG_ACL_RLS_PASS',JSON.stringify(catalog));
 console.log('SEPAY142_RETAINED_BACKLOG_QUERY_PLAN_NO_DELTA',JSON.stringify({eligibleRows:fixture.rows,plan,indexes}));
}
