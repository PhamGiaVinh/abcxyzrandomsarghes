import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {currentWriterCodeIdentity} from './scale.write.identity.mjs';
import {requireMatchedWriterQualification} from './scale.write.protocol.mjs';
export function readMatchedWriterQualification(handsPerPlayer){
 assert.equal(handsPerPlayer,Number(process.env.PUBLIC_HUD_SCALE_HANDS));
 const runId=process.env.GITHUB_RUN_ID,runAttempt=process.env.GITHUB_RUN_ATTEMPT;
 // Code and DB function fingerprints come from the running audience stack,
 // not from either comparison artifact. The comparison DB has been dropped.
 const expected={...currentWriterCodeIdentity(),runId,runAttempt,database:`vinpoker_hud_test_pair_${runId}_${runAttempt}`,sourceHands:handsPerPlayer};
 const report=JSON.parse(readFileSync('output/hud-scale/writer-matched-observers.json','utf8'));
 const receipt=JSON.parse(readFileSync('output/hud-scale/writer-matched-observers.json.qualified.json','utf8'));
 const sourceGenerationProbe=process.env.PUBLIC_HUD_SOURCE_GENERATION_PROBE==='1';
 const recomputed=requireMatchedWriterQualification(report,expected,{sourceGenerationProbe});
 assert.equal(receipt.kind,'MATCHED_WRITER_SCOPE_QUALIFICATION_ONLY');
 assert.equal(receipt.fullLoadQualification,false);
 for(const key of ['method','identity','statistics','scope',...(sourceGenerationProbe?['sourceGenerationCandidate']:[])])assert.deepEqual(receipt[key],recomputed[key],`Writer receipt ${key} differs`);
 return recomputed;
}
