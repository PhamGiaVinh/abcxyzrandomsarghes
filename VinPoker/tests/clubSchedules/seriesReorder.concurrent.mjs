import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
const database='vinpoker_ops_series_reorder_overlap';
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.equal(process.env[key],undefined);
const command=process.platform==='win32'?'wsl':'psql';
function args(app){const p=['-X','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55441','-U','postgres','-d',database];return process.platform==='win32'?['-d','PokerVision-P16-4C-Eval','--','env',`PGAPPNAME=${app}`,'psql',...p]:p;}
const guard=`DO $$ BEGIN IF current_database()<>'${database}' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port()<>55441 OR current_user<>'postgres' OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 THEN RAISE EXCEPTION 'owned_series_overlap_only'; END IF; END $$;`;
function execute(sql){const r=spawnSync(command,args('series92-observer'),{input:guard+sql,encoding:'utf8',env:{...process.env,PGAPPNAME:'series92-observer'},timeout:15000});assert.equal(r.status,0,r.stderr+r.stdout);return r.stdout.trim();}
function start(app,sql){const child=spawn(command,args(app),{env:{...process.env,PGAPPNAME:app},stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',x=>{out+=x;});child.stderr.on('data',x=>{err+=x;});const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve(out):reject(Error(err+out)));});child.stdin.end(guard+sql);return done;}
async function observe(condition){const until=Date.now()+8000;while(Date.now()<until){if(execute(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${condition});`)==='t')return;await delay(40);}throw Error('True overlap barrier not observed: '+condition);}
const actor='ee920000-0000-4000-8000-000000000001',club='ee920000-0000-4000-8000-000000000002';
const a='ee920000-0000-4000-8000-000000000003',b='ee920000-0000-4000-8000-000000000004',c='ee920000-0000-4000-8000-000000000005';
execute(`DROP TRIGGER series_reorder_fixture_fail ON public.club_series_images;UPDATE public.club_series_images SET position=CASE WHEN id='${a}' THEN 0 ELSE 1 END WHERE club_id='${club}';`);
const context=`SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claim.sub='${actor}';`;
const expected=`'${JSON.stringify([{id:a,position:0},{id:b,position:1}])}'`;
const request=(key)=>`'${club}',${expected},ARRAY['${b}','${a}']::uuid[],'${key}','${actor}'`;
function receipt(out){return JSON.parse(out.split('\n').find(x=>x.startsWith('{')));}
async function overlap(firstSql,secondSql,label){
 const first=start(`series92-${label}-first`,`BEGIN;${context}${firstSql} RESET ROLE;SELECT pg_sleep(2);COMMIT;`);
 await observe(`application_name='series92-${label}-first' AND wait_event='PgSleep'`);
 const second=start(`series92-${label}-second`,`BEGIN;${context}${secondSql}COMMIT;`);
 await observe(`application_name='series92-${label}-second' AND cardinality(pg_blocking_pids(pid))>0`);
 return Promise.all([first,second]);
}
const key='ee940000-0000-4000-8000-000000000001';
const outputs=await overlap(`SELECT public.reorder_club_series_images_v1(${request(key)});`,`SELECT public.reorder_club_series_images_v1(${request(key)});`,'replay');
assert.equal(receipt(outputs[0]).ok,true);assert.deepEqual(receipt(outputs[0]),receipt(outputs[1]));
assert.equal(execute(`SELECT count(*) FROM public.table_operation_receipts WHERE actor_id='${actor}' AND operation_type='reorder_club_series_images_v1' AND request_id='${key}';`),'1');
execute(`UPDATE public.club_series_images SET position=CASE WHEN id='${a}' THEN 0 ELSE 1 END WHERE club_id='${club}';`);
const stale=await overlap(`SELECT public.reorder_club_series_images_v1(${request('ee940000-0000-4000-8000-000000000002')});`,`SELECT public.reorder_club_series_images_v1(${request('ee940000-0000-4000-8000-000000000003')});`,'stale');
assert.equal(receipt(stale[0]).ok,true);assert.equal(receipt(stale[1]).error,'reorder_conflict');
execute(`UPDATE public.club_series_images SET position=CASE WHEN id='${a}' THEN 0 ELSE 1 END WHERE club_id='${club}';`);
const phantom=await overlap(`INSERT INTO public.club_series_images(id,club_id,image_url,position) VALUES('${c}','${club}','https://example.test/c.jpg',2);`,`SELECT public.reorder_club_series_images_v1(${request('ee940000-0000-4000-8000-000000000004')});`,'insert');
assert.equal(receipt(phantom[1]).error,'reorder_conflict');
assert.equal(execute(`SELECT count(*) FROM public.club_series_images WHERE club_id='${club}';`),'3');
console.log('SERIES92_TRUE_BLOCKING_SAME_KEY_ONE_RECEIPT_STALE_REORDER_AND_CONCURRENT_INSERT_FENCED_PASS');
// Committed fixtures retained in the exact owned clone. Never rerun as fresh.
