import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,dirname,isAbsolute,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';

// Build on the checkout host, run with the already-installed Linux Node/psql.
// Only the esbuild loading boundary changes. SQL, worker and shadow stay intact.
const output=process.argv[2];assert.ok(process.argv.length===3&&output&&isAbsolute(output));
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const hash=text=>createHash('sha256').update(text).digest('hex');
const read=file=>readFileSync(join(root,file),'utf8').replaceAll('\r\n','\n');
const replace=(source,before,after)=>{assert.equal(source.split(before).length,2,'Unique build boundary required');return source.replace(before,after);};
const compile=async file=>(await build({entryPoints:[join(root,file)],bundle:true,write:false,platform:'node',format:'esm',target:'node18',logLevel:'silent'})).outputFiles[0].text;
const worker=await compile('supabase/functions/public-hud-projector-v1/worker.ts');
const classifier=await compile('supabase/functions/_shared/publicHudContribution.ts');
const driverSource=read('tests/publicHud/backfill.native.mjs'),shadowSource=read('scripts/ops/tracker-hud-shadow.mjs');
let driver=replace(driverSource,"import {build} from 'esbuild';\n",'');
driver=replace(driver,"const bundled=await build({entryPoints:['supabase/functions/public-hud-projector-v1/worker.ts'],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'});",'const bundled={outputFiles:[{text:'+JSON.stringify(worker)+'}]};');
let shadow=replace(shadowSource,"import {build} from 'esbuild';\n",'');
shadow=replace(shadow,"const result=await build({entryPoints:[resolve(root,'supabase/functions/_shared/publicHudContribution.ts')],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'});",'const result={outputFiles:[{text:'+JSON.stringify(classifier)+'}]};');
// One sanitized entrypoint for both stdin and saved-file execution. Keep the
// shadow's target validation and read-only transaction unchanged.
shadow=replace(shadow,"if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Shadow certification failed; no activation was performed');process.exitCode=1;});",
 "await main().catch(()=>{console.error('Shadow certification failed; no activation was performed');process.exitCode=1;});");
const bundle=async(contents,sourcefile,resolveDir)=>(await build({stdin:{contents,sourcefile,resolveDir},bundle:true,write:false,platform:'node',format:'esm',target:'node18',logLevel:'silent'})).outputFiles[0].text;
const driverBundle=await bundle(driver,'backfill.native.mjs',join(root,'tests/publicHud'));
const shadowBundle=await bundle(shadow,'tracker-hud-shadow.mjs',join(root,'scripts/ops'));
mkdirSync(output,{recursive:true});
writeFileSync(join(output,'backfill-runtime.mjs'),driverBundle,{flag:'wx'});
writeFileSync(join(output,'shadow-runtime.mjs'),shadowBundle,{flag:'wx'});
const manifest={kind:'NATIVE_LINUX_TEST_RUNTIME_NOT_DEPLOYMENT',workerSourceSha256:hash(read('supabase/functions/public-hud-projector-v1/worker.ts')),
 workerBundleSha256:hash(worker),classifierBundleSha256:hash(classifier),driverSourceSha256:hash(driverSource),shadowSourceSha256:hash(shadowSource),
 driverBundleSha256:hash(driverBundle),shadowBundleSha256:hash(shadowBundle),builtWithNode:process.version,target:'node18',productionCapacityClaim:false,
 limitations:'Native PostgreSQL fixture transport only;precompilation replaces esbuild loading,not source/RPC/worker/classifier/shadow behavior. Not HTTP/Edge or spectator capacity.'};
writeFileSync(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(manifest));
