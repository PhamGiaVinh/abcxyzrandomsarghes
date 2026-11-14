import {beforeEach,it,expect,vi} from 'vitest';
const mocked=vi.hoisted(()=>({files:new Map(),code:{sha:'a'.repeat(40),manifestSha256:'b'.repeat(64),fixtureInputsSha256:'c'.repeat(64),sourceFunctionsSha256:'d'.repeat(64)},grade:vi.fn(),diagnostic:vi.fn()}));
vi.mock('node:fs',async importOriginal=>{
 const actual=await importOriginal<typeof import('node:fs')>();
 const readFileSync=(file:string)=>{if(!mocked.files.has(file))throw Error('ENOENT');return JSON.stringify(mocked.files.get(file));};
 return {...actual,readFileSync,default:{...actual,readFileSync}};
});
vi.mock('./scale.write.identity.mjs',()=>({currentWriterCodeIdentity:()=>mocked.code}));
vi.mock('./scale.write.protocol.mjs',()=>({requireMatchedWriterQualification:(report,expected,options)=>mocked.grade(report,expected,options),audienceEvidenceOnlyEnabled:()=>process.env.PUBLIC_HUD_AUDIENCE_EVIDENCE_ONLY==='1',matchedWriterEvidenceOnlyReceipt:(...args)=>mocked.diagnostic(...args)}));
import {readMatchedWriterQualification,readMatchedWriterEvidenceOnly} from './scale.write.qualification.mjs';
const rawPath='output/hud-scale/writer-matched-observers.json';
const receiptPath=rawPath+'.qualified.json';
const expected=()=>({...mocked.code,runId:'123',runAttempt:'2',database:'vinpoker_hud_test_pair_123_2',sourceHands:1000000});
beforeEach(()=>{
 vi.stubEnv('GITHUB_RUN_ID','123');vi.stubEnv('GITHUB_RUN_ATTEMPT','2');vi.stubEnv('PUBLIC_HUD_SCALE_HANDS','1000000');
 vi.stubEnv('PUBLIC_HUD_SOURCE_GENERATION_PROBE','0');
 vi.stubEnv('PUBLIC_HUD_AUDIENCE_EVIDENCE_ONLY','0');
 mocked.files.clear();mocked.files.set(rawPath,{identity:expected()});
 mocked.grade.mockReset().mockImplementation((report,identity)=>{
  expect(report.identity).toEqual(identity);
  return {method:'canonical-hand-observers-paired-v1',identity,statistics:{passed:true},scope:'completed-hand fixture only'};
 });
 mocked.files.set(receiptPath,{kind:'MATCHED_WRITER_SCOPE_QUALIFICATION_ONLY',fullLoadQualification:false,method:'canonical-hand-observers-paired-v1',identity:expected(),statistics:{passed:true},scope:'completed-hand fixture only'});
});
it('supplies independently rebuilt identity and returns recomputed grade',()=>{
 expect(readMatchedWriterQualification(1000000).identity).toEqual(expected());
 expect(mocked.grade).toHaveBeenCalledWith(mocked.files.get(rawPath),expected(),{sourceGenerationProbe:false});
});
it('binds migration342 receipt to the independently selected source version',()=>{
 vi.stubEnv('PUBLIC_HUD_SOURCE_GENERATION_PROBE','1');
 const candidate={migration:'pinned342'};
 const receipt=mocked.files.get(receiptPath);receipt.sourceGenerationCandidate=candidate;
 mocked.grade.mockImplementation((report,identity,options)=>{
  expect(options).toEqual({sourceGenerationProbe:true});
  return {method:receipt.method,identity,statistics:receipt.statistics,scope:receipt.scope,sourceGenerationCandidate:candidate};
 });
 expect(readMatchedWriterQualification(1000000).sourceGenerationCandidate).toEqual(candidate);
 receipt.sourceGenerationCandidate={migration:'foreign'};
 expect(()=>readMatchedWriterQualification(1000000)).toThrow();
});
it.each([rawPath,receiptPath])('rejects absent evidence %s',path=>{mocked.files.delete(path);expect(()=>readMatchedWriterQualification(1000000)).toThrow();});
it.each(['method','identity','statistics','scope','kind','fullLoadQualification'])('rejects mismatched receipt %s',key=>{
 mocked.files.get(receiptPath)[key]='wrong';expect(()=>readMatchedWriterQualification(1000000)).toThrow();
});
it.each(['sha','runId','runAttempt','fixtureInputsSha256'])('rejects raw evidence from wrong %s',key=>{
 mocked.files.get(rawPath).identity[key]='wrong';expect(()=>readMatchedWriterQualification(1000000)).toThrow();
});
it.each(['failed pair','failed pooled'])('propagates grading rejection: %s',message=>{
 mocked.grade.mockImplementation(()=>{throw Error(message);});expect(()=>readMatchedWriterQualification(1000000)).toThrow(message);
});
it('rejects an inconsistent fixture count',()=>{expect(()=>readMatchedWriterQualification(100)).toThrow();});
it.each([true,false])('evidence-only never enters qualification even if writer passed=%s',passed=>{
 vi.stubEnv('PUBLIC_HUD_AUDIENCE_EVIDENCE_ONLY','1');
 mocked.files.get(receiptPath).statistics.passed=passed;
 expect(()=>readMatchedWriterQualification(1000000)).toThrow('Evidence-only capture cannot qualify');
 expect(mocked.grade).not.toHaveBeenCalled();
});
it('keeps failed writer statistics in a separate independently checked evidence receipt',()=>{
 const evidencePath=rawPath+'.evidence-only.json';
 const receipt={kind:'MATCHED_WRITER_EVIDENCE_ONLY_NEVER_QUALIFIES',fullLoadQualification:false,identity:expected(),statistics:{passed:false,overheadPercent:19}};
 mocked.diagnostic.mockReset().mockImplementation((report,identity)=>{expect(report.identity).toEqual(identity);return receipt;});
 mocked.files.set(evidencePath,structuredClone(receipt));
 expect(()=>readMatchedWriterEvidenceOnly(1000000)).toThrow('Explicit evidence-only mode required');
 vi.stubEnv('PUBLIC_HUD_AUDIENCE_EVIDENCE_ONLY','1');
 expect(readMatchedWriterEvidenceOnly(1000000)).toEqual(receipt);
 expect(mocked.grade).not.toHaveBeenCalled();
 for(const key of ['kind','fullLoadQualification','identity','statistics']){
  mocked.files.set(evidencePath,{...receipt,[key]:'wrong'});
  expect(()=>readMatchedWriterEvidenceOnly(1000000)).toThrow('Evidence-only writer receipt differs');
 }
 mocked.files.set(evidencePath,receipt);mocked.files.get(rawPath).identity.sha='foreign';
 expect(()=>readMatchedWriterEvidenceOnly(1000000)).toThrow();
});
