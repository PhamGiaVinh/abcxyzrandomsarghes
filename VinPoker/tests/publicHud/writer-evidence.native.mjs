// Independent post-measurement consumer. It does not use the artifact's identity
// or reported percentiles as the expected result and does not enable qualification.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {currentWriterIdentity} from './scale.write.identity.mjs';
import {validateMatchedWriterEvidence} from './scale.write.protocol.mjs';
assert.equal(process.env.PUBLIC_HUD_WRITER_CONTROL,'isolated-native-only');
const expected=currentWriterIdentity();
assert.equal(expected.sourceHands,Number(process.env.PUBLIC_HUD_SCALE_HANDS),'Comparison fixture size must match this run');
const report=JSON.parse(readFileSync(process.env.PUBLIC_HUD_WRITER_CONTROL_REPORT,'utf8'));
const statistics=validateMatchedWriterEvidence(report,expected);
writeFileSync(process.env.PUBLIC_HUD_WRITER_CONTROL_REPORT+'.validated.json',JSON.stringify({kind:'INDEPENDENT_MATCHED_WRITER_DIAGNOSTIC_VALIDATION',identity:expected,statistics,qualification:false},null,2));
