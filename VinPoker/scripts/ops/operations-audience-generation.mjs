import assert from 'node:assert/strict';
const generation=value=>typeof value==='string'&&/^(0|[1-9]\d*)$/.test(value)?value:null;
const vector=value=>{try{return generation(JSON.parse(value)?.generation);}catch{return null;}};

// Test oracle only. Join scoped detail observations to independently
// read public source/publication clocks. Never supply data to a virtual viewer.
export function createAudienceGenerationEvidence(){
 const receipts=new Map(),pending=new Map(),viewers=new Set(),lastGeneration=new Map();
 const markerToDetailObservationMs=[],markerToPublicationMs=[];
 let observations=0,sourceMatched=0,publicationMatched=0,supersededPublication=0,unmatchedSource=0;
 let projected=null;
 const reconcile=()=>{
  for(const [key,row]of pending){
   const receipt=receipts.get(row.generation);
   if(receipt&&!row.sourceRecorded){
    assert.ok(row.at>=receipt.sourceAt,'Detail observation predates its source');
    markerToDetailObservationMs.push(row.at-receipt.sourceAt);row.sourceRecorded=true;sourceMatched++;viewers.add(row.viewer);
   }
   if(receipt?.publishedAt!==undefined&&row.sourceRecorded){
    assert.ok(receipt.publishedAt>=receipt.sourceAt,'Publication predates its source');
    markerToPublicationMs.push(receipt.publishedAt-receipt.sourceAt);publicationMatched++;pending.delete(key);
   }else if(projected!==null&&BigInt(projected)>BigInt(row.generation)){
    // Publication may coalesce intermediate generations. Retain missing source
    // evidence as missing, never manufacture a publication for that generation.
    if(!row.sourceRecorded)unmatchedSource++;
    supersededPublication++;pending.delete(key);
   }
  }
 };
 return {
  markerToDetailObservationMs,markerToPublicationMs,
  observe(snapshot){
   const f=snapshot?.access==='public'?snapshot.sections?.tables?.freshness:null;
   if(!f)return false;
   const current=vector(f.sourceRevision),published=vector(f.projectedSourceRevision);
   const sourceAt=Date.parse(f.sourceChangedAt),publishedAt=Date.parse(f.publishedAt);
   if(current===null||!Number.isFinite(sourceAt))return false;
   const prior=receipts.get(current);
   assert.ok(!prior||prior.sourceAt===sourceAt,'Generation source clock changed');
   receipts.set(current,prior??{sourceAt});
   if(published!==null&&Number.isFinite(publishedAt)){
    const receipt=receipts.get(published);
    if(receipt){
     assert.ok(publishedAt>=receipt.sourceAt,'Publication predates its source');
     receipt.publishedAt=Math.min(receipt.publishedAt??publishedAt,publishedAt);
    }
    if(projected===null||BigInt(published)>BigInt(projected))projected=published;
   }
   reconcile();
   if(receipts.size>4096){
    const oldest=receipts.keys().next().value;
    assert.ok(![...pending.values()].some(row=>row.generation===oldest),'Generation evidence retention exceeded');
    receipts.delete(oldest);
   }
   return true;
  },
  record(viewer,value,at){
   assert.ok(generation(value)!==null&&Number.isFinite(at),'Invalid detail observation');
   const last=lastGeneration.get(viewer);
   assert.ok(last===undefined||BigInt(value)>BigInt(last),'Duplicate or regressed detail observation');
   lastGeneration.set(viewer,value);
   const key=viewer+':'+value;
   assert.ok(!pending.has(key),'Duplicate uncredited detail observation');
   observations++;pending.set(key,{viewer,generation:value,at,sourceRecorded:false});
   reconcile();assert.ok(pending.size<=20000,'Generation evidence backlog exceeded');
  },
  report(){return {observations,sourceMatched,publicationMatched,supersededPublication,unmatchedSource,
   pending:pending.size,matchedViewers:viewers.size,markerObservationCoverage:observations?sourceMatched/observations:0,
   oracle:'Tournament generation-marker clocks joined to scoped detail observations;not exact changed-table events or source-write delivery coverage;no data injection or clamping'};},
 };
}
