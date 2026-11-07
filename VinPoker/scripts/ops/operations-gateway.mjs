import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {audienceGatewayConfig,prepareAudienceGatewayTemplate} from './operations-audience-scope.mjs';

// The pinned CLI hardcodes one Kong worker. Resource preparation belongs only
// to the owned disposable1000audience environment, never hosted Supabase.
assert.equal(process.env.CASHIER_SCHEMA_MODE,'current');
assert.equal(process.env.LOCAL_OPERATIONS_REALTIME,'1');
assert.equal(process.env.LOCAL_OPERATIONS_CANDIDATE_PROBE,'1');
assert.equal(process.env.LOCAL_OPERATIONS_AUDIENCE,'1000');
const [container,network,reportFile]=process.argv.slice(2);
assert.match(container??'',/^supabase_kong_cashier-e2e-[A-Za-z0-9]+$/);
assert.match(network??'',/^supabase_network_cashier-e2e-[A-Za-z0-9]+$/);
assert.ok(reportFile?.endsWith('/output/operations-latency/operations-gateway-http.json'));
const run=(args,input)=>{
 try{return execFileSync('docker',args,{input,encoding:'utf8',timeout:30000,maxBuffer:1024*1024,stdio:['pipe','pipe','pipe']});}
 catch{throw Error('Isolated gateway command failed; private output withheld');}
};
const networks=JSON.parse(run(['inspect',container,'--format','{{json .NetworkSettings.Networks}}']));
assert.deepEqual(Object.keys(networks),[network],'Gateway must still be on its sole isolated network');
const read=(allowImplicitLimits=false)=>{
 const config=audienceGatewayConfig(run(['exec',container,'cat','/usr/local/kong/nginx.conf']),{allowImplicitLimits});
 assert.ok(config,'Unambiguous numeric generated Kong directives required');return config;
};
const before=read(true);
const receipt={kind:'ISOLATED_OPERATIONAL_GATEWAY_RESOURCE_PREPARATION',phase:'before',before,after:null,productionChanged:false,qualification:false};
const save=()=>writeFileSync(reportFile,JSON.stringify(receipt,null,2));save();
try{
 // Keep routes,plugins,JWTs,tenant and firewall intact. Kong re-renders its
 // existing custom template and gracefully reloads within this container.
 const source=run(['exec',container,'cat','/home/kong/custom_nginx.template']),prepared=prepareAudienceGatewayTemplate(source);
 receipt.originalTemplateSha256=createHash('sha256').update(source).digest('hex');
 receipt.preparedTemplateSha256=createHash('sha256').update(prepared).digest('hex');
 run(['exec','-i',container,'sh','-c','cat > /home/kong/operations_nginx.template'],prepared);
 run(['exec','-e','KONG_NGINX_WORKER_PROCESSES=4',container,'kong','reload','--nginx-conf','/home/kong/operations_nginx.template']);
 const after=read();receipt.after=after;save();
 assert.equal(after.workers,4);assert.equal(after.connectionsPerWorker,4096);assert.equal(after.fileLimitPerWorker,16384);
 receipt.phase='configured';save();
}catch{
 receipt.phase='failed';save();throw Error('Isolated gateway resource preparation failed; private command output withheld');
}
