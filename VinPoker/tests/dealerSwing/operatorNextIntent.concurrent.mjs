import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {spawn,spawnSync} from 'node:child_process';
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGUSER,'postgres');assert.equal(process.env.PGDATABASE,'vinpoker_ops_next80_overlap');
for(const k of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[k]);
function sql(s){const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:s,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
assert.equal(sql('SHOW server_version_num;').slice(0,2),'17');
const fixture=readFileSync('tests/dealerSwing/massOpenSessions.pg17.sql','utf8'),marker='DO '+String.fromCharCode(36)+'scale'+String.fromCharCode(36);
assert.equal(fixture.split(marker).length,2);sql(fixture.split(marker)[0]+'\nRESET ROLE;COMMIT;');
sql(`INSERT INTO public.dealers(id,club_id,full_name,status)
 SELECT md5('next80dealer-'||n)::uuid,'e1800000-0000-4000-8000-000000000002','Next overlap TEST '||n,'active' FROM generate_series(1,3)n;
 INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,check_in_time,current_state)
 SELECT md5('next80attendance-'||n)::uuid,md5('next80dealer-'||n)::uuid,'e1800000-0000-4000-8000-000000000030',current_date,'checked_in',now(),'available' FROM generate_series(1,3)n;`);
const table='e1800000-0000-4000-8000-000000000011';
function context(){return JSON.parse(sql(`SELECT json_build_object('id',id,'session',table_session_id,'version',version)
 FROM public.dealer_assignments WHERE table_id='${table}' AND released_at IS NULL;`));}
const actor="SET ROLE authenticated;SET request.jwt.claim.sub='e1800000-0000-4000-8000-000000000001';SET request.jwt.claim.role='authenticated';";
function tx(name,query,hold=false){const child=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1']);let out='',error='';
 const done=new Promise(resolve=>{child.stdout.on('data',p=>out+=p);child.stderr.on('data',p=>error+=p);child.on('error',e=>resolve({code:-1,out,error:String(e)}));child.on('close',code=>resolve({code,out,error}));});
 child.stdin.write(`SET application_name='${name}';SET statement_timeout='15s';BEGIN;${query}\n`);
 if(!hold)child.stdin.end('COMMIT;\n');return {done,commit:()=>child.stdin.end('COMMIT;\n')};}
async function barrier(query){for(let i=0;i<200;i++){if(sql(query)==='t')return;await new Promise(r=>setTimeout(r,25));}assert.fail('next80 true-overlap barrier missing');}
function call(c,n,key){return `${actor} SELECT public.operator_plan_next_dealer_v1('${c.session}','${c.id}',${c.version},md5('next80attendance-${n}')::uuid,'${key}');`;}
async function overlap(first,second){const holder=tx('next80_holder',`SELECT id FROM public.game_tables WHERE id='${table}' FOR UPDATE;`,true);
 await barrier("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='next80_holder' AND wait_event='ClientRead');");
 const a=tx('next80_first',first),b=tx('next80_second',second);
 try{await barrier("SELECT count(*)=2 FROM pg_stat_activity WHERE application_name IN ('next80_first','next80_second') AND wait_event_type='Lock';");}finally{holder.commit();}
 assert.equal((await holder.done).code,0);return Promise.all([a,b].map(async t=>{const r=await t.done;assert.equal(r.code,0,r.error);return JSON.parse(r.out.split('\n').find(l=>l.startsWith('{')));}));}
let c=context();const sameKey='e1800000-0000-4000-8000-000000000096';
const replay=await overlap(call(c,1,sameKey),call(c,1,sameKey));assert.equal(replay[0].outcome,'changed');assert.deepEqual(replay[0],replay[1]);
assert.equal(sql(`SELECT count(*) FROM public.table_operation_receipts WHERE request_id='${sameKey}';`),'1');
c=context();const choices=await overlap(call(c,2,'e1800000-0000-4000-8000-000000000097'),call(c,3,'e1800000-0000-4000-8000-000000000098'));
assert.deepEqual(choices.map(r=>r.outcome).sort(),['changed','race_lost']);
assert.equal(sql(`SELECT count(*) FROM public.dealer_rotation_schedule WHERE table_id='${table}' AND slot_index=0 AND status='announced';`),'1');
assert.equal(sql("SELECT count(*) FROM public.dealer_attendance WHERE id IN(SELECT md5('next80attendance-'||n)::uuid FROM generate_series(1,3)n) AND current_state='pre_assigned';"),'1');
assert.equal(sql("SELECT count(*) FROM public.table_operation_receipts WHERE request_id IN('e1800000-0000-4000-8000-000000000097','e1800000-0000-4000-8000-000000000098');"),'1');
console.log('NEXT80_TRUE_OVERLAP_IDENTICAL_RECEIPT_AND_COMPETING_VERSION_PASS');
