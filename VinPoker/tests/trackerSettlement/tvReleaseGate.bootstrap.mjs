// Local/CI fixture bootstrap for private helpers omitted by the public schema
// snapshot. Executes the original dependency source, never a permissive stub.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const database='vinpoker_ops_cash115_qualified_c';
for(const [key,value] of Object.entries({PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:database}))assert.equal(process.env[key],value);
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const prefix=process.platform==='win32'?['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${database}`,'psql']:[];
const sql=input=>execFileSync(prefix.length?'wsl':'psql',[...prefix,'-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:30_000,stdio:['pipe','pipe','pipe']}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('server_version_num')::int/10000;"),database+'|127.0.0.1|55441|17');
const dir=sql('SHOW data_directory');assert.ok(dir==='/tmp/vinpoker-sol-local-20261016-0e79a729/data'||process.env.GITHUB_ACTIONS==='true'&&dir==='/var/lib/postgresql/data');
assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');"),'f');
const source=readFileSync('supabase/pending-migrations/20260924165219_centerpoint_tournament_ops_release_v1.sql','utf8').replaceAll('\r','');
const names=['tournament_ops_release_allowed_v1','assert_tournament_ops_release_v1'];
const table=JSON.parse(sql(`SELECT jsonb_build_object('owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,
 'columns',(SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT jsonb_agg(pg_get_constraintdef(x.oid) ORDER BY x.conname) FROM pg_constraint x WHERE x.conrelid=c.oid),
 'browser_access',has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE'))
 FROM pg_class c WHERE c.oid='public.centerpoint_tournament_ops_release'::regclass;`));
assert.deepEqual(table,{owner:'postgres',rls:true,columns:[['id','boolean',true],['enabled','boolean',true],['allowed_club_ids','uuid[]',true],['updated_at','timestamp with time zone',true]],constraints:['CHECK (id)','PRIMARY KEY (id)'],browser_access:false});
const saveBefore=sql("SELECT md5(replace(pg_get_functiondef('public.save_tv_tournament_layout_v1(uuid,bigint,text,text,text,jsonb)'::regprocedure),chr(13),''));");
assert.equal(saveBefore,'c1dc34bb649fe67df29c12666d3b91d0','review TV writer drift before fixture bootstrap');
const present=names.map(name=>sql(`SELECT to_regprocedure('centerpoint_private.${name}(uuid)') IS NOT NULL;`));
assert.ok(present.every(v=>v==='t')||present.every(v=>v==='f'),'partial_release_helper_drift');
if(present.every(v=>v==='f')){
 assert.equal(sql('SELECT count(*) FROM public.centerpoint_tournament_ops_release;'),'0','unexpected gate data in incomplete fixture');
 sql(source);
}
for(const name of names){
 const expected=new RegExp('CREATE OR REPLACE FUNCTION centerpoint_private\\.'+name+'\\([\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;').exec(source)?.[1].trim();assert.ok(expected);
 const actual=JSON.parse(sql(`SELECT jsonb_build_object('body',replace(p.prosrc,chr(13),''),'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'volatility',p.provolatile,'config',p.proconfig,'acl',p.proacl)
  FROM pg_proc p WHERE p.oid='centerpoint_private.${name}(uuid)'::regprocedure;`));
 assert.equal(actual.body.trim(),expected);assert.equal(actual.owner,'postgres');assert.equal(actual.definer,true);assert.equal(actual.volatility,'s');
 assert.deepEqual(actual.config,['search_path=""']);assert.deepEqual(actual.acl.sort(),['postgres=X/postgres','service_role=X/postgres']);
}
assert.equal(sql("SELECT md5(replace(pg_get_functiondef('public.save_tv_tournament_layout_v1(uuid,bigint,text,text,text,jsonb)'::regprocedure),chr(13),''));"),saveBefore);
assert.equal(sql('SELECT count(*) FROM public.centerpoint_tournament_ops_release WHERE id AND NOT enabled AND cardinality(allowed_club_ids)=0;'),'1','fixture gate must remain closed before test');
console.log('LOCAL_TV_ORIGINAL_RELEASE_GATE_DEPENDENCY_QUALIFIED_PASS');
