import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {OpsClient} from '@/ops/opsMutations';
let confirm:typeof import('@/ops/opsMutations').confirmStaking;
const id='e5480000-0000-4000-8000-000000000001';
const canonical={success:true,purchase_id:id,purchase_status:'funded',deal_status:'funded',total_funded_percent:10,total_committed_percent:0};
beforeEach(async()=>{vi.resetModules();vi.stubEnv('VITE_OPS_CASHIER_MUTATIONS','preview');vi.stubEnv('VITE_FLOOR_UAT_ENV','preview');confirm=(await import('@/ops/opsMutations')).confirmStaking;});
afterEach(()=>vi.unstubAllEnvs());
it.each([null,{}, {ok:true},{success:true},{...canonical,purchase_id:'other'},{...canonical,purchase_status:'committed'}])('Ops refuses unverified FUNDED proof %j',async data=>{
 const invoke=vi.fn().mockResolvedValue({data,error:null});
 await expect(confirm({functions:{invoke}} as unknown as OpsClient,{purchaseId:id})).rejects.toThrow('staking_funding_receipt_unverified');
 expect(invoke).toHaveBeenCalledTimes(1);
});
it('passes exact purchase/bank/note and accepts only canonical receipt',async()=>{
 const invoke=vi.fn().mockResolvedValue({data:canonical,error:null});
 await expect(confirm({functions:{invoke}} as unknown as OpsClient,{purchaseId:id,bankTxId:' BANK ',note:' TEST '})).resolves.toEqual(canonical);
 expect(invoke).toHaveBeenCalledWith('admin-confirm-funded',{body:{purchase_id:id,bank_tx_id:'BANK',note:'TEST'}});
});
it('does not accept a canonical body alongside transport error',async()=>{
 const invoke=vi.fn().mockResolvedValue({data:canonical,error:new Error('LOCAL network')});
 await expect(confirm({functions:{invoke}} as unknown as OpsClient,{purchaseId:id})).rejects.toThrow('LOCAL network');
});
