import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';

assert.equal(process.env.VINPOKER_RPC1039_LOCAL,'1');
const sql=input=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:20000,maxBuffer:4e6}).trim();
const read=query=>JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL statement_timeout='10s';${query}ROLLBACK;`));
const guard=read(`SELECT jsonb_build_object('db',current_database(),'host',host(inet_server_addr()),'port',inet_server_port(),'dir',current_setting('data_directory'),'comment',(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()),'external',(SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink')));`);
assert.equal(guard.db,'vinpoker_ranking860_local');assert.equal(guard.host,'127.0.0.1');assert.equal(guard.port,55441);assert.equal(guard.dir,'/tmp/vinpoker-sol-local-20261016-0e79a729/data');assert.equal(guard.external,0);
assert.equal(guard.comment,'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
const tour='46cab483-91e7-4220-aacf-e17bdf05269c',club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',actor='675fe35e-60a8-4452-bb90-e79486d54da6';

const response=JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;SELECT public.cashier_tour_worklist_v1('${club}','${tour}','','all',0,50);ROLLBACK;`));
assert.equal(response.ok,true);assert.equal(typeof response.enabled,'boolean');assert.equal(typeof response.updated_at,'string');assert.ok(Number.isFinite(Date.parse(response.updated_at)));for(const key of ['counter','completed','waiting_seat','needs_review','total'])assert.ok(Number.isSafeInteger(response.counts[key])&&response.counts[key]>=0);
const proof={kind:'ORDINARY_ACTOR_NATIVE_READ_ONLY_METADATA_CONTRACT',guard,rpc:'cashier_tour_worklist_v1',enabled:response.enabled,updated_at:response.updated_at,counts:response.counts,rows:response.rows.length};writeFileSync('D:/Quy trình/output/reports/cashier1040-native-metadata-contract-local-20261027.json',JSON.stringify(proof,null,2));console.log('Native current worklist metadata matches strict guard; no DB writes.');
