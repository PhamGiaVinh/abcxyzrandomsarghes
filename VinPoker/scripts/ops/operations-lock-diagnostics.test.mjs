import test from'node:test';import assert from'node:assert/strict';
import{sanitizeLockSample,validateContainerIdentity}from'./operations-lock-diagnostics.mjs';
test('runner container IDs require independently inspected disposable name',()=>{
 validateContainerIdentity('a'.repeat(12),'/supabase_db_cashier-e2e-native-contract');
 assert.throws(()=>validateContainerIdentity('supabase_db_cashier-e2e-name','/supabase_db_cashier-e2e-name'));
 assert.throws(()=>validateContainerIdentity('a'.repeat(12),'/production-postgres'));
 assert.throws(()=>validateContainerIdentity('unsafe;command','/supabase_db_cashier-e2e-test'));
});
test('lock evidence exports only allowed metadata even when input contains private SQL',()=>{
 const row={at:'2026-11-11T18:00:00Z',query:'private bearer token',waits:[{pid:1,tag:'cashier',waitType:'Lock',waitEvent:'transactionid',xactAgeMs:10,query:'private arguments',blockers:[{pid:2,tag:'hud',query:'private'}]}]};
 const out=sanitizeLockSample(row);assert.equal(JSON.stringify(out).includes('private'),false);assert.deepEqual(out.waits[0].blockers,[{pid:2,tag:'hud'}]);
});
test('unknown classifications or malformed metadata cannot become evidence',()=>{
 const row={at:'2026-11-11T18:00:00Z',waits:[{pid:1,tag:'secret query',waitType:'Lock',waitEvent:'transactionid',xactAgeMs:10,blockers:[]}]};
 assert.throws(()=>sanitizeLockSample(row));assert.throws(()=>sanitizeLockSample({...row,at:'invalid'}));
});
