import {describe,it,expect} from 'vitest';
import {parsePtStatementDetails} from './ptStatementDetails';
import {FEATURES} from './featureFlags';

export const binding={statement_id:'44444444-4444-4444-8444-444444444444',statement_hash:'a'.repeat(64),
  club_id:'22222222-2222-4222-8222-222222222222',dealer_id:'33333333-3333-4333-8333-333333333333',net_amount_vnd:5000000};
export const detail=()=>({...binding,approved_amount_vnd:5000000,gross_amount_vnd:5000000,deduction_amount_vnd:0,
  state:'finalized',dealer_name:'Dealer TEST',club_name:'CLB TEST',finalized_at:'2026-11-25T10:00:00Z',as_of:'2026-11-26T10:00:00Z',
  paid_total_vnd:2000000,remaining_vnd:3000000,
  lines:[{line_no:1,label:'Công theo đơn giá đã chốt',quantity:100,unit:'giờ',unit_rate_vnd:50000,amount_vnd:5000000}],
  payments:[{payment_id:'77777777-7777-4777-8777-777777777777',amount_vnd:2000000,paid_at:'2026-11-26T09:00:00Z',
    payment_method:'bank',payment_reference:'TEST payment reference'}]});

describe('PT statement detail boundary',()=>{
  it('keeps payment-history UI disabled before scoped backend rollout',()=>{
    expect(FEATURES.financePtStatementDetails).toBe(false);
  });
  it('preserves approved earnings and each canonical payment without deriving a new wage',()=>{
    const result=parsePtStatementDetails(detail(),binding);
    expect(result).toMatchObject({approved_amount_vnd:5000000,paid_total_vnd:2000000,remaining_vnd:3000000});
  });
  it.each(['statement_id','statement_hash','club_id','dealer_id','approved_amount_vnd'])('rejects foreign or changed %s',field=>{
    expect(()=>parsePtStatementDetails({...detail(),[field]:field==='approved_amount_vnd'?1:field==='statement_hash'?'b'.repeat(64):'88888888-8888-4888-8888-888888888888'},binding)).toThrow();
  });
  it.each([
    {paid_total_vnd:2000001}, {remaining_vnd:3000001}, {paid_total_vnd:Number.MAX_SAFE_INTEGER+1},
    {payments:[]},{payments:[detail().payments[0],detail().payments[0]]}, {as_of:'invalid'},
    {payments:[{...detail().payments[0],amount_vnd:1}]},{gross_amount_vnd:5000001},
  ])('rejects malformed or inconsistent server facts %j',patch=>{
    expect(()=>parsePtStatementDetails({...detail(),...patch},binding)).toThrow();
  });
  it('keeps original amount while reporting zero debt for an untouched cancelled statement',()=>{
    expect(parsePtStatementDetails({...detail(),state:'voided',paid_total_vnd:0,remaining_vnd:0,payments:[]},binding))
      .toMatchObject({approved_amount_vnd:5000000,remaining_vnd:0});
  });
});
