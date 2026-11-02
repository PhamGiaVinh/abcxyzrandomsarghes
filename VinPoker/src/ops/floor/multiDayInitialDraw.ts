export type D2Player = { participationId: string; playerId: string; name: string | null; stack: number;
 seedRevision: number; state: 'UNSEATED' | 'SEATED' | 'BLOCKED'; blocker: string | null;
 entryId: string | null; seatId: string | null; sourceBags: unknown[] };
export type D2Table = { tournamentTableId: string; physicalTableId: string | null; tableSessionId: string | null;
 tableNumber: number | null; capacity: number | null; revision: number | null; epoch: number | null;
 occupiedSeats: number[]; lockedSeats: number[]; blocker: string | null };
export type D2InitialDraw = { planId:string; eventId:string; finalTournamentId:string; appliedAt:string;
 assignments:Omit<D2Assignment,'requestId'>[] };
export type D2HeldSeedAdjustment={requestId:string;participationId:string;playerId:string;entryId:string;seatId:string;
 priorSeedStack:number;proposedSeedStack:number;deltaChips:number;seedRevision:number;
 status:'OWNER_APPROVED_HELD';liveStackChanged:false;createdAt:string};
export type D2Roster = { eventId: string; finalTournamentId: string; qualificationHash: string; sourceHash: string;
 releaseEnabled: boolean; players: D2Player[]; tables: D2Table[]; initialDraws?:D2InitialDraw[];heldSeedAdjustments?:D2HeldSeedAdjustment[] };
export type D2Assignment = { participationId: string; playerId: string; name: string; stack: number; seedRevision: number;
 tournamentTableId: string; physicalTableId: string; tableSessionId: string; tableNumber: number; seatNumber: number; requestId: string };
export type D2Plan = { ok: true; state: 'PLANNED' | 'APPLIED'; planId: string; eventId: string; finalTournamentId: string;
 sourceHash: string; selectedTables: D2Table[]; assignments: D2Assignment[]; idempotent: boolean; requestId?: string };
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{32}$/.test(v);
const integer=(v:unknown,min=0):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min;
const text=(v:unknown):v is string=>typeof v==='string'&&!!v.trim();
const nullable=(v:unknown,check:(v:unknown)=>boolean)=>v===null||check(v);
const unique=(values:unknown[])=>new Set(values).size===values.length;
function requireValue(ok:unknown):asserts ok {if(!ok)throw new Error('D2_RESPONSE_INVALID');}
function tableValid(v:unknown):v is D2Table {
 return record(v)&&uuid(v.tournamentTableId)&&nullable(v.physicalTableId,uuid)&&nullable(v.tableSessionId,uuid)
  &&nullable(v.tableNumber,x=>integer(x,1))&&nullable(v.capacity,x=>x===8||x===9)
  &&nullable(v.revision,x=>integer(x))&&nullable(v.epoch,x=>integer(x))&&nullable(v.blocker,text)
  &&[v.occupiedSeats,v.lockedSeats].every(s=>Array.isArray(s)&&unique(s)&&s.every(n=>integer(n,1)&&n<=9))
  &&(v.blocker!==null||[v.physicalTableId,v.tableSessionId].every(uuid)&&integer(v.tableNumber,1)
   &&[8,9].includes(Number(v.capacity))&&integer(v.revision)&&integer(v.epoch));
}
function sameTable(a:D2Table,b:D2Table|undefined) {
 return !!b&&(['tournamentTableId','physicalTableId','tableSessionId','tableNumber','capacity','revision','epoch','blocker'] as const)
  .every(key=>a[key]===b[key])&&(['occupiedSeats','lockedSeats'] as const).every(key=>JSON.stringify(a[key])===JSON.stringify(b[key]));
}
export function parseD2Roster(value:unknown,eventId:string):D2Roster {
 requireValue(record(value)&&value.eventId===eventId&&uuid(value.eventId)&&uuid(value.finalTournamentId)
  &&hash(value.sourceHash)&&hash(value.qualificationHash)&&typeof value.releaseEnabled==='boolean'
  &&Array.isArray(value.players)&&Array.isArray(value.tables));
 requireValue(value.players.every(p=>record(p)&&uuid(p.participationId)&&uuid(p.playerId)
  &&nullable(p.name,text)&&integer(p.stack,1)&&p.stack<=2147483647&&integer(p.seedRevision)
  &&['UNSEATED','SEATED','BLOCKED'].includes(String(p.state))&&nullable(p.blocker,text)
  &&nullable(p.entryId,uuid)&&nullable(p.seatId,uuid)
  &&(p.state!=='UNSEATED'||text(p.name)&&p.entryId===null&&p.seatId===null&&p.blocker===null)
  &&(p.state!=='SEATED'||uuid(p.entryId)&&uuid(p.seatId))
  &&Array.isArray(p.sourceBags)&&p.sourceBags.length>0&&p.sourceBags.every(b=>record(b)
   &&[b.bagId,b.sourceEntryId,b.flightId].every(uuid)&&integer(b.bagVersion,1)&&integer(b.stack,1))));
 requireValue(unique(value.players.map(p=>p.playerId))&&unique(value.players.map(p=>p.participationId))
  &&value.tables.every(tableValid)&&unique(value.tables.map(t=>t.tournamentTableId)));
 if(value.heldSeedAdjustments!==undefined){
  requireValue(Array.isArray(value.heldSeedAdjustments)&&unique(value.heldSeedAdjustments.map(a=>record(a)?a.requestId:null)));
  for(const a of value.heldSeedAdjustments){
   requireValue(record(a)&&[a.requestId,a.participationId,a.playerId,a.entryId,a.seatId].every(uuid)
    &&integer(a.priorSeedStack,1)&&a.priorSeedStack<=2147483647&&integer(a.proposedSeedStack,1)&&a.proposedSeedStack<=2147483647
    &&Number.isSafeInteger(a.deltaChips)&&a.deltaChips!==0&&a.deltaChips===a.proposedSeedStack-a.priorSeedStack
    &&integer(a.seedRevision)&&a.status==='OWNER_APPROVED_HELD'&&a.liveStackChanged===false
    &&text(a.createdAt)&&Number.isFinite(Date.parse(a.createdAt))
    &&value.players.some(p=>p.state==='SEATED'&&p.participationId===a.participationId&&p.playerId===a.playerId&&p.entryId===a.entryId&&p.seatId===a.seatId));
  }
 }
 if(value.initialDraws!==undefined){
  const players=value.players;
  requireValue(Array.isArray(value.initialDraws)&&unique(value.initialDraws.map(d=>record(d)?d.planId:null)));
  for(const draw of value.initialDraws){
   requireValue(record(draw)&&uuid(draw.planId)&&draw.eventId===value.eventId&&draw.finalTournamentId===value.finalTournamentId
    &&text(draw.appliedAt)&&Number.isFinite(Date.parse(draw.appliedAt))&&Array.isArray(draw.assignments)&&draw.assignments.length>0);
   requireValue(draw.assignments.every(a=>record(a)&&[a.participationId,a.playerId,a.tournamentTableId,a.physicalTableId,a.tableSessionId].every(uuid)
    &&text(a.name)&&integer(a.stack,1)&&a.stack<=2147483647&&integer(a.seedRevision)&&integer(a.tableNumber,1)
    &&integer(a.seatNumber,1)&&a.seatNumber<=9
    &&players.some(p=>p.participationId===a.participationId&&p.playerId===a.playerId))
    &&unique(draw.assignments.map(a=>a.participationId))&&unique(draw.assignments.map(a=>a.playerId))
    &&unique(draw.assignments.map(a=>`${a.tableSessionId}:${a.seatNumber}`)));
  }
 }
 return value as unknown as D2Roster;
}
export function parseD2Plan(value:unknown,roster:D2Roster,selectedIds:string[],state:'PLANNED'|'APPLIED'='PLANNED'):D2Plan {
 requireValue(record(value)&&value.ok===true&&value.state===state&&uuid(value.planId)
  &&value.eventId===roster.eventId&&value.finalTournamentId===roster.finalTournamentId&&value.sourceHash===roster.sourceHash
  &&typeof value.idempotent==='boolean'&&Array.isArray(value.selectedTables)&&Array.isArray(value.assignments));
 requireValue(unique(selectedIds)&&selectedIds.length>0&&value.selectedTables.length===selectedIds.length
  &&value.selectedTables.every(t=>tableValid(t)&&t.blocker===null&&selectedIds.includes(t.tournamentTableId)
   &&sameTable(t,roster.tables.find(r=>r.tournamentTableId===t.tournamentTableId)))
  &&unique(value.selectedTables.map(t=>t.tournamentTableId)));
 const players=roster.players.filter(p=>p.state==='UNSEATED');
 requireValue(value.assignments.length===players.length&&players.length>0);
 for(const a of value.assignments) {
  requireValue(record(a));
  const p=players.find(p=>p.participationId===a.participationId),t=(value.selectedTables as D2Table[]).find(t=>t.tournamentTableId===a.tournamentTableId);
  requireValue(p&&t&&a.playerId===p.playerId&&a.name===p.name&&a.stack===p.stack&&a.seedRevision===p.seedRevision
   &&a.tableSessionId===t.tableSessionId&&a.physicalTableId===t.physicalTableId&&a.tableNumber===t.tableNumber
   &&integer(a.seatNumber,1)&&a.seatNumber<=Number(t.capacity)&&uuid(a.requestId)
   &&!t.occupiedSeats.includes(a.seatNumber)&&!t.lockedSeats.includes(a.seatNumber));
 }
 requireValue(unique(value.assignments.map(a=>a.playerId))&&unique(value.assignments.map(a=>a.requestId))
  &&unique(value.assignments.map(a=>`${a.tableSessionId}:${a.seatNumber}`)));
 return value as unknown as D2Plan;
}
export function parseD2Application(value:unknown,plan:D2Plan,roster:D2Roster,requestId:string):D2Plan {
 const result=parseD2Plan(value,roster,plan.selectedTables.map(t=>t.tournamentTableId),'APPLIED');
 requireValue(record(value)&&result.state==='APPLIED'&&result.planId===plan.planId&&result.requestId===requestId
  &&typeof value.appliedAt==='string'&&Number.isFinite(Date.parse(value.appliedAt))
  &&Array.isArray(value.seatReceipts)&&value.seatReceipts.length===plan.assignments.length);
 requireValue(result.assignments.every((a,index)=>{
  const expected=plan.assignments[index];
  return (Object.keys(expected) as Array<keyof D2Assignment>).every(key=>a[key]===expected[key]);
 }));
 for(const assignment of plan.assignments) {
  const receipt=value.seatReceipts.find(r=>record(r)&&r.playerId===assignment.playerId);
  requireValue(record(receipt)&&receipt.ok===true&&receipt.state==='SEATED'&&receipt.eventId===plan.eventId
   &&receipt.finalTournamentId===plan.finalTournamentId&&receipt.participationId===assignment.participationId
   &&receipt.seedStack===assignment.stack&&receipt.seedRevision===assignment.seedRevision
   &&[receipt.entryId,receipt.seatId,receipt.receiptId].every(uuid)
   &&receipt.newBuyInVnd===0&&receipt.denominationIssuance==='NONE');
 }
 requireValue(unique(value.seatReceipts.map(r=>r.playerId))&&unique(value.seatReceipts.map(r=>r.entryId))
  &&unique(value.seatReceipts.map(r=>r.seatId)));
 return result;
}

export type D2Journal={actorId:string;eventId:string;requestId:string;selectedIds:string[];roster:D2Roster;
 plan:D2Plan|null;applyRequestId:string|null;cancelRequestId?:string|null};
export const d2JournalKey=(actorId:string,eventId:string)=>`vinpoker:d2-initial:v1:${actorId}:${eventId}`;
export function parseD2Journal(raw:string,actorId:string,eventId:string):D2Journal {
 const v:unknown=JSON.parse(raw);
 requireValue(record(v)&&v.actorId===actorId&&uuid(v.actorId)&&v.eventId===eventId&&uuid(v.eventId)&&uuid(v.requestId)
  &&Array.isArray(v.selectedIds)&&v.selectedIds.length>0&&v.selectedIds.every(uuid)&&unique(v.selectedIds)
  &&nullable(v.applyRequestId,uuid)&&(v.cancelRequestId===undefined||nullable(v.cancelRequestId,uuid)));
 const roster=parseD2Roster(v.roster,eventId);
 const plan=v.plan===null?null:parseD2Plan(v.plan,roster,v.selectedIds as string[]);
 requireValue((v.applyRequestId===null||plan!==null)&&(!v.cancelRequestId||plan!==null));
 return {...v,roster,plan} as D2Journal;
}
export function validateD2Cancellation(value:unknown,intent:D2Journal):void {
 requireValue(record(value)&&value.ok===true&&value.state==='CANCELLED'&&intent.plan
  &&value.planId===intent.plan.planId&&value.eventId===intent.eventId&&value.actorId===intent.actorId
  &&uuid(value.requestId)&&typeof value.cancelledAt==='string'&&Number.isFinite(Date.parse(value.cancelledAt)));
}
export function saveD2Journal(storage:Pick<Storage,'getItem'|'setItem'>,journal:D2Journal,previous:string|null) {
 const key=d2JournalKey(journal.actorId,journal.eventId),raw=JSON.stringify(journal);
 if(storage.getItem(key)!==previous)throw new Error('D2_JOURNAL_CHANGED');
 storage.setItem(key,raw);
 if(storage.getItem(key)!==raw)throw new Error('D2_JOURNAL_SAVE_FAILED');
 return raw;
}
