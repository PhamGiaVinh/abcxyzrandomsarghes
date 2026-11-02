import {z} from 'zod';
import {parseRankingView} from '@/lib/tournamentRankingReview';
import {eventJournalKey,persistEventJournal,clearEventJournal} from './multiDayEventJournal';
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{32}$/),integer=z.number().int().nonnegative().safe();
const identity=z.object({entryId:uuid,participationId:uuid,playerId:uuid,entryNo:integer.positive(),rank:integer.min(2)});
const frozen=z.object({event_id:uuid,tournament_id:uuid,entry_id:uuid,participation_id:uuid,player_id:uuid,
 entry_no:integer.positive(),finished_place:integer.min(2),source_hash:hash,actor_id:uuid,request_id:uuid});
const participant=z.object({entryId:uuid,participationId:uuid,playerId:uuid,entryNo:integer.positive()});
const obligationRead=z.object({eventId:uuid,tournamentId:uuid,participationId:uuid,entryId:uuid,playerId:uuid,
 rank:integer.min(2),totalVnd:integer,requestId:uuid,confirmedAt:z.string().refine(v=>Number.isFinite(Date.parse(v)))});
export function parseIndividualReview(value:unknown,eventId:string){
 const r=z.object({eventId:uuid,tournamentId:uuid,field:integer.min(2),sourceHash:hash,ranking:z.unknown(),
  participants:z.array(participant),individualResults:z.array(frozen),individualObligations:z.array(obligationRead).optional()}).parse(value);
 const ranking=parseRankingView({ok:true,source:r.ranking,review:null},r.tournamentId).source;
 if(r.eventId!==eventId||r.field!==ranking.field||r.participants.length!==r.field
  ||new Set(r.participants.map(p=>p.entryId)).size!==r.field||new Set(r.participants.map(p=>p.participationId)).size!==r.field
  ||r.participants.some(p=>!ranking.entries.some(e=>e.entryId===p.entryId&&e.playerId===p.playerId&&e.entryNo===p.entryNo))
  ||new Set(r.individualResults.map(p=>p.participation_id)).size!==r.individualResults.length
  ||new Set(r.individualResults.map(p=>p.finished_place)).size!==r.individualResults.length
  ||r.individualResults.some(f=>f.event_id!==eventId||f.tournament_id!==r.tournamentId||f.finished_place>r.field
   ||f.finished_place<=ranking.survivors||!r.participants.some(p=>p.participationId===f.participation_id&&p.entryId===f.entry_id&&p.playerId===f.player_id&&p.entryNo===f.entry_no)
   ||!ranking.entries.some(e=>e.entryId===f.entry_id&&e.status==='busted')))throw Error('INDIVIDUAL_REVIEW_INVALID');
 const obligations=r.individualObligations;
 if(obligations&&(new Set(obligations.map(o=>o.participationId)).size!==obligations.length
  ||obligations.some(o=>o.eventId!==eventId||o.tournamentId!==r.tournamentId||!r.individualResults.some(f=>
   f.participation_id===o.participationId&&f.entry_id===o.entryId&&f.player_id===o.playerId&&f.finished_place===o.rank))))throw Error('INDIVIDUAL_OBLIGATION_READ_INVALID');
 return {...r,ranking,individualObligations:obligations??null};
}
export type IndividualReview=ReturnType<typeof parseIndividualReview>;
export function initialIndividualOrder(view:IndividualReview){
 const busted=view.ranking.entries.filter(e=>e.status==='busted');
 const result:Array<string|undefined>=Array.from({length:busted.length});
 for(const f of view.individualResults)result[f.finished_place-view.ranking.survivors-1]=f.entry_id;
 const remaining=busted.filter(e=>!result.includes(e.entryId)).map(e=>e.entryId);
 return result.map(id=>id??remaining.shift()!);
}
const scopeSchema=z.object({actorId:uuid,eventId:uuid,backendScope:z.string().url()});
export type IndividualScope=z.infer<typeof scopeSchema>;
const rankArgs=z.object({p_event_id:uuid,p_expected_source_hash:hash,p_ordered_busted_entry_ids:z.array(uuid).min(1),p_request_id:uuid}).strict();
const obligationArgs=z.object({p_event_id:uuid,p_participation_id:uuid,p_expected_quote_hash:hash,p_expected_source_hash:hash,p_expected_budget_hash:hash,p_request_id:uuid}).strict();
const rankIdentity=identity.extend({frozenProof:z.object({actorId:uuid,requestId:uuid,sourceHash:hash}).nullable()});
const rankIntent=scopeSchema.extend({kind:z.literal('rank'),args:rankArgs,tournamentId:uuid,expected:z.array(rankIdentity).min(1)}).strict();
const obligationIntent=scopeSchema.extend({kind:z.literal('obligation'),args:obligationArgs,tournamentId:uuid,expected:identity.extend({amountVnd:integer})}).strict();
const intentSchema=z.discriminatedUnion('kind',[rankIntent,obligationIntent]);
export type IndividualIntent=z.infer<typeof intentSchema>;
export const individualResultsJournalKey=(actor:string,event:string)=>eventJournalKey('individual-results',actor,event);
export function parseIndividualIntent(value:unknown,scope:IndividualScope){
 const intent=intentSchema.parse(value);
 if(intent.actorId!==scope.actorId||intent.eventId!==scope.eventId||intent.backendScope!==scope.backendScope||intent.args.p_event_id!==scope.eventId)throw Error('INDIVIDUAL_INTENT_SCOPE');
 if(intent.kind==='rank'){
  if(intent.expected.length!==intent.args.p_ordered_busted_entry_ids.length||new Set(intent.expected.map(e=>e.entryId)).size!==intent.expected.length
   ||new Set(intent.expected.map(e=>e.participationId)).size!==intent.expected.length
   ||intent.expected.some((e,i)=>e.entryId!==intent.args.p_ordered_busted_entry_ids[i]||i>0&&e.rank!==intent.expected[i-1].rank+1))throw Error('INDIVIDUAL_INTENT_ORDER');
 }else if(intent.expected.participationId!==intent.args.p_participation_id)throw Error('INDIVIDUAL_INTENT_SCOPE');
 return intent;
}
export function makeIndividualRankIntent(scope:IndividualScope,view:IndividualReview,order:string[],requestId:string){
 const busted=view.ranking.entries.filter(e=>e.status==='busted');
 if(view.eventId!==scope.eventId||view.ranking.survivors<1||view.ranking.survivors>=view.field||view.ranking.activeHand
  ||view.ranking.evidencePending||view.ranking.hasOfficial||order.length!==busted.length
  ||new Set(order).size!==order.length||order.some(id=>!busted.some(e=>e.entryId===id)))throw Error('INDIVIDUAL_ORDER_INVALID');
 const expected=order.map((id,i)=>{
  const prior=view.individualResults.find(f=>f.entry_id===id);
  return {...view.participants.find(p=>p.entryId===id)!,rank:view.ranking.survivors+i+1,
   frozenProof:prior?{actorId:prior.actor_id,requestId:prior.request_id,sourceHash:prior.source_hash}:null};
 });
 if(view.individualResults.some(f=>!expected.some(e=>e.entryId===f.entry_id&&e.rank===f.finished_place)))throw Error('INDIVIDUAL_FROZEN_ORDER');
 return parseIndividualIntent({...scopeSchema.parse(scope),kind:'rank',tournamentId:view.tournamentId,expected,args:{p_event_id:scope.eventId,
  p_expected_source_hash:view.sourceHash,p_ordered_busted_entry_ids:order,p_request_id:requestId}},scope);
}
export function parseIndividualObligationPreview(value:unknown,view:IndividualReview,participationId:string){
 const row=z.object({ok:z.literal(true),state:z.enum(['READY_TO_CONFIRM','REQUIRED_SHORTFALL']),paymentExecution:z.literal('NOT_PERFORMED'),
  quote:z.object({eventId:uuid,participationId:uuid,entryId:uuid,playerId:uuid,rank:integer.min(2),totalVnd:integer,quoteHash:hash}),
  funding:z.object({eventId:uuid,finalTournamentId:uuid,state:z.literal('INCOMING_SOURCE_VERIFIED'),sourceInputHash:hash}),
  budget:z.object({eventId:uuid,requiredTotalVnd:integer,fundedVnd:integer,requiredShortfallVnd:integer,budgetHash:hash})}).parse(value);
 const f=view.individualResults.find(x=>x.participation_id===participationId),q=row.quote,b=row.budget;
 if(!f||q.eventId!==view.eventId||q.participationId!==participationId||q.entryId!==f.entry_id||q.playerId!==f.player_id||q.rank!==f.finished_place
  ||row.funding.eventId!==view.eventId||row.funding.finalTournamentId!==view.tournamentId||b.eventId!==view.eventId
  ||b.requiredShortfallVnd!==Math.max(0,b.requiredTotalVnd-b.fundedVnd)||q.totalVnd>b.requiredTotalVnd
  ||(row.state==='READY_TO_CONFIRM')!==(b.requiredShortfallVnd===0))throw Error('INDIVIDUAL_OBLIGATION_PREVIEW_INVALID');
 return row;
}
export type IndividualObligationPreview=ReturnType<typeof parseIndividualObligationPreview>;
export function makeIndividualObligationIntent(scope:IndividualScope,view:IndividualReview,preview:IndividualObligationPreview,requestId:string){
 if(view.individualObligations===null)throw Error('INDIVIDUAL_OBLIGATION_READ_UNVERIFIED');
 if(view.individualObligations.some(o=>o.participationId===preview.quote.participationId))throw Error('INDIVIDUAL_OBLIGATION_ALREADY_FINALIZED');
 const verified=parseIndividualObligationPreview(preview,view,preview.quote.participationId);
 if(verified.state!=='READY_TO_CONFIRM')throw Error('INDIVIDUAL_OBLIGATION_UNFUNDED');
 const f=view.individualResults.find(x=>x.participation_id===verified.quote.participationId)!;
 return parseIndividualIntent({...scopeSchema.parse(scope),kind:'obligation',tournamentId:view.tournamentId,
  expected:{entryId:f.entry_id,participationId:f.participation_id,playerId:f.player_id,entryNo:f.entry_no,rank:f.finished_place,amountVnd:verified.quote.totalVnd},
  args:{p_event_id:scope.eventId,p_participation_id:f.participation_id,p_expected_quote_hash:verified.quote.quoteHash,
   p_expected_source_hash:verified.funding.sourceInputHash,p_expected_budget_hash:verified.budget.budgetHash,p_request_id:requestId}},scope);
}
export function readIndividualIntent(storage:Pick<Storage,'getItem'>,scope:IndividualScope){
 const raw=storage.getItem(individualResultsJournalKey(scope.actorId,scope.eventId));return raw===null?null:parseIndividualIntent(JSON.parse(raw),scope);
}
export function persistIndividualIntent(storage:Pick<Storage,'getItem'|'setItem'>,intent:IndividualIntent){
 persistEventJournal(storage,'individual-results',intent.actorId,intent.eventId,JSON.stringify(parseIndividualIntent(intent,intent)));
}
export function clearIndividualIntent(storage:Pick<Storage,'getItem'|'removeItem'>,intent:IndividualIntent){
 clearEventJournal(storage,'individual-results',intent.actorId,intent.eventId,JSON.stringify(parseIndividualIntent(intent,intent)));
}
export function parseIndividualReceipt(value:unknown,intent:IndividualIntent,recovery:boolean){
 let candidate=value;
 if(recovery){const wrapper=z.object({ok:z.literal(true),outcome:z.enum(['recorded','not_found']),receipt:z.unknown()}).parse(value);
  if(wrapper.outcome==='not_found'){if(wrapper.receipt!==null)throw Error('INDIVIDUAL_RECEIPT_INVALID');return false;}
  candidate=wrapper.receipt;
 }
 const root=z.object({ok:z.literal(true),outcome:z.enum(['recorded','already_finalized']),eventId:uuid,requestId:uuid,paymentExecution:z.literal('NOT_PERFORMED')}).passthrough().parse(candidate);
 if(root.eventId!==intent.eventId||root.requestId!==intent.args.p_request_id)throw Error('INDIVIDUAL_RECEIPT_SCOPE');
 if(intent.kind==='rank'){
  const r=z.object({sourceHash:hash,individualResults:z.array(frozen)}).parse(candidate);
  if(root.outcome!=='recorded'||r.sourceHash!==intent.args.p_expected_source_hash||r.individualResults.length!==intent.expected.length
   ||intent.expected.some(e=>!r.individualResults.some(f=>f.event_id===intent.eventId&&f.tournament_id===intent.tournamentId
    &&f.entry_id===e.entryId&&f.participation_id===e.participationId&&f.player_id===e.playerId&&f.entry_no===e.entryNo&&f.finished_place===e.rank
    &&f.actor_id===(e.frozenProof?.actorId??intent.actorId)&&f.request_id===(e.frozenProof?.requestId??intent.args.p_request_id)
    &&f.source_hash===(e.frozenProof?.sourceHash??intent.args.p_expected_source_hash))))throw Error('INDIVIDUAL_RECEIPT_INVALID');
 }else{
  const o=z.object({obligation:z.object({event_id:uuid,tournament_id:uuid,participation_id:uuid,entry_id:uuid,player_id:uuid,
   finished_place:integer.min(2),amount_vnd:integer,quote_hash:hash,source_input_hash:hash,budget_hash:hash,actor_id:uuid,request_id:uuid})}).parse(candidate).obligation;
  const e=intent.expected;
  if(o.event_id!==intent.eventId||o.tournament_id!==intent.tournamentId||o.participation_id!==e.participationId||o.entry_id!==e.entryId
   ||o.player_id!==e.playerId||o.finished_place!==e.rank||o.amount_vnd!==e.amountVnd
   ||root.outcome==='recorded'&&(o.actor_id!==intent.actorId||o.request_id!==intent.args.p_request_id
    ||o.quote_hash!==intent.args.p_expected_quote_hash||o.source_input_hash!==intent.args.p_expected_source_hash||o.budget_hash!==intent.args.p_expected_budget_hash))throw Error('INDIVIDUAL_RECEIPT_INVALID');
 }
 return true;
}
