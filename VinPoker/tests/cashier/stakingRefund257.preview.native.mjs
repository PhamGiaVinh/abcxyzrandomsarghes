import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
assert.equal(process.env.VINPOKER_NATIVE_DB_TEST,'1');
const actor='675fe35e-60a8-4452-bb90-e79486d54da6',outsider='a364de8e-06b1-4428-a20d-ac614ec406e5',deal='e5370000-0000-4000-8000-000000000001';
let source=readFileSync('tests/cashier/refund537.fixture.rollback.sql','utf8');
assert.equal(source.split('SET LOCAL ROLE service_role;').length,2);
source=source.replace('SET LOCAL ROLE service_role;',()=>`
DO $$ BEGIN ASSERT NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id='${outsider}' AND role='super_admin');END $$;
INSERT INTO public.user_roles(user_id,role) SELECT '${outsider}','cashier' WHERE NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id='${outsider}' AND role='cashier');
SET LOCAL request.jwt.claim.sub='${outsider}';SET LOCAL ROLE authenticated;
DO $$ DECLARE denied boolean:=false;BEGIN
 BEGIN PERFORM public.get_staking_refund_preview_v1('${deal}');EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;ASSERT denied;
END $$;RESET ROLE;
SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL ROLE authenticated;
SELECT public.get_staking_refund_preview_v1('${deal}');
DO $$ DECLARE denied boolean:=false;BEGIN
 BEGIN PERFORM public.get_staking_refund_preview_v1('e5390000-0000-4000-8000-000000000001');EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;ASSERT denied;
END $$;RESET ROLE;SET LOCAL request.jwt.claim.sub='';SET LOCAL ROLE service_role;`);
source=source.replace('RESET ROLE;\nROLLBACK;',()=>`RESET ROLE;
SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL ROLE authenticated;
SELECT public.get_staking_refund_preview_v1('${deal}');RESET ROLE;
DO $$ BEGIN ASSERT NOT has_function_privilege('anon','public.get_staking_refund_preview_v1(uuid)','EXECUTE');
ASSERT NOT has_function_privilege('service_role','public.get_staking_refund_preview_v1(uuid)','EXECUTE');END $$;
ROLLBACK;`);
const output=execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',
 'PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:source,encoding:'utf8',timeout:30000});
const rows=output.trim().split('\n').map(line=>JSON.parse(line));assert.equal(rows.length,5);assert.deepEqual(rows[0],rows[4]);
assert.equal(rows[1].state,'eligible');assert.equal(rows[1].amount_vnd,110000);assert.equal(rows[1].purchase_count,2);assert.equal(rows[1].label,'LOCAL537 browser refund canary');
assert.equal(rows[2].success,true);assert.equal(rows[3].state,'refunded');assert.equal(rows[3].amount_vnd,110000);
assert.equal(rows[3].request_id,'e5370000-0000-4000-8000-000000000002');
console.log('REFUND257_NATIVE_PREVIEW110K_NOT1M_AND_RECEIPT_RECOVERY110K_ACTOR_TENANT_ACL_FULL_ROLLBACK_PASS');
