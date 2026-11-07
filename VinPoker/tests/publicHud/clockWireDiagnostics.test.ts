import {describe,expect,it} from 'vitest';
import {clockBroadcastSignal,decodeClockWireFrame} from './clockWireDiagnostics';
const tour='ac300000-0000-4000-8000-000000000001',topic='realtime:public:tournament-viewer-v2:'+tour;
const payload={event:'changed',type:'broadcast',payload:{tournamentId:tour,components:['clock'],revisions:{clock:'1234'}}};
describe('clock diagnostic Phoenix Broadcast envelopes',()=>{
 it('decodes the object envelope',()=>expect(clockBroadcastSignal({topic,event:'broadcast',payload},tour)).toEqual({components:['clock'],clockRevision:'1234'}));
 it('decodes the array envelope',()=>expect(clockBroadcastSignal(['1',null,topic,'broadcast',payload],tour)).toEqual({components:['clock'],clockRevision:'1234'}));
 it('decodes the installed SDK binary user Broadcast protocol',()=>{
  const encoder=new TextEncoder(),t=encoder.encode(topic),event=encoder.encode('changed'),body=encoder.encode(JSON.stringify(payload.payload));
  // Realtime JS2.105.4 Serializer._decodeUserBroadcast: kind4, topic/event/
  // metadata lengths, JSON encoding1, then topic/event and the JSON payload.
  const frame=new Uint8Array(5+t.length+event.length+body.length);frame.set([4,t.length,event.length,0,1]);frame.set(t,5);frame.set(event,5+t.length);frame.set(body,5+t.length+event.length);
  expect(clockBroadcastSignal(decodeClockWireFrame(frame),tour)).toEqual({components:['clock'],clockRevision:'1234'});
 });
 it('rejects wrong topics, tours, replies and direct changed events',()=>{
  for(const wire of [null,'invalid',{topic,event:'changed',payload:payload.payload},{topic,event:'phx_reply',payload},{topic:'other',event:'broadcast',payload},{topic,event:'broadcast',payload:{...payload,payload:{...payload.payload,tournamentId:'other'}}}])expect(clockBroadcastSignal(wire,tour)).toBeNull();
 });
 it('retains only component names and a numeric clock revision',()=>{
  expect(clockBroadcastSignal({topic,event:'broadcast',payload:{...payload,payload:{...payload.payload,components:['clock','DO_NOT_RETAIN'],revisions:{clock:'DO_NOT_RETAIN'},privateData:'DO_NOT_RETAIN'}}},tour)).toEqual({components:['clock'],clockRevision:null});
 });
});
