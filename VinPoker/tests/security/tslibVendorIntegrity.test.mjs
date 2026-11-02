import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

test('vendored tslib preserves the existing frozen remote dependency bytes',()=>{
  const root=new URL('../../',import.meta.url);
  const url='https://esm.sh/tslib@2.8.1/denonext/tslib.mjs';
  const lock=JSON.parse(readFileSync(new URL('deno.lock',root),'utf8'));
  const config=JSON.parse(readFileSync(new URL('deno.json',root),'utf8'));
  const target='./supabase/functions/_shared/vendor/tslib-2.8.1.mjs';
  assert.equal(config.imports[url],target);
  assert.equal(lock.remote[url],'c38da5dd6da6281964435002ce204cd586634fe3bdfb24a0ee116f48cf3292e9');
  assert.equal(createHash('sha256').update(readFileSync(new URL(target,root))).digest('hex'),lock.remote[url]);
});
