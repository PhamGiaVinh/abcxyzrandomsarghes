import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {loadPackage} from './spectator342344-release-plan.mjs';
import {priorFiles,normalizeDownloadedPaths,stageApiSource} from './spectator342344-edge-release.mjs';
// Credential-free transport regression only. No hosted bundling/runtime claim.
const root=process.env.RELEASE_SOURCE_ROOT;assert.ok(root);
const project='aaaaaaaaaaaaaaaaaaaa',slug='public-spectator-projector-v2';
const cli=process.env.SPECTATOR_TEST_CLI;assert.ok(cli,'Explicit pinned CLI binary required');
assert.equal(execFileSync(cli,['--version'],{encoding:'utf8'}).trim(),'2.101.0');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const [label,files] of [['candidate',loadPackage(root).manifest.edgeFiles],['prior',priorFiles]]){
 const work=mkdtempSync(join(tmpdir(),'spectator-api-transport-'));
 for(const file of files){const dest=join(work,file.path);mkdirSync(dirname(dest),{recursive:true});const bytes=label==='candidate'?readFileSync(join(root,file.path)):execFileSync('git',['show','6fa88c1428146948b5cb74dbcf3efc38aabe5879:VinPoker/'+file.path],{cwd:root});writeFileSync(dest,bytes);}
 const staged=stageApiSource(work,files);
 let calls=0,projectReads=0,failure=null;
 const server=createServer(async(req,res)=>{try{
  if(req.method==='GET'&&req.url===`/v1/projects/${project}`){assert.ok(++projectReads<=2);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:project,name:'transport-fixture',organization_id:'synthetic-org',organization_slug:'synthetic-org',region:'ap-southeast-1',status:'ACTIVE_HEALTHY'}));return;}
  assert.equal(req.method,'POST',`Unexpected fake API request ${req.method} ${req.url}`);assert.equal(req.url,`/v1/projects/${project}/functions/deploy?slug=${slug}`);assert.match(req.headers.authorization??'',/^Bearer sbp_0+$/);
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const form=await new Response(Buffer.concat(chunks),{headers:{'content-type':req.headers['content-type']}}).formData();
  const meta=JSON.parse(form.get('metadata'));assert.equal(meta.import_map_path,'deno.json');assert.equal(meta.entrypoint_path,`supabase/functions/${slug}/index.ts`);assert.equal(meta.verify_jwt,false);assert.deepEqual(meta.static_patterns,['supabase/functions/_shared/vendor/tslib-2.8.1.mjs']);
  const uploaded=form.getAll('file');const paths=normalizeDownloadedPaths(uploaded.map(f=>f.name));assert.deepEqual([...paths].sort(),files.map(f=>f.path).sort());
  for(const [i,file] of uploaded.entries()){const wanted=files.find(f=>f.path===paths[i]);assert.equal(hash(Buffer.from(await file.arrayBuffer()).toString('utf8').replace(/\r\n?/g,'\n')),wanted.sha256);}
  calls++;res.writeHead(201,{'content-type':'application/json'});res.end(JSON.stringify({id:'00000000-0000-4000-8000-000000000000',name:slug,slug,status:'ACTIVE',version:1,verify_jwt:false}));
 }catch(error){failure=error;res.writeHead(400);res.end('Synthetic request rejected');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
 const profile=join(work,'profile.json');writeFileSync(profile,JSON.stringify({name:'loopback-only',api_url:`http://127.0.0.1:${port}`,dashboard_url:`http://127.0.0.1:${port}`,project_host:'example.invalid'}));
 try{
  const code=await new Promise((done,reject)=>{const child=spawn(cli,['functions','deploy',slug,'--project-ref',project,'--use-api','--no-verify-jwt','--import-map',resolve(staged,'deno.json'),'--workdir',staged,'--profile',profile],{cwd:work,env:{PATH:process.env.PATH,HOME:work,TMPDIR:work,SUPABASE_ACCESS_TOKEN:'sbp_'+'0'.repeat(40)},stdio:['ignore','pipe','pipe'],timeout:60000});child.stdout.resume();child.stderr.resume();child.on('error',reject);child.on('close',done);});
  if(failure)throw failure;assert.equal(code,0,'Pinned CLI loopback command failed; raw output withheld');assert.equal(calls,1);console.log(`PINNED_CLI_API_MULTIPART_${label.toUpperCase()}_${files.length}_EXACT_FILES_PASS`);
 }finally{await new Promise(r=>server.close(r));}
}
