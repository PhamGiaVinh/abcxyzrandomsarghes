// Verify retained browser DOM against this run's native oracle; not transport PASS.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const root='D:/Quy trình/output/reports/';
const native=JSON.parse(readFileSync(root+'tv1151-multiflight-native-browser-local-20261027.json','utf8'));
const summaries=[];
for(const [index,label] of ['flight-a','flight-b','d2'].entries()){
  const oracle=native.oracles[index];
  const dom=readFileSync(root+`tv1151-${label}-desktop-local-20261027.txt`,'utf8');
  assert.ok(dom.includes(`heading "${oracle.tournament.name}"`));
  for(const [label,value] of [['Players',oracle.counts.remaining],['Entries',oracle.counts.total_entries],['Incl. Re-Entries',oracle.counts.re_entries]]){
    assert.ok(dom.includes(`generic: ${label}\n    - generic: "${value}"`),`DOM/native mismatch ${oracle.alias} ${label}`);
  }
  const seconds=oracle.clock.remaining_seconds;
  const clock=oracle.tournament.status==='completed'?'--:--':`${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;
  assert.ok(dom.includes(`generic: ${clock}`)||dom.includes(`generic: "${clock}"`));
  summaries.push({alias:oracle.alias,identityMatches:true,players:oracle.counts.remaining,entries:oracle.counts.total_entries,clock,liveChips:oracle.counts.live_entry_stack});
}
assert.equal(native.unchanged,true);assert.equal(native.bodyBefore,native.bodyAfter);assert.equal(native.errors.length,0);
assert.equal(native.denied.length,44);
assert.ok(native.denied.every(item=>item.startsWith('GET /realtime/v1/websocket?')));
const out={kind:'RETAINED_BROWSER_DOM_MATCHES_NATIVE_READ_ONLY_SLICE',summaries,collectorExit:1,transportAccepted:false,wholeTvAccepted:false,wholeJourneysAccepted:false,realtimeAttemptsUnsupported:native.denied.length};
writeFileSync(root+'tv1151-observations-verification-local-20261027.json',JSON.stringify(out,null,2)+'\n');
console.log('TV1151_DOM_NATIVE_READ_SLICE_MATCHES_COLLECTOR_FAIL_REMAINS');
