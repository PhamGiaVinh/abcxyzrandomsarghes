import test from 'node:test';
import assert from 'node:assert/strict';
import {isolatedStartupFailure,isolatedStartupState} from './isolated-postgrest-pool.mjs';

test('startup transport evidence exports fixed codes only',()=>{
 const secret='private-token-host-and-query';
 assert.equal(isolatedStartupFailure({message:secret,cause:{code:'ECONNREFUSED',message:secret}}),'ECONNREFUSED');
 assert.equal(isolatedStartupFailure({name:'TimeoutError',message:secret}),'deadline');
 assert.equal(isolatedStartupFailure({cause:{code:secret},code:secret}),'other');
 assert.equal(isolatedStartupFailure(null),'other');
});
test('startup container evidence excludes state errors, paths and health output',()=>{
 const secret='private-container-error';
 const result=isolatedStartupState({Status:'exited',Running:false,Restarting:false,OOMKilled:true,ExitCode:137,
  Error:secret,Health:{Log:[{Output:secret}]},Config:{Env:[secret]}});
 assert.deepEqual(result,{status:'exited',running:false,restarting:false,oomKilled:true,exitCode:137});
 assert.deepEqual(isolatedStartupState({Status:secret,ExitCode:secret}),{status:'other',running:false,restarting:false,oomKilled:false,exitCode:null});
 assert.ok(!JSON.stringify(result).includes(secret));
});
