import { describe, expect, it } from 'vitest';
import { parseD2Roster, parseD2Plan,parseD2Application,parseD2Journal,saveD2Journal,d2JournalKey,validateD2Cancellation } from './multiDayInitialDraw';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const hash='a'.repeat(32);
const player={participationId:id(2),playerId:id(3),name:'Người TEST',stack:20000,seedRevision:0,
 sourceBags:[{bagId:id(4),bagVersion:1,sourceEntryId:id(5),flightId:id(6),stack:20000}],
 state:'UNSEATED',blocker:null,entryId:null,seatId:null,policy:'SUM_STACKS'};
const table={tournamentTableId:id(7),physicalTableId:id(8),tableSessionId:id(9),tableNumber:7,capacity:9,
 revision:1,epoch:1,occupiedSeats:[],lockedSeats:[],blocker:null};
const roster={eventId:id(1),finalTournamentId:id(10),qualificationHash:hash,sourceHash:hash,
 releaseEnabled:true,players:[player],tables:[table]};
const assignment={...player,...table,seatNumber:1,requestId:id(11)};
const plan={ok:true,state:'PLANNED',planId:id(12),eventId:id(1),finalTournamentId:id(10),
 sourceHash:hash,selectedTables:[table],assignments:[assignment],idempotent:false};

describe('D2 operation trust boundary',()=>{
 it.each([1,-1])('accepts a signed held proposal delta %s without replacing the used seed',deltaChips=>{
  const seated={...player,state:'SEATED',entryId:id(20),seatId:id(21)};
  const held={requestId:id(30),participationId:player.participationId,playerId:player.playerId,entryId:id(20),seatId:id(21),priorSeedStack:20000,proposedSeedStack:20000+deltaChips,deltaChips,seedRevision:0,status:'OWNER_APPROVED_HELD',liveStackChanged:false,createdAt:'2026-10-25T00:00:00Z'};
  const parsed=parseD2Roster({...roster,players:[seated],heldSeedAdjustments:[held]},id(1));
  expect(parsed.players[0].stack).toBe(20000);
  expect(parsed.sourceHash).toBe(hash);
  expect(parsed.heldSeedAdjustments?.[0].deltaChips).toBe(deltaChips);
 });
 it('rejects malformed, cross-participation or supposedly applied held seed projections',()=>{
  const seated={...player,state:'SEATED',entryId:id(20),seatId:id(21)};
  const held={requestId:id(30),participationId:player.participationId,playerId:player.playerId,entryId:id(20),seatId:id(21),priorSeedStack:20000,proposedSeedStack:20001,deltaChips:1,seedRevision:0,status:'OWNER_APPROVED_HELD',liveStackChanged:false,createdAt:'2026-10-25T00:00:00Z'};
  for(const heldSeedAdjustments of [null,{},[held,held],[{...held,participationId:id(99)}],[{...held,entryId:id(99)}],[{...held,deltaChips:2}],[{...held,liveStackChanged:true}],[{...held,status:'APPLIED'}],[{...held,proposedSeedStack:NaN}]])
   expect(()=>parseD2Roster({...roster,players:[seated],heldSeedAdjustments},id(1))).toThrow('D2_RESPONSE_INVALID');
 });
 it('rejects malformed or cross-event archived seating instead of trusting an extra field',()=>{
  for(const initialDraws of [null,[{eventId:id(99)}],[{planId:id(12),eventId:id(1),finalTournamentId:id(10),appliedAt:'bad',assignments:[]}]])
   expect(()=>parseD2Roster({...roster,initialDraws},id(1))).toThrow('D2_RESPONSE_INVALID');
 });
 it('accepts exact roster and rejects null, other event and duplicate identities',()=>{
  expect(parseD2Roster(roster,id(1)).players[0].stack).toBe(20000);
  for(const value of [null,{...roster,eventId:id(99)},{...roster,players:[player,player]},
   {...roster,players:[{...player,stack:NaN}]},{...roster,tables:[{...table,lockedSeats:[10]}]}])
   expect(()=>parseD2Roster(value,id(1))).toThrow();
 });
 it('binds planned assignments to roster, exact selected tables and session',()=>{
  expect(parseD2Plan(plan,parseD2Roster(roster,id(1)),[id(7)]).planId).toBe(id(12));
  for(const value of [null,{ok:true},{...plan,state:'APPLIED'},{...plan,eventId:id(99)},
   {...plan,assignments:[{...assignment,stack:1}]},
   {...plan,assignments:[{...assignment,tableSessionId:id(99)}]},
   {...plan,assignments:[assignment,assignment]}])
   expect(()=>parseD2Plan(value,parseD2Roster(roster,id(1)),[id(7)])).toThrow();
 });
 it('compares semantic table fields regardless of JSON property ordering',()=>{
  const reordered=Object.fromEntries(Object.entries(table).reverse());
  expect(parseD2Plan({...plan,selectedTables:[reordered]},parseD2Roster(roster,id(1)),[id(7)]).planId).toBe(id(12));
 });
 it('does not accept a generic ok or mismatched application as committed',()=>{
  const r=parseD2Roster(roster,id(1)),p=parseD2Plan(plan,r,[id(7)]);
  const receipt={ok:true,state:'SEATED',eventId:id(1),finalTournamentId:id(10),playerId:id(3),participationId:id(2),
   entryId:id(20),seatId:id(21),receiptId:id(22),seedStack:20000,seedRevision:0,newBuyInVnd:0,denominationIssuance:'NONE'};
  const applied={...plan,state:'APPLIED',requestId:id(30),appliedAt:'2026-10-17T00:00:00Z',seatReceipts:[receipt]};
  expect(parseD2Application(applied,p,r,id(30)).state).toBe('APPLIED');
  for(const value of [{ok:true},{...applied,requestId:id(31)},
   {...applied,seatReceipts:[{...receipt,seedStack:1}]},
   {...applied,assignments:[{...assignment,requestId:id(99)}]}])
   expect(()=>parseD2Application(value,p,r,id(30))).toThrow();
 });
 it('journals only the exact actor/event and never overwrites a newer intent',()=>{
  sessionStorage.clear();const r=parseD2Roster(roster,id(1));
  const journal={actorId:id(40),eventId:id(1),requestId:id(41),selectedIds:[id(7)],roster:r,plan:null,applyRequestId:null};
  const raw=saveD2Journal(sessionStorage,journal,null);
  expect(parseD2Journal(raw,id(40),id(1)).requestId).toBe(id(41));
  expect(()=>parseD2Journal(raw,id(42),id(1))).toThrow();
  expect(()=>saveD2Journal(sessionStorage,{...journal,requestId:id(43)},null)).toThrow();
  expect(sessionStorage.getItem(d2JournalKey(id(40),id(1)))).toBe(raw);
 });
 it('accepts only a canonical cancellation of this actor/event/plan',()=>{
  const r=parseD2Roster(roster,id(1)),p=parseD2Plan(plan,r,[id(7)]);
  const intent={actorId:id(40),eventId:id(1),requestId:id(41),selectedIds:[id(7)],roster:r,plan:p,applyRequestId:null,cancelRequestId:id(42)};
  const result={ok:true,state:'CANCELLED',actorId:id(40),eventId:id(1),planId:id(12),requestId:id(43),cancelledAt:'2026-10-17T00:00:00Z'};
  // Another same-actor tab may have cancelled this exact immutable plan first.
  expect(()=>validateD2Cancellation(result,intent)).not.toThrow();
  for(const value of [{...result,state:'APPLIED'},{...result,actorId:id(99)},{...result,planId:id(99)}])
   expect(()=>validateD2Cancellation(value,intent)).toThrow();
  expect(()=>parseD2Journal(JSON.stringify({...intent,cancelRequestId:'invalid'}),id(40),id(1))).toThrow();
 });
});
