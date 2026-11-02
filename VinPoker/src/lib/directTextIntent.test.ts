import {describe,it,expect} from 'vitest';
import {directTextHash,readDirectTextIntent,retainDirectTextIntent,settleDirectTextIntent,matchDirectTextReceipt} from './directTextIntent';
const actor='11111111-1111-4111-8111-111111111111',chat='22222222-2222-4222-8222-222222222222';
const content='PRIVATE LOCAL TEST ONLY';
const storage=()=>{const map=new Map<string,string>();return{getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);},removeItem:(k:string)=>{map.delete(k);},map};};
async function fixture(){
 const intent={version:1 as const,actorId:actor,chatId:chat,messageId:'33333333-3333-4333-8333-333333333333',contentHash:await directTextHash(content)};
 return{intent,receipt:{id:intent.messageId,chat_id:chat,sender_id:actor,kind:'text',content,created_at:'2026-10-19T00:00:00Z'}};
}
describe('direct text intent boundary',()=>{
 it('retains only a scoped private image reference and matches the exact image receipt',async()=>{
  const s=storage(),{intent:base,receipt:baseReceipt}=await fixture();
  const attachment=`private-chat:v1:${actor}/dm/${chat}/44444444-4444-4444-8444-444444444444.png`;
  const intent={...base,kind:'image' as const,attachment,contentHash:await directTextHash(attachment)};
  retainDirectTextIntent(s,intent);expect(readDirectTextIntent(s,actor,chat)).toEqual(intent);
  const receipt={...baseReceipt,kind:'image',content:attachment};
  expect(await matchDirectTextReceipt(intent,receipt)).toEqual(receipt);
  expect(await matchDirectTextReceipt(intent,{...receipt,kind:'text'})).toBeNull();
  settleDirectTextIntent(s,intent);expect(s.map.size).toBe(0);
 });
 it.each(['https://test.invalid/private.png','private-chat:v1:other/dm/other/a.png',`private-chat:v1:${actor}/dm/${chat}/extra/44444444-4444-4444-8444-444444444444.png`])('rejects a foreign or malformed retained image path %s',async attachment=>{
  const s=storage(),{intent}=await fixture();
  s.setItem(`vinpoker:dm-text:v1:${actor}:${chat}`,JSON.stringify({...intent,kind:'image',attachment}));
  expect(()=>readDirectTextIntent(s,actor,chat)).toThrow('DM_JOURNAL_INVALID');
 });
 it('retains identity/hash but not private content, then clears only that exact intent',async()=>{
  const s=storage(),{intent}=await fixture();retainDirectTextIntent(s,intent);retainDirectTextIntent(s,intent);
  expect(readDirectTextIntent(s,actor,chat)).toEqual(intent);expect([...s.map.values()].join('')).not.toContain(content);
  expect(readDirectTextIntent(s,'other',chat)).toBeNull();settleDirectTextIntent(s,intent);expect(s.map.size).toBe(0);
 });
 it('does not overwrite or clear a different outstanding payload',async()=>{
  const s=storage(),{intent}=await fixture();retainDirectTextIntent(s,intent);
  const changed={...intent,contentHash:'0'.repeat(64)};
  expect(()=>retainDirectTextIntent(s,changed)).toThrow();expect(()=>settleDirectTextIntent(s,changed)).toThrow();
  expect(readDirectTextIntent(s,actor,chat)).toEqual(intent);
 });
 it.each(['not-json','null','{}','[]'])('rejects a corrupt retained journal: %s',raw=>{
  const s=storage();s.setItem(`vinpoker:dm-text:v1:${actor}:${chat}`,raw);expect(()=>readDirectTextIntent(s,actor,chat)).toThrow();
 });
 it('accepts only a fully matching server row',async()=>{const{intent,receipt}=await fixture();expect(await matchDirectTextReceipt(intent,receipt)).toEqual(receipt);});
 it.each([{id:'other'},{chat_id:'other'},{sender_id:'other'},{kind:'image'},{content:'different'}, {created_at:'invalid'}])('rejects a mismatched receipt %j',async patch=>{
  const{intent,receipt}=await fixture();expect(await matchDirectTextReceipt(intent,{...receipt,...patch})).toBeNull();
 });
 it.each([null,[],{},'success'])('does not treat an unavailable row as success',async value=>{
  const{intent}=await fixture();expect(await matchDirectTextReceipt(intent,value)).toBeNull();
 });
});
