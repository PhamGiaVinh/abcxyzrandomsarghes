import {beforeEach,describe,expect,it,vi} from 'vitest';
import {clearOnlineCreateJournal,onlineCreateJournalKey,parseOnlineCreateJournal,readOnlineCreateJournal,saveOnlineCreateJournal,type OnlineCreateJournal} from '@/lib/onlinePoker/createJournal';
const actor='63aa8ee6-e9ad-420e-9b71-d4e6b3fe0d43',backend='http://127.0.0.1:54329';
const intent:OnlineCreateJournal={version:1,actorId:actor,backend,requestId:'8bebc4cd-2246-4835-b006-d62d191618bb',payload:{name:'TEST',sb:'25',bb:'50',buyin:'5000',maxSeats:9}};
beforeEach(()=>sessionStorage.clear());
describe('online create journal persistence, not dispatch or E2E',()=>{
 it('round trips the exact actor/backend/request/payload after remount',()=>{
  const raw=saveOnlineCreateJournal(sessionStorage,intent);
  expect(readOnlineCreateJournal(sessionStorage,actor,backend)).toEqual({raw,intent});
  expect(readOnlineCreateJournal(sessionStorage,'181a034d-c701-4e76-91d6-2a05e28ec6e1',backend).intent).toBeNull();
  expect(readOnlineCreateJournal(sessionStorage,actor,'http://127.0.0.1:54330').intent).toBeNull();
 });
 it('does not overwrite an unresolved request, including one with corrupt data',()=>{
  const key=onlineCreateJournalKey(actor,backend);sessionStorage.setItem(key,'corrupt');
  expect(()=>saveOnlineCreateJournal(sessionStorage,intent)).toThrow('ONLINE_CREATE_JOURNAL_EXISTS');
  expect(()=>readOnlineCreateJournal(sessionStorage,actor,backend)).toThrow();
  expect(sessionStorage.getItem(key)).toBe('corrupt');
 });
 it('propagates storage failure rather than claiming persistence',()=>{
  const storage={getItem:()=>null,setItem:()=>{throw Error('QUOTA_TEST');},removeItem:vi.fn()};
  expect(()=>saveOnlineCreateJournal(storage,intent)).toThrow('QUOTA_TEST');
 });
 it('detects a write which silently failed',()=>{
  expect(()=>saveOnlineCreateJournal({getItem:()=>null,setItem:()=>{},removeItem:()=>{}},intent)).toThrow('ONLINE_CREATE_JOURNAL_SAVE_FAILED');
 });
 it('will not clear another request or a different payload',()=>{
  const raw=saveOnlineCreateJournal(sessionStorage,intent);
  expect(()=>clearOnlineCreateJournal(sessionStorage,{...intent,payload:{...intent.payload,buyin:'6000'}},raw)).toThrow('ONLINE_CREATE_JOURNAL_CHANGED');
  sessionStorage.setItem(onlineCreateJournalKey(actor,backend),JSON.stringify({...intent,requestId:'d6fb9898-df90-45de-8610-2b5cf099bff3'}));
  expect(()=>clearOnlineCreateJournal(sessionStorage,intent,raw)).toThrow('ONLINE_CREATE_JOURNAL_CHANGED');
 });
 it('clears only the validated exact stored intent',()=>{
  const raw=saveOnlineCreateJournal(sessionStorage,intent);clearOnlineCreateJournal(sessionStorage,intent,raw);
  expect(readOnlineCreateJournal(sessionStorage,actor,backend)).toEqual({raw:null,intent:null});
 });
 it('compares payload values, not JSON property insertion order',()=>{
  const reordered={...intent,payload:{maxSeats:9,buyin:'5000',bb:'50',sb:'25',name:'TEST'}};
  const raw=saveOnlineCreateJournal(sessionStorage,reordered);
  clearOnlineCreateJournal(sessionStorage,reordered,raw);
  expect(readOnlineCreateJournal(sessionStorage,actor,backend).intent).toBeNull();
 });
 it.each([null,{},[],{...intent,version:2},{...intent,actorId:'other'},{...intent,backend:'https://other.invalid'},
  {...intent,payload:{...intent.payload,buyin:'1e3'}},{...intent,payload:{...intent.payload,maxSeats:11}},
  {...intent,payload:{...intent.payload,buyin:'9007199254740993'}}])('rejects malformed or foreign journal %j',value=>{
  expect(()=>parseOnlineCreateJournal(JSON.stringify(value),actor,backend)).toThrow();
 });
 it('rejects credential-bearing backend identifiers',()=>{
  expect(()=>onlineCreateJournalKey(actor,'https://user:SECRET_TEST@local.invalid')).toThrow();
 });
});
