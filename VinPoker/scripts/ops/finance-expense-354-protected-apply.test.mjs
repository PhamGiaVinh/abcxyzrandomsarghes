import assert from 'node:assert/strict';
import test from 'node:test';
import {applyExpense354,prepareExpense354} from './finance-expense-354-protected-apply.mjs';

const pre={database:'postgres',actor:'postgres',ledgerCount:0,
  functionHash:'ec4209e4c6e11503ecd4e52c5d4be0ee',readerHash:'15d1b9d63df67e34ee1d999adc7ffe08',
  functionOwner:'postgres',securityDefiner:true,volatility:'v',searchPath:['search_path=public'],
  executors:['authenticated','postgres','service_role'],aclHash:'a'.repeat(32),uniqueIndexValid:true,anonymousExecute:false};
const post={...pre,ledgerCount:1,functionHash:'a96cdd76edcbfb03cc1812b26047e179',searchPath:['search_path=""']};
const exact={count:1,exact:true};

test('constructs only the exact reviewed migration and atomic ledger receipt',()=>{
  const atomic=prepareExpense354(process.env.RELEASE_SOURCE_ROOT);
  assert.match(atomic,/INSERT INTO supabase_migrations\.schema_migrations/);
  assert.match(atomic,/20270128000354/);
  assert.match(atomic,/expense_idempotency_conflict/);
});
for(const [field,value] of Object.entries({database:'other',actor:'authenticator',ledgerCount:1,
  functionHash:'changed',readerHash:'changed',functionOwner:'other',securityDefiner:false,volatility:'s',
  searchPath:['search_path=public, evil'],executors:['authenticated','postgres','service_role','unknown'],
  uniqueIndexValid:false,anonymousExecute:true})) {
  test(`refuses catalog drift before any write: ${field}`,()=>{
    assert.throws(()=>applyExpense354('atomic',{json:()=>({...pre,[field]:value}),
      execute:()=>assert.fail('unexpected production write')},()=>{}),/preflight differs/);
  });
}
test('executes once then requires exact receipt, definition and unchanged ACL',()=>{
  const responses=[pre,exact,post],writes=[],events=[];
  applyExpense354('atomic',{json:()=>responses.shift(),execute:q=>writes.push(q)},e=>events.push(e));
  assert.deepEqual(writes,['atomic']); assert.deepEqual(responses,[]);
  assert.deepEqual(events,['EXPENSE354_COMMITTED_EXACT_AND_POSTCHECK_PASS']);
});
test('lost response inspects the receipt and stops without repeating a money-path apply',()=>{
  const responses=[pre,exact],events=[];let attempts=0;
  assert.throws(()=>applyExpense354('atomic',{json:()=>responses.shift(),execute:()=>{attempts++;throw Error('timeout');}},
    e=>events.push(e)),/requires review/);
  assert.equal(attempts,1);assert.deepEqual(events,['EXPENSE354_STOP receipt=committed-exact']);
});
test('does not accept an imprecise migration receipt',()=>{
  const responses=[pre,{count:1,exact:false}];
  assert.throws(()=>applyExpense354('atomic',{json:()=>responses.shift(),execute:()=>{}},()=>{}),/receipt differs/);
});
for(const patch of [{aclHash:'changed'},{functionHash:'changed'},{readerHash:'changed'},
  {executors:['authenticated','postgres','service_role','unknown']},{searchPath:['search_path=public']}]) {
  test(`stops after commit if the deployed catalog differs: ${Object.keys(patch)[0]}`,()=>{
    const responses=[pre,exact,{...post,...patch}];
    assert.throws(()=>applyExpense354('atomic',{json:()=>responses.shift(),execute:()=>{}},()=>{}),/postcheck differs/);
  });
}
