import {z} from 'zod';
import {parseChipSetupReceipt} from './chipSetupReceipt.ts';
const uuid=z.string().uuid();
const Scope=z.object({actorId:uuid,clubId:uuid,tournamentId:uuid}).strict();
const Payload=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('bind'),chip_set_id:uuid,expected_chip_set_id:uuid.nullable()}).strict(),
 z.object({operation:z.literal('add'),chip_set_id:uuid,value:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),color:z.string().nullable(),label:z.string().nullable(),display_order:z.number().int().min(0).max(2147483647)}).strict(),
 z.object({operation:z.literal('delete'),chip_set_id:uuid,denomination_id:uuid}).strict(),
]);
const Intent=Scope.extend({version:z.literal(1),requestId:uuid,payload:Payload}).strict();
export type ChipSetupMetadataScope=z.infer<typeof Scope>;
export type ChipSetupMetadataPayload=z.infer<typeof Payload>;
export type ChipSetupMetadataIntent=z.infer<typeof Intent>;
const Base=z.object({actor_id:uuid,club_id:uuid,tournament_id:uuid,request_id:uuid,payload:Payload});
const Receipt=z.discriminatedUnion('outcome',[
 Base.extend({status:z.literal('ok'),outcome:z.literal('applied'),error:z.null(),result:z.record(z.unknown())}).strict(),
 Base.extend({status:z.literal('ok'),outcome:z.literal('cancelled'),error:z.null(),result:z.null()}).strict(),
 Base.extend({status:z.literal('rejected'),outcome:z.literal('rejected'),error:z.string().min(1),result:z.record(z.unknown()).nullable()}).strict(),
]);
export type ChipSetupMetadataReceipt=z.infer<typeof Receipt>;
const key=(s:ChipSetupMetadataScope)=>`vinpoker:chip-setup-metadata:v1:${s.actorId}:${s.clubId}:${s.tournamentId}`;
export function parseChipSetupMetadataReceipt(value:unknown,intent:ChipSetupMetadataIntent):ChipSetupMetadataReceipt{
 const i=Intent.parse(intent),r=Receipt.parse(value);
 if(r.actor_id!==i.actorId||r.club_id!==i.clubId||r.tournament_id!==i.tournamentId||r.request_id!==i.requestId||JSON.stringify(r.payload)!==JSON.stringify(i.payload))throw new Error('CHIP_METADATA_RECEIPT_SCOPE_INVALID');
 if(r.outcome==='applied'){
  const p=i.payload,name=p.operation==='bind'?'chip_ops_bind_tournament_chip_set':p.operation==='add'?'chip_ops_add_denomination':'chip_ops_delete_denomination';
  const args=p.operation==='delete'?{p_denomination_id:p.denomination_id}:{p_chip_set_id:p.chip_set_id};
  if(!parseChipSetupReceipt(name,args,r.result))throw new Error('CHIP_METADATA_UNVERIFIED_RESULT');
 }
 return r;
}
export function readChipSetupMetadataIntent(storage:Pick<Storage,'getItem'>,scope:ChipSetupMetadataScope):ChipSetupMetadataIntent|null{
 const s=Scope.parse(scope),raw=storage.getItem(key(s));if(raw===null)return null;
 const i=Intent.parse(JSON.parse(raw));
 if(i.actorId!==s.actorId||i.clubId!==s.clubId||i.tournamentId!==s.tournamentId)throw new Error('CHIP_METADATA_INTENT_SCOPE_INVALID');
 return i;
}
export function persistChipSetupMetadataIntent(storage:Pick<Storage,'getItem'|'setItem'>,scope:ChipSetupMetadataScope,payload:ChipSetupMetadataPayload):ChipSetupMetadataIntent{
 const s=Scope.parse(scope),p=Payload.parse(payload),old=readChipSetupMetadataIntent(storage,s);
 if(old){if(JSON.stringify(old.payload)!==JSON.stringify(p))throw new Error('CHIP_METADATA_INTENT_PENDING');return old;}
 const i=Intent.parse({...s,version:1,requestId:crypto.randomUUID(),payload:p}),raw=JSON.stringify(i);
 storage.setItem(key(s),raw);if(storage.getItem(key(s))!==raw)throw new Error('CHIP_METADATA_INTENT_SAVE_FAILED');return i;
}
export function clearChipSetupMetadataIntent(storage:Pick<Storage,'getItem'|'removeItem'>,intent:ChipSetupMetadataIntent,receipt:unknown):void{
 const i=Intent.parse(intent);parseChipSetupMetadataReceipt(receipt,i);
 const k=key(i),raw=storage.getItem(k);if(raw===null)return;
 if(raw!==JSON.stringify(i))throw new Error('CHIP_METADATA_INTENT_CHANGED');
 storage.removeItem(k);if(storage.getItem(k)!==null)throw new Error('CHIP_METADATA_INTENT_CLEAR_FAILED');
}
export function chipSetupMetadataArgs(intent:ChipSetupMetadataIntent){
 const i=Intent.parse(intent);return{p_tournament_id:i.tournamentId,p_payload:i.payload,p_request_id:i.requestId,p_expected_actor:i.actorId};
}
