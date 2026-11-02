import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {transformSync} from '@swc/core';

// Actual provider class; browser/credential/HTTP seams synthetic, no API call.
// Isolated from the unavailable local Gemini SDK; not full module qualification.
const source=readFileSync(new URL('../../src/lib/trackerVoice/providers.ts',import.meta.url),'utf8');
const start=source.indexOf('export class OpenAIRealtimeTranscriptionProvider');
assert.ok(start>=0);
const code=transformSync(source.slice(start).replace('export class','class')+'\nOpenAIRealtimeTranscriptionProvider;',{
 jsc:{parser:{syntax:'typescript'},target:'es2022'},module:{type:'commonjs'},
}).code;
const credential={clientSecret:'synthetic-test-only',model:'test',expiresAt:'2099-01-01'};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function fixture(permission,allowPeer=false,response){
 let stops=0,peers=0;const statuses=[],devices=[],channels=[],signals=[],transcripts=[],peerInstances=[];
 const signalingStarted=deferred();
 const trackListeners={};
 const track={stop:()=>stops++,getSettings:()=>({}),addEventListener:(name,callback)=>{trackListeners[name]=callback;}};
 const stream={getTracks:()=>[track],getAudioTracks:()=>[track]};
 const Provider=runInNewContext(code,{navigator:{mediaDevices:{getUserMedia:()=>permission?.promise??Promise.resolve(stream)}},
  RTCPeerConnection:class{
   connectionState='new';listeners={};
   constructor(){peers++;if(!allowPeer)throw new Error('unexpected_peer');peerInstances.push(this);}
   addTrack(){} addEventListener(name,callback){this.listeners[name]=callback;} close(){}
   createDataChannel(){const listeners={};channels.push(listeners);return {addEventListener:(name,cb)=>{listeners[name]=cb;},close:()=>listeners.close?.()};}
   async createOffer(){return {sdp:'synthetic-offer'};}
   async setLocalDescription(){} async setRemoteDescription(){signals.push('remote');}
  },AbortController,
  fetch:async(_url,options)=>{signals.push(options.signal);signalingStarted.resolve();return response?.promise??{ok:true,text:async()=>'synthetic-answer'};},
 });
 return {Provider,stream,statuses,devices,channels,signals,transcripts,peerInstances,trackListeners,signalingStarted,stops:()=>stops,peers:()=>peers,
  handlers:{onStatus:status=>statuses.push(status),onTranscript:event=>transcripts.push(event),onInputDevice:device=>devices.push(device)}};
}
test('late microphone permission is stopped after cancellation without minting a session',async()=>{
 const permission=deferred(),f=fixture(permission);let credentials=0;
 const provider=new f.Provider({getSessionCredential:async()=>{credentials++;return credential;}});
 const pending=provider.connect(f.handlers);await provider.disconnect();permission.resolve(f.stream);
 await pending;assert.equal(f.stops(),1);assert.equal(credentials,0);assert.deepEqual(f.devices,[]);
 assert.deepEqual(f.statuses,['requesting_permission','idle']);
});

test('terminal connection failure releases microphone and rejects late channel transcripts',async()=>{
 const f=fixture(null,true),provider=new f.Provider({getSessionCredential:async()=>credential});
 await provider.connect(f.handlers);f.channels[0].open();
 f.peerInstances[0].connectionState='failed';f.peerInstances[0].listeners.connectionstatechange();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.stops(),1,'error UI must not leave microphone live');assert.equal(f.statuses.at(-1),'error');
 f.channels[0].message({data:JSON.stringify({type:'conversation.item.input_audio_transcription.completed',item_id:'late',transcript:'all in'})});
 assert.equal(f.transcripts.length,0,'failed generation cannot deliver a command');
});

test('closed data channel releases microphone rather than only changing an offline label',async()=>{
 const f=fixture(null,true),provider=new f.Provider({getSessionCredential:async()=>credential});
 await provider.connect(f.handlers);f.channels[0].close();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.stops(),1);assert.equal(f.statuses.at(-1),'offline');
});

test('ended microphone closes the current generation and releases its tracks',async()=>{
 const f=fixture(null,true),provider=new f.Provider({getSessionCredential:async()=>credential});
 await provider.connect(f.handlers);f.trackListeners.ended();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.stops(),1);assert.equal(f.statuses.at(-1),'offline');
 f.channels[0].open();assert.equal(f.statuses.at(-1),'offline');
});

test('temporary disconnection remains recoverable and does not invent terminal failure',async()=>{
 const f=fixture(null,true),provider=new f.Provider({getSessionCredential:async()=>credential});
 await provider.connect(f.handlers);f.peerInstances[0].connectionState='disconnected';f.peerInstances[0].listeners.connectionstatechange();
 assert.equal(f.statuses.at(-1),'recovering');assert.equal(f.stops(),0);
 await provider.disconnect();assert.equal(f.stops(),1);
});

test('late terminal cleanup status cannot overwrite a new connection',async()=>{
 const f=fixture(null,true),provider=new f.Provider({getSessionCredential:async()=>credential});
 await provider.connect(f.handlers);f.peerInstances[0].connectionState='failed';f.peerInstances[0].listeners.connectionstatechange();
 const statusCount=f.statuses.length;await provider.connect(f.handlers);f.channels[1].open();
 await new Promise(resolve=>setImmediate(resolve));assert.equal(f.statuses.at(-1),'listening');
 assert.equal(f.statuses.slice(statusCount).includes('error'),false);assert.equal(f.stops(),1);
 await provider.disconnect();assert.equal(f.stops(),2);
});
test('late credentials cannot create a peer after cancellation',async()=>{
 const ready=deferred(),started=deferred(),f=fixture();
 const provider=new f.Provider({getSessionCredential:()=>{started.resolve();return ready.promise;}});
 const pending=provider.connect(f.handlers);await started.promise;await provider.disconnect();ready.resolve(credential);
 await pending;assert.equal(f.stops(),1);assert.equal(f.peers(),0);
});
test('current peer delivers transcripts but old channel callbacks cannot affect a reconnect',async()=>{
 const f=fixture(null,true),provider=new f.Provider({getSessionCredential:async()=>credential});
 await provider.connect(f.handlers);f.channels[0].open();
 f.channels[0].message({data:JSON.stringify({type:'conversation.item.input_audio_transcription.completed',item_id:'first',transcript:'call'})});
 assert.equal(f.transcripts.length,1);assert.equal(f.transcripts[0].transcript,'call');
 await provider.connect(f.handlers);const before=f.statuses.length;
 f.channels[0].open();f.channels[0].close();
 f.channels[0].message({data:JSON.stringify({type:'conversation.item.input_audio_transcription.completed',item_id:'old',transcript:'fold'})});
 assert.equal(f.statuses.length,before);assert.equal(f.transcripts.length,1);
 f.channels[1].open();assert.equal(f.statuses.at(-1),'listening');
 await provider.disconnect();assert.equal(f.stops(),2);
});
test('disconnect aborts pending SDP and ignores its late response',async()=>{
 const response=deferred(),f=fixture(null,true,response),provider=new f.Provider({getSessionCredential:async()=>credential});
 const pending=provider.connect(f.handlers);
 await f.signalingStarted.promise;
 assert.equal(f.signals.length,1);await provider.disconnect();assert.equal(f.signals[0].aborted,true);
 response.resolve({ok:true,text:async()=>'late-answer'});await pending;
 assert.equal(f.signals.includes('remote'),false);assert.equal(f.stops(),1);
});


test('malformed JSON envelopes do not throw or publish a transcript',async()=>{
 const f=fixture(null,true),provider=new f.Provider({getSessionCredential:async()=>credential});
 await provider.connect(f.handlers);f.channels[0].open();
 for(const data of ['null','[]','17','"text"','{'])assert.doesNotThrow(()=>f.channels[0].message({data}));
 assert.equal(f.transcripts.length,0);
 f.channels[0].message({data:JSON.stringify({type:'conversation.item.input_audio_transcription.completed',item_id:'healthy-after-malformed',transcript:'check'})});
 assert.equal(f.transcripts.length,1);assert.equal(f.transcripts[0].transcript,'check');assert.equal(f.transcripts[0].isFinal,true);
 await provider.disconnect();assert.equal(f.stops(),1);
});
for(const transcript of [undefined,null,42,{text:'raise 1000'}]){
 test('a completed event with invalid final transcript '+JSON.stringify(transcript)+' cannot promote partial text',async()=>{
  const f=fixture(null,true),provider=new f.Provider({getSessionCredential:async()=>credential});
  await provider.connect(f.handlers);f.channels[0].open();
  f.channels[0].message({data:JSON.stringify({type:'conversation.item.input_audio_transcription.delta',item_id:'partial',delta:'raise 1000'})});
  f.channels[0].message({data:JSON.stringify({type:'conversation.item.input_audio_transcription.completed',item_id:'partial',transcript})});
  assert.equal(f.transcripts.length,1);assert.equal(f.transcripts[0].isFinal,false);
  f.channels[0].message({data:JSON.stringify({type:'conversation.item.input_audio_transcription.completed',item_id:'partial',transcript:'call'})});
  assert.equal(f.transcripts.length,2);assert.equal(f.transcripts[1].isFinal,true);assert.equal(f.transcripts[1].transcript,'call');
  await provider.disconnect();assert.equal(f.stops(),1);
 });
}
