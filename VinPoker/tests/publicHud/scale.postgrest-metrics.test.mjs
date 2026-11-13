import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parsePostgrestPoolMetrics,parsePostgrestServerTiming,readBoundedMetrics} from './scale.postgrest-metrics.mjs';
const sample='pgrst_db_pool_available 2\npgrst_db_pool_waiting 31\npgrst_db_pool_max 10\npgrst_db_pool_timeouts_total 0\n';
test('retains only known finite pool counts and distinguishes missing from zero',()=>{
 const parsed=parsePostgrestPoolMetrics('# HELP secret\n'+sample+'private_metric{token="secret"} 99\n');
 assert.equal(parsed.available,true);assert.equal(parsed.metrics.pgrst_db_pool_waiting,31);
 assert.equal(JSON.stringify(parsed).includes('secret'),false);
 assert.equal(parsePostgrestPoolMetrics('').available,false);
 assert.equal(parsePostgrestPoolMetrics(sample.replace('waiting 31','waiting 0')).metrics.pgrst_db_pool_waiting,0);
});
test('rejects malformed, repeated, oversized and impossible gauges without exporting input',()=>{
 for(const body of [sample+'pgrst_db_pool_waiting 1',sample.replace('waiting 31','waiting NaN'),sample.replace('waiting 31','waiting -1'),sample.replace('available 2','available 11'),sample.replace('waiting 31','waiting 1.5'),'x'.repeat(65537)]){
  assert.equal(parsePostgrestPoolMetrics(body).available,false);
 }
});
test('extracts only documented request phase durations',()=>{
 assert.deepEqual(parsePostgrestServerTiming('jwt;dur=1.2, transaction;dur=53, private;desc="secret"'),{available:true,phases:{jwt:1.2,transaction:53}});
 for(const body of [null,'','transaction;dur=-1','transaction;dur=NaN','jwt;dur=1,jwt;dur=2','x'.repeat(4097)])assert.equal(parsePostgrestServerTiming(body).available,false);
});
test('bounds streamed input and cancels oversized or failed responses',async()=>{
 assert.equal((await readBoundedMetrics(new Response(sample))).available,true);
 assert.deepEqual(await readBoundedMetrics(new Response(sample,{status:503})),{available:false,reason:'http'});
 let cancelled=false;
 const body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(65537));},cancel(){cancelled=true;}});
 assert.deepEqual(await readBoundedMetrics(new Response(body)),{available:false,reason:'invalid_size'});
 assert.equal(cancelled,true);
});
