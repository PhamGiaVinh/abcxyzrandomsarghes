import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {createSePayWebhookNative} from './sepayWebhook.native.mjs';
assert.equal(process.env.VINPOKER_SEPAY1226_LOCAL,'1');assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
const phase=process.env.VINPOKER_SEPAY1226_PHASE;assert.ok(['before','after'].includes(phase));
const output='D:/Quy trình/output/reports/sepay1226-webhook-'+phase+'-native-local-20261028.json';assert.equal(existsSync(output),false);
const account='TEST-'+randomUUID(),literal=v=>"'"+String(v).replaceAll("'","''")+"'";
const guard=`DO $$ BEGIN ASSERT current_database()='vinpoker_ranking860_local' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';ASSERT (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database())='VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948';ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink'));END $$;`;
const sql=q=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',timeout:20000,maxBuffer:3e6,stdio:['pipe','pipe','pipe']}).trim();
const tables=['public.bank_transactions','public.bank_webhook_audit','public.cashier_buyin_movements','public.tournament_entries','public.tournament_seats','public.tournament_prize_payments','public.notifications','public.payment_settlements','public.club_payment_config'];
const proof=()=>JSON.parse(sql('BEGIN READ ONLY;'+guard+'SELECT to_jsonb(md5(jsonb_build_array('+tables.map(t=>'(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM '+t+' x)').join(',')+')::text));ROLLBACK;'));
const cases=[['0x10',null],['0XFF',null],['0b10',null],['0o10',null],[[1000],null],['  ',null],['1000.6',1001],['1e3',1000],[1000,1000]];
const ids=cases.map(()=>randomUUID()),before=proof(),state={phase,before,rows:[],sourceSha256:createHash('sha256').update(readFileSync('supabase/functions/sepay-webhook/index.ts')).digest('hex'),settlementCalls:0,provider:false};
let captured;
const service=async statement=>{
 const raw=sql('BEGIN;'+guard+`SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claim.role='service_role';SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL ROLE service_role;`+statement+`RESET ROLE;SELECT jsonb_build_object('probeRows',coalesce((SELECT jsonb_agg(jsonb_build_object('amount',amount,'status',status,'providerId',provider_txn_id)) FROM public.bank_transactions WHERE account_number=${literal(account)}),'[]'));ROLLBACK;`);
 const lines=raw.split(/\r?\n/).filter(line=>line.startsWith('{')||line.startsWith('['));
 if(statement.includes('INSERT INTO public.bank_transactions'))captured=JSON.parse(lines.at(-1)).probeRows[0];
 return JSON.parse(lines[0]);
};
try{
 const handler=createSePayWebhookNative(service,{account,providerIds:new Set(ids)});
 for(let i=0;i<cases.length;i++){
  const [amount,expected]=cases[i];captured=undefined;
  const response=await handler(new Request('http://local.invalid/functions/v1/sepay-webhook/TEST',{method:'POST',headers:{Authorization:'Apikey LOCAL_TEST_WEBHOOK'},body:JSON.stringify({id:ids[i],accountNumber:account,transferAmount:amount,transferType:'in',transactionDate:'2026-10-28 12:00:00',content:'UNMATCHED_LOCAL1226_TEST'})}));
  assert.equal(response.status,200);assert.ok(captured);state.rows.push({input:amount,expected,...captured});
 }
 for(const row of state.rows){assert.equal(row.amount,row.expected);assert.equal(row.status,row.expected===null?'quarantined':'unmatched');}
 state.qualified=true;
}catch(error){state.failure=String(error);throw error;}
finally{state.after=proof();state.unchanged=state.before===state.after;writeFileSync(output,JSON.stringify(state,null,2));assert.equal(state.unchanged,true);console.log('SEPAY1226_NATIVE_WEBHOOK_ROLLBACK_UNCHANGED');}
