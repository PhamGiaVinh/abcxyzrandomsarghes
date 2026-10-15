import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
test('normal application bootstrap does not import or start the retired remote GTO cache',()=>{
 assert.doesNotMatch(app,/initRemoteRanges/);
 assert.doesNotMatch(app,/from\s+["']@\/lib\/gto\/precomputed["']/);
});
test('retired writable range editor is not an application route or lazy bundle',()=>{
 assert.doesNotMatch(app,/\/admin\/gto-ranges/);
 assert.doesNotMatch(app,/import\(["']\.\/components\/RangeEditor["']\)/);
});
test('operational and dedicated preview routes remain registered',()=>{
 for(const route of ['/floor','/tracker','/dealer-swing','/chip-ops']) assert.ok(app.includes(`path="${route}"`),route);
 for(const guard of ['isSeriesMarketDevRoute','isTrackerUnifiedOpsDevRoute','isPayrollStatementDevRoute','isTrackerVoiceUatPreviewRoute']) {
  assert.ok(app.includes(`if (${guard}`),guard);
 }
});
