import assert from 'node:assert/strict';
import {parsePublicTableHistoryPage} from '../../src/components/cashier/tournament-live/viewer-hub/publicTableHistory.ts';
let raw='';for await(const part of process.stdin)raw+=part;
const data=JSON.parse(raw.trim());
assert.equal(data.tour,'4cd3af4d-7e1d-4042-855f-04fb6777e580');
assert.equal(data.table,'8508d715-cd7c-4f1f-bb0d-223d967e355c');
assert.equal(data.pages.length,3,'retained13hands must traverse3pages');
assert.deepEqual(data.pages.map(p=>p.items.length),[5,5,3]);
const full=parsePublicTableHistoryPage(data.all,data.tour,data.table);
assert.equal(full?.access,'public');assert.equal(full.items.length,13);assert.equal(full.nextCursor,null);
const parsed=data.pages.map(page=>parsePublicTableHistoryPage(page,data.tour,data.table));
for(let i=0;i<parsed.length;i++){
 assert.equal(parsed[i]?.access,'public');
 assert.deepEqual(parsed[i].items.map(row=>row.handId),data.pages[i].items.map(row=>row.handId));
 if(i<2){const last=parsed[i].items.at(-1);assert.deepEqual(parsed[i].nextCursor,{createdAt:last.createdAt,handId:last.handId});}
 else assert.equal(parsed[i].nextCursor,null);
}
const ids=parsed.flatMap(page=>page.items.map(row=>row.handId));
assert.equal(new Set(ids).size,13);assert.deepEqual(ids,full.items.map(row=>row.handId));
assert.deepEqual(parsed.flatMap(page=>page.items),full.items,'same full card/proof projection across page boundaries');
assert.equal(data.invalidLimit.error,'invalid_request');assert.equal(data.partialCursor.error,'invalid_request');assert.equal(data.wrongTable.error,'table_out_of_scope');
for(const value of [data.invalidLimit,data.partialCursor,data.wrongTable])assert.equal(parsePublicTableHistoryPage(value,data.tour,data.table),null);
console.log('HISTORY363_NATIVE_ANON_3PAGES_13UNIQUE_FULL_PROJECTION_CURSOR_NEGATIVES_PRODUCT_PARSER_PASS');
