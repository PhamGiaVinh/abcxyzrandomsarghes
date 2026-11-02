import {z} from 'zod';

const Scope=z.object({actorId:z.string().uuid(),clubId:z.string().uuid(),tournamentId:z.string().uuid()}).strict();
const Line=z.object({denomination_id:z.string().uuid(),count:z.number().int().positive().max(2147483647)}).strict();
const Draft=z.object({chipSetId:z.string().uuid(),name:z.string().trim().min(1),stackValue:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
 lines:z.array(Line).min(1).refine(lines=>new Set(lines.map(line=>line.denomination_id)).size===lines.length,'Duplicate denomination')
  .transform(lines=>[...lines].sort((a,b)=>a.denomination_id.localeCompare(b.denomination_id)))}).strict();
const Intent=Scope.merge(Draft).extend({version:z.literal(1),requestId:z.string().uuid()}).strict();
export type ChipTemplateSaveScope=z.infer<typeof Scope>;
export type ChipTemplateSaveDraft=z.infer<typeof Draft>;
export type ChipTemplateSaveIntent=z.infer<typeof Intent>;
const Base=z.object({actor_id:z.string().uuid(),club_id:z.string().uuid(),tournament_id:z.string().uuid(),request_id:z.string().uuid(),chip_set_id:z.string().uuid()});
const Saved=z.object({status:z.literal('ok'),stack_template_id:z.string().uuid(),stack_value:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),sum:z.number().int().positive().max(Number.MAX_SAFE_INTEGER)}).strict();
const Receipt=z.discriminatedUnion('outcome',[
 Base.extend({status:z.literal('ok'),outcome:z.literal('saved'),error:z.null(),result:Saved}).strict(),
 Base.extend({status:z.literal('ok'),outcome:z.literal('cancelled'),error:z.null(),result:z.null()}).strict(),
 Base.extend({status:z.literal('rejected'),outcome:z.literal('rejected'),error:z.string().min(1),result:z.record(z.unknown()).nullable()}).strict(),
]);
export type ChipTemplateSaveReceipt=z.infer<typeof Receipt>;
const key=(s:ChipTemplateSaveScope)=>`vinpoker:chip-template-save:v1:${s.actorId}:${s.clubId}:${s.tournamentId}`;
export function parseChipTemplateSaveIntent(value:unknown):ChipTemplateSaveIntent{return Intent.parse(value);}
export function parseChipTemplateSaveReceipt(value:unknown,intent:ChipTemplateSaveIntent):ChipTemplateSaveReceipt{
 const i=Intent.parse(intent),r=Receipt.parse(value);
 if(r.actor_id!==i.actorId||r.club_id!==i.clubId||r.tournament_id!==i.tournamentId||r.request_id!==i.requestId||r.chip_set_id!==i.chipSetId
  ||(r.outcome==='saved'&&(r.result.stack_value!==i.stackValue||r.result.sum!==i.stackValue)))throw new Error('CHIP_TEMPLATE_RECEIPT_SCOPE_INVALID');
 return r;
}
export function readChipTemplateSaveIntent(storage:Pick<Storage,'getItem'>,scope:ChipTemplateSaveScope):ChipTemplateSaveIntent|null{
 const s=Scope.parse(scope),raw=storage.getItem(key(s));if(raw===null)return null;
 const i=Intent.parse(JSON.parse(raw));
 if(i.actorId!==s.actorId||i.clubId!==s.clubId||i.tournamentId!==s.tournamentId)throw new Error('CHIP_TEMPLATE_INTENT_SCOPE_INVALID');
 return i;
}
export function persistChipTemplateSaveIntent(storage:Pick<Storage,'getItem'|'setItem'>,scope:ChipTemplateSaveScope,draft:ChipTemplateSaveDraft):ChipTemplateSaveIntent{
 const s=Scope.parse(scope),d=Draft.parse(draft),previous=readChipTemplateSaveIntent(storage,s);
 if(previous){
  const old=Draft.parse({chipSetId:previous.chipSetId,name:previous.name,stackValue:previous.stackValue,lines:previous.lines});
  if(JSON.stringify(old)!==JSON.stringify(d))throw new Error('CHIP_TEMPLATE_INTENT_PENDING');
  return previous;
 }
 const i=Intent.parse({...s,...d,version:1,requestId:crypto.randomUUID()}),raw=JSON.stringify(i);
 storage.setItem(key(s),raw);if(storage.getItem(key(s))!==raw)throw new Error('CHIP_TEMPLATE_INTENT_SAVE_FAILED');return i;
}
export function clearChipTemplateSaveIntent(storage:Pick<Storage,'getItem'|'removeItem'>,intent:ChipTemplateSaveIntent,receipt:unknown):void{
 const i=Intent.parse(intent);parseChipTemplateSaveReceipt(receipt,i);
 const k=key(i),raw=storage.getItem(k);if(raw===null)return;
 if(raw!==JSON.stringify(i))throw new Error('CHIP_TEMPLATE_INTENT_CHANGED');
 storage.removeItem(k);if(storage.getItem(k)!==null)throw new Error('CHIP_TEMPLATE_INTENT_CLEAR_FAILED');
}
export function chipTemplateSaveArgs(intent:ChipTemplateSaveIntent){
 const i=Intent.parse(intent);
 return {p_tournament_id:i.tournamentId,p_chip_set_id:i.chipSetId,p_name:i.name,p_stack_value:i.stackValue,
  p_lines:i.lines,p_request_id:i.requestId,p_expected_actor:i.actorId};
}
