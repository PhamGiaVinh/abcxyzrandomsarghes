import {z} from 'zod';
const Scope=z.object({actorId:z.string().uuid(),clubId:z.string().uuid(),tournamentId:z.string().uuid()}).strict();
const Intent=Scope.extend({version:z.literal(1),requestId:z.string().uuid(),name:z.string().trim().min(1)}).strict();
export type ChipSetCreationScope=z.infer<typeof Scope>;
export type ChipSetCreationIntent=z.infer<typeof Intent>;
const Base=z.object({actor_id:z.string().uuid(),club_id:z.string().uuid(),tournament_id:z.string().uuid(),request_id:z.string().uuid(),set_name:z.string().min(1)});
const Receipt=z.discriminatedUnion('outcome',[
 Base.extend({status:z.literal('ok'),outcome:z.literal('created_bound'),chip_set_id:z.string().uuid(),error:z.null()}).strict(),
 Base.extend({status:z.literal('ok'),outcome:z.literal('cancelled'),chip_set_id:z.null(),error:z.null()}).strict(),
 Base.extend({status:z.literal('rejected'),outcome:z.literal('rejected'),chip_set_id:z.null(),error:z.string().min(1)}).strict(),
]);
export type ChipSetCreationReceipt=z.infer<typeof Receipt>;
const key=(scope:ChipSetCreationScope)=>`vinpoker:chip-set-create:v1:${scope.actorId}:${scope.clubId}:${scope.tournamentId}`;
export function parseChipSetCreationReceipt(value:unknown,intent:ChipSetCreationIntent):ChipSetCreationReceipt {
 const i=Intent.parse(intent),r=Receipt.parse(value);
 if(r.actor_id!==i.actorId||r.club_id!==i.clubId||r.tournament_id!==i.tournamentId||r.request_id!==i.requestId||r.set_name!==i.name)
  throw new Error('CHIP_SET_RECEIPT_SCOPE_INVALID');
 return r;
}
export function readChipSetCreationIntent(storage:Pick<Storage,'getItem'>,scope:ChipSetCreationScope):ChipSetCreationIntent|null {
 const s=Scope.parse(scope),raw=storage.getItem(key(s));if(raw===null)return null;
 const i=Intent.parse(JSON.parse(raw));
 if(i.actorId!==s.actorId||i.clubId!==s.clubId||i.tournamentId!==s.tournamentId)throw new Error('CHIP_SET_INTENT_SCOPE_INVALID');
 return i;
}
export function persistChipSetCreationIntent(storage:Pick<Storage,'getItem'|'setItem'>,scope:ChipSetCreationScope,name:string):ChipSetCreationIntent {
 const s=Scope.parse(scope),previous=readChipSetCreationIntent(storage,s);
 if(previous){if(previous.name!==name.trim())throw new Error('CHIP_SET_INTENT_PENDING');return previous;}
 const i=Intent.parse({...s,version:1,requestId:crypto.randomUUID(),name:name.trim()}),raw=JSON.stringify(i);
 storage.setItem(key(s),raw);if(storage.getItem(key(s))!==raw)throw new Error('CHIP_SET_INTENT_SAVE_FAILED');return i;
}
export function clearChipSetCreationIntent(storage:Pick<Storage,'getItem'|'removeItem'>,intent:ChipSetCreationIntent,receipt:unknown):void {
 const i=Intent.parse(intent);parseChipSetCreationReceipt(receipt,i);
 const k=key(i),raw=storage.getItem(k);if(raw===null)return;
 if(raw!==JSON.stringify(i))throw new Error('CHIP_SET_INTENT_CHANGED');
 storage.removeItem(k);if(storage.getItem(k)!==null)throw new Error('CHIP_SET_INTENT_CLEAR_FAILED');
}
