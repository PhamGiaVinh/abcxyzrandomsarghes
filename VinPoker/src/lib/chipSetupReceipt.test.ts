import {describe,expect,it} from 'vitest';
import {parseChipSetupReceipt,type ChipSetupRpc} from './chipSetupReceipt';
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const cases:[ChipSetupRpc,Record<string,unknown>,Record<string,unknown>][]=[
 ['chip_ops_create_chip_set',{}, {status:'ok',chip_set_id:id}],
 ['chip_ops_bind_tournament_chip_set',{p_chip_set_id:id},{status:'ok',chip_set_id:id,action:'bound'}],
 ['chip_ops_add_denomination',{}, {status:'ok',denomination_id:id}],
 ['chip_ops_delete_denomination',{p_denomination_id:id},{status:'ok',denomination_id:id}],
 ['chip_ops_save_stack_template',{p_stack_value:20000},{status:'ok',stack_template_id:id,stack_value:20000,sum:20000}],
];
describe('Chip Setup canonical receipt boundary',()=>{
 it.each(cases)('preserves %s canonical success',(name,args,receipt)=>expect(parseChipSetupReceipt(name,args,receipt)).toEqual(receipt));
 it.each(cases)('rejects unconfirmed packets for %s',(name,args)=>{
  for(const packet of [null,undefined,{},[],false,{status:'ok'},{status:'unknown'}])expect(parseChipSetupReceipt(name,args,packet)).toBeNull();
 });
 it.each(['bound','unchanged','rebound'])('accepts canonical bind action %s',action=>{
  expect(parseChipSetupReceipt('chip_ops_bind_tournament_chip_set',{p_chip_set_id:id},{status:'ok',chip_set_id:id,action})).not.toBeNull();
 });
 it('rejects another resource identity or a changed stack total',()=>{
  expect(parseChipSetupReceipt('chip_ops_bind_tournament_chip_set',{p_chip_set_id:id},{status:'ok',chip_set_id:other,action:'bound'})).toBeNull();
  expect(parseChipSetupReceipt('chip_ops_delete_denomination',{p_denomination_id:id},{status:'ok',denomination_id:other})).toBeNull();
  expect(parseChipSetupReceipt('chip_ops_save_stack_template',{p_stack_value:20000},{status:'ok',stack_template_id:id,stack_value:20000,sum:19999})).toBeNull();
 });
});
