// Independent post-measurement consumer. It does not use the artifact's identity
// or reported percentiles as the expected result and does not enable qualification.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {currentWriterIdentity} from './scale.write.identity.mjs';
import {validateMatchedWriterEvidence,validateCanonicalWriterObservers,requireMatchedWriterQualification,audienceEvidenceOnlyEnabled,matchedWriterEvidenceOnlyReceipt} from './scale.write.protocol.mjs';
assert.equal(process.env.PUBLIC_HUD_WRITER_CONTROL,'isolated-native-only');
const expected=currentWriterIdentity();
assert.equal(expected.sourceHands,Number(process.env.PUBLIC_HUD_SCALE_HANDS),'Comparison fixture size must match this run');
const report=JSON.parse(readFileSync(process.env.PUBLIC_HUD_WRITER_CONTROL_REPORT,'utf8'));
const sourceGenerationProbe=process.env.PUBLIC_HUD_SOURCE_GENERATION_PROBE==='1';
validateCanonicalWriterObservers(report.observerProfile,{sourceGenerationProbe});
const statistics=validateMatchedWriterEvidence(report,expected);
writeFileSync(process.env.PUBLIC_HUD_WRITER_CONTROL_REPORT+'.validated.json',JSON.stringify({kind:'INDEPENDENT_MATCHED_WRITER_DIAGNOSTIC_VALIDATION',identity:expected,statistics,qualification:false},null,2));
// The diagnostic receipt is retained even if an explicitly requested grading
// rejects it. Default diagnostic invocations do not silently acquire this gate.
if(audienceEvidenceOnlyEnabled(process.env)){
 const receipt=matchedWriterEvidenceOnlyReceipt(report,expected,{sourceGenerationProbe});
 writeFileSync(process.env.PUBLIC_HUD_WRITER_CONTROL_REPORT+'.evidence-only.json',JSON.stringify(receipt,null,2));
}else if(process.env.PUBLIC_HUD_WRITER_QUALIFICATION_METHOD==='canonical-hand-observers-paired-v1'){
 const qualification=requireMatchedWriterQualification(report,expected,{sourceGenerationProbe});
 writeFileSync(process.env.PUBLIC_HUD_WRITER_CONTROL_REPORT+'.qualified.json',JSON.stringify({kind:'MATCHED_WRITER_SCOPE_QUALIFICATION_ONLY',...qualification,fullLoadQualification:false},null,2));
}else assert.ok(!process.env.PUBLIC_HUD_WRITER_QUALIFICATION_METHOD||process.env.PUBLIC_HUD_WRITER_QUALIFICATION_METHOD==='startup','Unknown writer qualification method');
