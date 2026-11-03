import {it,expect} from 'vitest';
import {handIncludesWrite,projectionIncludesWrite} from './scale.delivery.mjs';
it('credits only a completed or demonstrably newer observed hand',()=>{
 const write={handId:'hand',number:8,step:5};
 expect(handIncludesWrite({id:'hand',handNumber:8,status:'in_progress',actions:[1,2,3,4]},write)).toBe(false);
 expect(handIncludesWrite({id:'hand',handNumber:8,status:'completed'},write)).toBe(true);
 expect(handIncludesWrite({id:'other',handNumber:7,status:'completed'},write)).toBe(false);
 expect(handIncludesWrite({id:'next',handNumber:9,status:'in_progress'},write)).toBe(true);
});
it('accepts an included generation while newer writes wait but fences deferred work',()=>{
 const write={generation:'10',at:1000,deferred:false,ackOrder:5};
 const freshness={projectedSourceRevision:'{"generation":"10"}',publishedAt:new Date(1001).toISOString(),state:'updating'};
 expect(projectionIncludesWrite(freshness,write)).toBe(true);
 expect(projectionIncludesWrite(freshness,{...write,generation:'11'})).toBe(false);
 expect(projectionIncludesWrite(freshness,{...write,at:1002})).toBe(false);
 expect(projectionIncludesWrite(freshness,{...write,deferred:true})).toBe(false);
 expect(projectionIncludesWrite({...freshness,state:'current'},{...write,deferred:true},6)).toBe(false);
 const absorbed={...freshness,state:'current',projectedSourceRevision:'{"generation":"11"}'};
 expect(projectionIncludesWrite(absorbed,{...write,deferred:true},5)).toBe(false);
 expect(projectionIncludesWrite(absorbed,{...write,deferred:true},6)).toBe(true);
});
