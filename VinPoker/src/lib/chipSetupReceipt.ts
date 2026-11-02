import {z} from 'zod';

const ok=z.literal('ok'),id=z.string().uuid();
const amount=z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const receipts={
  chip_ops_create_chip_set:z.object({status:ok,chip_set_id:id}),
  chip_ops_bind_tournament_chip_set:z.object({status:ok,chip_set_id:id,action:z.enum(['bound','unchanged','rebound'])}),
  chip_ops_add_denomination:z.object({status:ok,denomination_id:id}),
  chip_ops_delete_denomination:z.object({status:ok,denomination_id:id}),
  chip_ops_save_stack_template:z.object({status:ok,stack_template_id:id,stack_value:amount,sum:amount}),
};
export type ChipSetupRpc=keyof typeof receipts;

/** Validate only explicit canonical receipts; an unknown response is not rollback. */
export function parseChipSetupReceipt(name:ChipSetupRpc,args:Record<string,unknown>,value:unknown):Record<string,unknown>|null {
  const parsed=receipts[name].safeParse(value);
  if(!parsed.success)return null;
  const data=parsed.data as Record<string,unknown>;
  if(name==='chip_ops_bind_tournament_chip_set'&&data.chip_set_id!==args.p_chip_set_id)return null;
  if(name==='chip_ops_delete_denomination'&&data.denomination_id!==args.p_denomination_id)return null;
  if(name==='chip_ops_save_stack_template'&&(data.stack_value!==args.p_stack_value||data.sum!==args.p_stack_value))return null;
  return data;
}
