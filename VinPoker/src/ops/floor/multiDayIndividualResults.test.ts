import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {parseIndividualReview,initialIndividualOrder,makeIndividualRankIntent,parseIndividualIntent,parseIndividualObligationPreview,
 makeIndividualObligationIntent,parseIndividualReceipt,persistIndividualIntent,readIndividualIntent,clearIndividualIntent,individualResultsJournalKey} from './multiDayIndividualResults';
const id=(n:number)=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const scope={actorId:id(1),eventId:id(2),backendScope:'http://127.0.0.1:54329'};
function packet(){
 const entries=[6,7,8].map((n,i)=>({entryId:id(n),playerId:id(n+10),entryNo:1,name:'TEST '+n,status:i<2?'busted':'registered',bustOrder:null,finishedPlace:null}));
 return {eventId:id(2),tournamentId:id(3),field:3,sourceHash:'a'.repeat(32),participants:entries.map(e=>({entryId:e.entryId,playerId:e.playerId,entryNo:1,participationId:id(Number(e.entryId.slice(-2))+20)})),
  ranking:{tournamentId:id(3),field:3,survivors:1,sourceHash:'b'.repeat(32),missingOrders:2,requiresReview:false,activeHand:false,evidencePending:false,hasOfficial:false,simultaneousHands:[],simultaneousGroups:[],entries},individualResults:[] as Array<Record<string,unknown>>};
}
const frozen={event_id:id(2),tournament_id:id(3),entry_id:id(6),participation_id:id(26),player_id:id(16),entry_no:1,finished_place:3,source_hash:'a'.repeat(32),actor_id:id(1),request_id:id(10)};
describe('individual result intent contract',()=>{
 const persisted={eventId:id(2),tournamentId:id(3),participationId:id(26),entryId:id(6),playerId:id(16),rank:3,totalVnd:100000,requestId:id(10),confirmedAt:'2026-10-28T00:00:00+07:00'};
 const proposal={ok:true,state:'READY_TO_CONFIRM',paymentExecution:'NOT_PERFORMED',quote:{eventId:id(2),participationId:id(26),entryId:id(6),playerId:id(16),rank:3,totalVnd:100000,quoteHash:'c'.repeat(32)},
  funding:{eventId:id(2),finalTournamentId:id(3),state:'INCOMING_SOURCE_VERIFIED',sourceInputHash:'d'.repeat(32)},budget:{eventId:id(2),requiredTotalVnd:300000,fundedVnd:600000,requiredShortfallVnd:0,budgetHash:'e'.repeat(32)}};
 it('distinguishes unknown persisted state, confirmed absence and a finalized individual debt',()=>{
  const p=packet();p.individualResults=[frozen];
  const unknown=parseIndividualReview(p,scope.eventId),empty=parseIndividualReview({...p,individualObligations:[]},scope.eventId),existing=parseIndividualReview({...p,individualObligations:[persisted]},scope.eventId);
  expect(unknown.individualObligations).toBeNull();expect(empty.individualObligations).toEqual([]);expect(existing.individualObligations?.[0].totalVnd).toBe(100000);
  for(const view of [unknown,existing])expect(()=>makeIndividualObligationIntent(scope,view,parseIndividualObligationPreview(proposal,view,id(26)),id(11))).toThrow();
  expect(makeIndividualObligationIntent(scope,empty,parseIndividualObligationPreview(proposal,empty,id(26)),id(11)).kind).toBe('obligation');
 });
 it.each([{eventId:id(99)},{entryId:id(99)},{rank:2},{totalVnd:-1},{totalVnd:1.5},{confirmedAt:'invalid'}])('rejects malformed or cross-scope persisted debt %#',change=>{
  const p=packet();p.individualResults=[frozen];expect(()=>parseIndividualReview({...p,individualObligations:[{...persisted,...change}]},scope.eventId)).toThrow();
 });
 it('rejects duplicate persisted participation and null instead of assuming zero',()=>{
  const p=packet();p.individualResults=[frozen];
  expect(()=>parseIndividualReview({...p,individualObligations:[persisted,persisted]},scope.eventId)).toThrow();
  expect(()=>parseIndividualReview({...p,individualObligations:null},scope.eventId)).toThrow();
 });
 it('preserves a frozen rank while leaving new manual order to Floor',()=>{
  const p=packet();p.individualResults=[frozen];const view=parseIndividualReview(p,scope.eventId);
  expect(initialIndividualOrder(view)).toEqual([id(7),id(6)]);
  expect(()=>makeIndividualRankIntent(scope,view,[id(6),id(7)],id(11))).toThrow('INDIVIDUAL_FROZEN_ORDER');
  expect(makeIndividualRankIntent(scope,view,[id(7),id(6)],id(11)).kind).toBe('rank');
 });
 it('accepts an explicit Floor swap for unconfirmed manual busts without inventing a money amount',()=>{
  const view=parseIndividualReview(packet(),scope.eventId),intent=makeIndividualRankIntent(scope,view,[id(7),id(6)],id(11));
  expect(intent.kind).toBe('rank');expect(JSON.stringify(intent.args)).not.toMatch(/amount|prize|payout/i);
  expect(intent.kind==='rank'&&intent.expected.map(e=>e.rank)).toEqual([2,3]);
 });
 it.each(['event','participant','entry','rank'] as const)('rejects a misbound frozen %s',kind=>{
  const p=packet();p.individualResults=[{...frozen,...{event:{event_id:id(99)},participant:{participation_id:id(99)},entry:{entry_id:id(99)},rank:{finished_place:1}}[kind]}];
  expect(()=>parseIndividualReview(p,scope.eventId)).toThrow();
 });
 it('rejects omitted and duplicate busted entries',()=>{
  const v=parseIndividualReview(packet(),scope.eventId);
  expect(()=>makeIndividualRankIntent(scope,v,[id(6)],id(11))).toThrow();
  expect(()=>makeIndividualRankIntent(scope,v,[id(6),id(6)],id(11))).toThrow();
 });
 it('binds newly confirmed row actor/request/source and retains prior frozen proof',()=>{
  const p=packet();p.individualResults=[frozen];const v=parseIndividualReview(p,scope.eventId),intent=makeIndividualRankIntent(scope,v,[id(7),id(6)],id(11));
  const next={...frozen,entry_id:id(7),participation_id:id(27),player_id:id(17),finished_place:2,request_id:id(11)};
  const receipt={ok:true,outcome:'recorded',eventId:id(2),requestId:id(11),sourceHash:'a'.repeat(32),paymentExecution:'NOT_PERFORMED',individualResults:[next,frozen]};
  expect(parseIndividualReceipt(receipt,intent,false)).toBe(true);
  for(const change of [{actor_id:id(99)},{request_id:id(99)},{source_hash:'c'.repeat(32)}])expect(()=>parseIndividualReceipt({...receipt,individualResults:[{...next,...change},frozen]},intent,false)).toThrow();
 });
 it('keeps not_found pending and rejects false success or null receipt',()=>{
  const v=parseIndividualReview(packet(),scope.eventId),intent=makeIndividualRankIntent(scope,v,[id(6),id(7)],id(11));
  expect(parseIndividualReceipt({ok:true,outcome:'not_found',receipt:null},intent,true)).toBe(false);
  expect(()=>parseIndividualReceipt({ok:true,outcome:'recorded',receipt:null},intent,true)).toThrow();
  expect(()=>parseIndividualReceipt({ok:true},intent,false)).toThrow();
 });
 it('persists one exact payload and blocks competing event intents',()=>{
  const values=new Map<string,string>(),storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}};
  const intent=makeIndividualRankIntent(scope,parseIndividualReview(packet(),scope.eventId),[id(6),id(7)],id(11));
  persistIndividualIntent(storage,intent);expect(readIndividualIntent(storage,scope)).toEqual(intent);
  expect(()=>persistIndividualIntent(storage,{...intent,args:{...intent.args,p_request_id:id(12)}})).toThrow();
  expect(()=>readIndividualIntent(storage,{...scope,backendScope:'http://127.0.0.1:54330'})).toThrow();
  expect(()=>parseIndividualIntent({...intent,eventId:id(22)},scope)).toThrow();
  clearIndividualIntent(storage,intent);expect(storage.getItem(individualResultsJournalKey(scope.actorId,scope.eventId))).toBeNull();
  storage.setItem(`vinpoker:multiday-rules:v1:${scope.actorId}:${scope.eventId}`,'other pending');expect(()=>persistIndividualIntent(storage,intent)).toThrow('MULTIDAY_EVENT_JOURNAL_PENDING');
 });
});
const nativePath=process.env.VINPOKER_INDIVIDUAL1175_NATIVE_JSON;
const nativeReadPath=process.env.VINPOKER_INDIVIDUAL1177_NATIVE_JSON;
describe.skipIf(!nativeReadPath)('native1177 persisted obligation read',()=>{
 it('reads one saved debt with seven survivors after reload',()=>{
  const raw=JSON.parse(readFileSync(nativeReadPath!,'utf8')).observations[0].read;
  const view=parseIndividualReview(raw,raw.eventId);
  expect(view.individualObligations).toHaveLength(1);expect(view.individualObligations?.[0].totalVnd).toBe(100000);
  expect(view.ranking.survivors).toBe(7);expect(view.ranking.hasOfficial).toBe(false);
 });
});
describe.skipIf(!nativePath)('native1175 read and immutable receipt contract',()=>{
 it('qualifies exact Owner-native review, quote and historical receipts without writing',()=>{
  const bundle=JSON.parse(readFileSync(nativePath!,'utf8'));
  const view=parseIndividualReview(bundle.view,bundle.scope.eventId),row=view.individualResults[0];
  const preview=parseIndividualObligationPreview(bundle.preview,view,row.participation_id);
  const rankIntent=makeIndividualRankIntent(bundle.scope,view,initialIndividualOrder(view),bundle.rankReceipt.receipt.requestId);
 const o=bundle.obligationReceipt.receipt.obligation;
 const obligationIntent=parseIndividualIntent({...bundle.scope,kind:'obligation',tournamentId:view.tournamentId,
  expected:{entryId:o.entry_id,participationId:o.participation_id,playerId:o.player_id,entryNo:row.entry_no,rank:o.finished_place,amountVnd:o.amount_vnd},
  args:{p_event_id:view.eventId,p_participation_id:o.participation_id,p_expected_quote_hash:o.quote_hash,p_expected_source_hash:o.source_input_hash,p_expected_budget_hash:o.budget_hash,p_request_id:bundle.obligationReceipt.receipt.requestId}},bundle.scope);
  expect(parseIndividualReceipt(bundle.rankReceipt,rankIntent,true)).toBe(true);
  expect(parseIndividualReceipt(bundle.obligationReceipt,obligationIntent,true)).toBe(true);
  expect(view.ranking.survivors).toBe(7);expect(preview.quote.totalVnd).toBe(100000);
 });
});
