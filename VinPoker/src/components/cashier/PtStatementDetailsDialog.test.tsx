import {act,render,screen,fireEvent,waitFor} from '@testing-library/react';
import {beforeEach,describe,it,expect,vi} from 'vitest';
import {PtStatementDetailsDialog} from './PtStatementDetailsDialog';

const f=vi.hoisted(()=>({rpc:vi.fn(),auth:{user:{id:'11111111-1111-4111-8111-111111111111'},session:{access_token:'TEST_SESSION'},loading:false}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>f.auth}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:f.rpc}}));
const binding={statement_id:'44444444-4444-4444-8444-444444444444',statement_hash:'a'.repeat(64),
  club_id:'22222222-2222-4222-8222-222222222222',dealer_id:'33333333-3333-4333-8333-333333333333',net_amount_vnd:5000000};
const packet=()=>({...binding,approved_amount_vnd:5000000,gross_amount_vnd:5000000,deduction_amount_vnd:0,
  state:'finalized',dealer_name:'Dealer TEST',club_name:'CLB TEST',finalized_at:'2026-11-25T10:00:00Z',as_of:'2026-11-26T10:00:00Z',
  paid_total_vnd:2000000,remaining_vnd:3000000,
  lines:[{line_no:1,label:'Công theo đơn giá đã chốt',quantity:100,unit:'giờ',unit_rate_vnd:50000,amount_vnd:5000000}],
  payments:[{payment_id:'77777777-7777-4777-8777-777777777777',amount_vnd:2000000,paid_at:'2026-11-26T09:00:00Z',payment_method:'bank',payment_reference:'TEST transfer evidence'}]});
beforeEach(()=>{f.rpc.mockReset();f.auth={user:{id:'11111111-1111-4111-8111-111111111111'},session:{access_token:'TEST_SESSION'},loading:false};});
describe('PT payslip and payment history',()=>{
  it('reads only on open and shows approved, recorded and outstanding amounts with payment evidence',async()=>{
    f.rpc.mockResolvedValue({data:packet(),error:null});const close=vi.fn();
    const v=render(<PtStatementDetailsDialog statement={binding} open={false} onOpenChange={close}/>);
    expect(f.rpc).not.toHaveBeenCalled();
    v.rerender(<PtStatementDetailsDialog statement={binding} open onOpenChange={close}/>);
    expect(await screen.findByText('TEST transfer evidence')).toBeInTheDocument();
    expect(screen.getByLabelText('Đã chốt')).toHaveTextContent('5.000.000');
    expect(screen.getByLabelText('Đã ghi nhận chi')).toHaveTextContent('2.000.000');
    expect(screen.getByLabelText('Còn phải trả')).toHaveTextContent('3.000.000');
    expect(screen.getByText(/chưa thay thế xác nhận nhân viên/i)).toBeInTheDocument();
    expect(f.rpc.mock.calls.every(([name])=>name==='get_pt_statement_installments_v1')).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'Đóng phiếu'}));expect(close).toHaveBeenCalledWith(false);
  });
  it('does not show zero or stale money when the scoped read fails',async()=>{
    f.rpc.mockResolvedValue({data:{...packet(),club_id:binding.dealer_id},error:null});
    render(<PtStatementDetailsDialog statement={binding} open onOpenChange={vi.fn()}/>);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Chưa tải được/);
    expect(screen.queryByText('TEST transfer evidence')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Đã ghi nhận chi')).not.toBeInTheDocument();
  });
  it('masks old actor data immediately and ignores its late response',async()=>{
    let finish!:(value:unknown)=>void;f.rpc.mockImplementationOnce(()=>new Promise(r=>{finish=r;})).mockResolvedValue({data:null,error:{message:'denied'}});
    const v=render(<PtStatementDetailsDialog statement={binding} open onOpenChange={vi.fn()}/>);
    await waitFor(()=>expect(f.rpc).toHaveBeenCalledTimes(1));
    f.auth={...f.auth,user:{id:'99999999-9999-4999-8999-999999999999'}};
    v.rerender(<PtStatementDetailsDialog statement={binding} open onOpenChange={vi.fn()}/>);
    await act(async()=>finish({data:packet(),error:null}));
    expect(screen.queryByText('TEST transfer evidence')).not.toBeInTheDocument();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
