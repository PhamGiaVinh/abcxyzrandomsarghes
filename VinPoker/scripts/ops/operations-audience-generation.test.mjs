import test from 'node:test';
import assert from 'node:assert/strict';
import {createAudienceGenerationEvidence} from './operations-audience-generation.mjs';
const snapshot=(current,published,sourceAt,publishedAt)=>({access:'public',sections:{tables:{freshness:{
 sourceRevision:JSON.stringify({generation:current}),projectedSourceRevision:JSON.stringify({generation:published}),
 sourceChangedAt:new Date(sourceAt).toISOString(),publishedAt:new Date(publishedAt).toISOString(),
}}}});
test('matches a detail observation even when its independent oracle arrives later',()=>{
 const e=createAudienceGenerationEvidence();e.record(0,'2',1200);
 assert.equal(e.report().sourceMatched,0);e.observe(snapshot('2','2',1000,1100));
 assert.deepEqual(e.markerToDetailObservationMs,[200]);assert.deepEqual(e.markerToPublicationMs,[100]);
 assert.equal(e.report().matchedViewers,1);assert.equal(e.report().pending,0);
});
test('an updating snapshot never assigns an old publication time to the new generation',()=>{
 const e=createAudienceGenerationEvidence();e.observe(snapshot('2','1',1000,900));e.record(0,'2',1200);
 assert.deepEqual(e.markerToDetailObservationMs,[200]);assert.deepEqual(e.markerToPublicationMs,[]);
 e.observe(snapshot('2','2',1000,1500));assert.deepEqual(e.markerToPublicationMs,[500]);
});
test('retains missing evidence for a superseded intermediate source rather than substituting a newer clock',()=>{
 const e=createAudienceGenerationEvidence();e.record(0,'2',1200);e.observe(snapshot('3','3',1300,1400));
 assert.deepEqual(e.markerToDetailObservationMs,[]);assert.equal(e.report().unmatchedSource,1);assert.equal(e.report().markerObservationCoverage,0);
});
test('a coalesced publication does not erase a source-to-detail observation',()=>{
 const e=createAudienceGenerationEvidence();e.observe(snapshot('2','1',1000,900));e.record(0,'2',1200);
 e.observe(snapshot('3','3',1300,1400));assert.deepEqual(e.markerToDetailObservationMs,[200]);
 assert.deepEqual(e.markerToPublicationMs,[]);assert.equal(e.report().supersededPublication,1);
});
test('does not clamp impossible clocks or accept changing clocks for the same generation',()=>{
 const e=createAudienceGenerationEvidence();e.observe(snapshot('2','2',1000,1100));
 assert.throws(()=>e.record(0,'2',999),/predates/);
 assert.throws(()=>e.observe(snapshot('2','2',1001,1100)),/clock changed/);
 const f=createAudienceGenerationEvidence();assert.throws(()=>f.observe(snapshot('2','2',1000,999)),/predates/);
});
test('rejects duplicate pending observations and malformed generation identifiers',()=>{
 const e=createAudienceGenerationEvidence();e.record(0,'2',1200);
 assert.throws(()=>e.record(0,'2',1300),/Duplicate/);
 for(const v of ['private','-1','2x','02',2])assert.throws(()=>e.record(1,v,1400),/Invalid/);
 assert.equal(e.observe({access:'revoked'}),false);assert.equal(e.report().sourceMatched,0);
 const f=createAudienceGenerationEvidence();f.observe(snapshot('2','2',1000,1100));f.record(0,'2',1200);
 assert.throws(()=>f.record(0,'2',1300),/Duplicate/);assert.throws(()=>f.record(0,'1',1300),/regressed/);
});
