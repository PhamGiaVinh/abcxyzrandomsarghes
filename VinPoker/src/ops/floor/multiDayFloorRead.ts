import {z} from 'zod';

const text=z.string().min(1),count=z.number().int().nonnegative().safe();
const money=count,percent=z.number().finite().positive().max(100);
const policy=z.enum(['SELECT_LARGEST','SUM_STACKS']);
const payout=z.object({
 state:text,rulesVersion:text,fundingRevision:text,qualificationRevision:text,payoutInputHash:text,
 directPoolVnd:money,transferPoolVnd:money,feesVnd:money,recordedOverlayVnd:money,requiredShortfallVnd:money,
 paidPlayerVnd:money,unpaidObligationVnd:money,clubRetainedTieVnd:money,unallocatedPoolVnd:money,
 obligations:z.array(z.object({playerId:text,participationId:text,rank:count.positive().optional(),totalVnd:money,paidVnd:money,unpaidVnd:money})),
 sourceSnapshot:z.object({payments:z.array(z.object({id:text,playerId:text,amountVnd:money})).optional()}),
});
function payoutIntegrity(value:z.infer<typeof payout>){
 const rows=value.obligations,total=rows.reduce((sum,row)=>sum+row.totalVnd,0),paid=rows.reduce((sum,row)=>sum+row.paidVnd,0),unpaid=rows.reduce((sum,row)=>sum+row.unpaidVnd,0);
 const funded=value.directPoolVnd+value.transferPoolVnd+value.recordedOverlayVnd,owed=total+value.clubRetainedTieVnd;
 return new Set(rows.map(row=>row.playerId)).size===rows.length&&new Set(rows.map(row=>row.participationId)).size===rows.length
  &&rows.every(row=>row.paidVnd+row.unpaidVnd===row.totalVnd)
  &&[total,paid,unpaid,funded,owed].every(Number.isSafeInteger)
  &&paid===value.paidPlayerVnd&&unpaid===value.unpaidObligationVnd
  &&Math.max(owed-funded,0)===value.requiredShortfallVnd&&Math.max(funded-owed,0)===value.unallocatedPoolVnd;
}
const verifiedPayout=payout.refine(payoutIntegrity);
const floor=z.object({
 releaseEnabled:z.boolean(),eventItmPercent:percent,
 capabilities:z.object({canFinalizePayout:z.boolean(),canRequestAdjustment:z.boolean(),canApproveAdjustment:z.boolean()}),
 rules:z.object({policy,itmPercent:percent,day2Percent:percent,minCashX:z.number().finite().min(0).max(100)}).nullable(),
 qualification:z.object({sourceHash:text,participationCount:count,lockedAt:text}).nullable(),
 finalization:payout.extend({requestId:text,finalizedAt:text}).refine(payoutIntegrity).nullable(),
 correctionRequests:z.array(z.object({requestId:text,kind:text,deltaVnd:z.number().int().safe(),reason:text,state:text})),
});
const qualification=z.object({state:text,sourceHash:text,policy,flights:z.array(z.object({
 flightId:text,status:text.nullable(),dayStatus:text.nullable(),validEntries:count,itmTarget:count,day2Target:count,
 eligibleBags:z.array(z.object({bagId:text,playerId:text,stack:count,version:count})),
}))});
const postfinal=z.object({revision:text,paidPlayerVnd:money,unpaidObligationVnd:money,unallocatedPoolVnd:money,
 reversiblePayments:z.array(z.object({id:z.string().uuid(),playerId:z.string().uuid(),participationId:z.string().uuid(),amountVnd:money.positive()}))
  .refine(rows=>new Set(rows.map(row=>row.id)).size===rows.length).optional()});
const closedConfigurationPreview=payout.extend({
 configurationRevision:z.string().regex(/^[a-f0-9]{32}$/),
 previewOnly:z.literal(true),configurationPersistence:z.literal('NOT_PERFORMED'),paymentExecution:z.literal('NOT_PERFORMED'),
 itmPlaces:count.positive(),state:z.enum(['READY','REQUIRED_SHORTFALL']),
 obligations:z.array(z.object({playerId:z.string().uuid(),participationId:z.string().uuid(),rank:count.positive(),
   rankAwardVnd:money,participationFloorVnd:money,nonselectedBagMinCashVnd:money,totalVnd:money,paidVnd:money,unpaidVnd:money})),
}).refine(value=>{
 const rows=value.obligations;
 const total=rows.reduce((sum,row)=>sum+row.totalVnd,0),paid=rows.reduce((sum,row)=>sum+row.paidVnd,0);
 const unpaid=rows.reduce((sum,row)=>sum+row.unpaidVnd,0);
 const funded=value.directPoolVnd+value.transferPoolVnd+value.recordedOverlayVnd;
 return rows.length>=value.itmPlaces&&new Set(rows.map(row=>row.playerId)).size===rows.length
   &&new Set(rows.map(row=>row.participationId)).size===rows.length
   &&rows.every(row=>row.paidVnd+row.unpaidVnd===row.totalVnd
     &&Math.max(row.rankAwardVnd,row.participationFloorVnd)+row.nonselectedBagMinCashVnd===row.totalVnd)
   &&[total,paid,unpaid,funded,total+value.clubRetainedTieVnd].every(Number.isSafeInteger)
   &&paid===value.paidPlayerVnd&&unpaid===value.unpaidObligationVnd
   &&Math.max(total+value.clubRetainedTieVnd-funded,0)===value.requiredShortfallVnd
   &&Math.max(funded-total-value.clubRetainedTieVnd,0)===value.unallocatedPoolVnd
   &&value.state===(value.requiredShortfallVnd>0?'REQUIRED_SHORTFALL':'READY');
});
const liveConfigurationPreview=z.object({
 eventId:z.string().uuid(),finalTournamentId:z.string().uuid(),
 state:z.literal('LIVE_PRIZE_CONFIGURATION_PROPOSAL'),planningOnly:z.literal(true),
 rulesVersion:text,fundingRevision:text,qualificationRevision:text,payoutInputHash:text,
 configurationRevision:z.string().regex(/^[a-f0-9]{32}$/),
 previewOnly:z.literal(true),configurationPersistence:z.literal('NOT_PERFORMED'),paymentExecution:z.literal('NOT_PERFORMED'),
 directPoolVnd:money,transferPoolVnd:money,feesVnd:money,recordedOverlayVnd:money,requiredShortfallVnd:money,itmPlaces:count.positive(),
 prizePositions:z.array(z.object({position:count.positive(),amountVnd:money})),
 planningBudget:z.object({eventId:z.string().uuid(),field:count.positive(),eventFloorVnd:money,fundedVnd:money,
  requiredTotalVnd:money,requiredShortfallVnd:money,
  nonselectedMinCash:z.array(z.object({id:z.string().uuid(),participationId:z.string().uuid(),amountVnd:money}))}),
}).refine(value=>{
 const b=value.planningBudget,prizes=value.prizePositions;
 const extras=b.nonselectedMinCash.reduce((sum,row)=>sum+row.amountVnd,0);
 const total=prizes.reduce((sum,row)=>sum+Math.max(row.amountVnd,b.eventFloorVnd),0)
  +(b.field-prizes.length)*b.eventFloorVnd+extras;
 const funded=value.directPoolVnd+value.transferPoolVnd+value.recordedOverlayVnd;
 return b.eventId===value.eventId&&prizes.length===value.itmPlaces&&b.field>=prizes.length
  &&prizes.every((row,index)=>row.position===index+1&&(index===0||row.amountVnd<=prizes[index-1].amountVnd))
  &&new Set(b.nonselectedMinCash.map(row=>row.id)).size===b.nonselectedMinCash.length
  &&[total,extras,funded].every(Number.isSafeInteger)&&total===b.requiredTotalVnd&&funded===b.fundedVnd
  &&Math.max(total-funded,0)===b.requiredShortfallVnd&&b.requiredShortfallVnd===value.requiredShortfallVnd;
});
const configurationPreview=z.union([closedConfigurationPreview,liveConfigurationPreview]);
export type MultiDayConfigurationPreview=z.infer<typeof configurationPreview>;
export function isLivePrizeConfigurationPreview(value:MultiDayConfigurationPreview):value is z.infer<typeof liveConfigurationPreview>{
 return value.state==='LIVE_PRIZE_CONFIGURATION_PROPOSAL';
}
const schemas:Record<string,z.ZodTypeAny>={multi_day_floor_read_v1:floor,multi_day_qualification_preview_v1:qualification,
 multi_day_payout_preview_v1:verifiedPayout,multi_day_payout_postfinal_state_v1:postfinal,
 multi_day_payout_configuration_preview_v1:configurationPreview};

/** Validate authoritative reads without coercing unknown numbers or authority.
 * Preserve extra server evidence; this function neither computes nor writes it. */
export function verifyMultiDayFloorRead(name:string,data:unknown,eventId?:unknown):void{
 const schema=schemas[name];
 // The existing qualification preview does not echo eventId. Its request is
 // lifetime-fenced by the event panel; do not invent an identity in that packet.
 const expectsEvent=name!=='multi_day_qualification_preview_v1';
 if(schema&&(!schema.safeParse(data).success||(eventId!==undefined&&
  (!data||typeof data!=='object'||('eventId' in data?data.eventId!==eventId:expectsEvent)))))
  throw new Error('Multi-day server state is unverified. Refresh the source before taking action.');
}
