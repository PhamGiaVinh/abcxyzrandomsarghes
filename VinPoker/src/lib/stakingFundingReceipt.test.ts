import {expect,it} from 'vitest';
import {assertStakingFundingReceipt,stakingFundingDeliveryMessage} from './stakingFundingReceipt';
const id='e5480000-0000-4000-8000-000000000001';
const canonical={success:true,purchase_id:id,purchase_status:'funded',deal_status:'funded',total_funded_percent:10,total_committed_percent:0};
it('accepts the canonical matching receipt without deriving money',()=>expect(assertStakingFundingReceipt(canonical,id)).toEqual(canonical));
it.each([null,{}, {ok:true},{success:true}, {...canonical,purchase_id:'other'}, {...canonical,deal_status:'cancelled'},
 {...canonical,total_funded_percent:NaN},{...canonical,total_committed_percent:-1},{...canonical,total_funded_percent:'10'},
 {...canonical,error:'denied'},{...canonical,ok:false}])('rejects unverified receipt %j',value=>{
 expect(()=>assertStakingFundingReceipt(value,id)).toThrow('staking_funding_receipt_unverified');
});
const email={purchase_id:id,expected:2,total:2,delivered:2,pending:0,processing:0,needs_attention:0,evidence_missing:false,state:'all_delivered'};
it('reports explicit provider acknowledgements independently from money receipt',()=>{
 expect(stakingFundingDeliveryMessage(email,id)).toContain('Đã nhận xác nhận gửi email');
 expect(stakingFundingDeliveryMessage({...email,delivered:0,pending:2,state:'pending'},id)).toContain('đang chờ xử lý');
 expect(stakingFundingDeliveryMessage({...email,delivered:1,needs_attention:1,state:'needs_attention'},id)).toContain('cần đối chiếu');
});
it.each([null,{}, {state:'unavailable'},{...email,purchase_id:'other'},{...email,delivered:1},
 {...email,evidence_missing:true},{...email,total:1,delivered:1,evidence_missing:true}, {...email,state:'pending'}])('does not claim email delivery from contradictory or unrelated data %j',value=>{
 expect(stakingFundingDeliveryMessage(value,id)).toContain('Chưa xác minh được trạng thái email');
});
