// Presentation fixture only. No production client, credentials or financial writes.
export const binding={statement_id:'44444444-4444-4444-8444-444444444444',statement_hash:'a'.repeat(64),
  club_id:'22222222-2222-4222-8222-222222222222',dealer_id:'33333333-3333-4333-8333-333333333333',net_amount_vnd:5000000};
const auth={user:{id:'11111111-1111-4111-8111-111111111111'},session:{access_token:'SYNTHETIC_TEST_SESSION'},loading:false};
export function useAuth(){return auth;}
const packet={...binding,approved_amount_vnd:5000000,gross_amount_vnd:5000000,deduction_amount_vnd:0,
  dealer_name:'Nguyễn Hoàng Minh Anh TEST — tên dài trên điện thoại',club_name:'Center Point · DỮ LIỆU MÔ PHỎNG',
  state:'finalized',finalized_at:'2026-11-25T10:00:00Z',as_of:'2026-11-26T10:00:00Z',paid_total_vnd:2000000,remaining_vnd:3000000,
  lines:[{line_no:1,label:'Công theo đơn giá đã chốt trong phiếu gốc',quantity:100,unit:'giờ',unit_rate_vnd:50000,amount_vnd:5000000}],
  payments:[{payment_id:'77777777-7777-4777-8777-777777777777',amount_vnd:2000000,paid_at:'2026-11-26T09:00:00Z',
    payment_method:'bank',payment_reference:`TEST-SEPAY-${'0123456789'.repeat(40)}`}],
};
export const fixture={calls:[] as string[],
  settle(){packet.paid_total_vnd=5000000;packet.remaining_vnd=0;packet.payments.push({payment_id:'88888888-8888-4888-8888-888888888888',
    amount_vnd:3000000,paid_at:'2026-11-26T10:00:00Z',payment_method:'cash',payment_reference:'TEST tiền mặt'});window.dispatchEvent(new Event('focus'));},
};
export const supabase={async rpc(name:string,args:{p_statement_id:string}){
  fixture.calls.push(name);
  if(name!=='get_pt_statement_installments_v1' || args.p_statement_id!==binding.statement_id) throw Error('fixture_read_only_scope_required');
  return {data:structuredClone(packet),error:null};
}};
