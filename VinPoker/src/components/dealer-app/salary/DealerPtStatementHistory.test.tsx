import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {DealerPtStatementHistory} from './DealerPtStatementHistory';
import {parsePtStatementHistory} from '@/lib/ptStatementDetails';
const f=vi.hoisted(()=>({rpc:vi.fn(),auth:{user:{id:'actor-a'},session:{access_token:'history-a'},loading:false}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>f.auth}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:(...args:unknown[])=>f.rpc(...args)}}));
const club='18000000-0000-4000-8000-000000000001',dealer='18000000-0000-4000-8000-000000000052';
const id=(n:number)=>`18000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const row=(n=71)=>({statement_id:id(n),statement_hash:'a'.repeat(64),club_id:club,dealer_id:dealer,
  net_amount_vnd:5000000,paid_total_vnd:2000000,remaining_vnd:3000000,state:'finalized',finalized_at:'2026-08-09T08:00:00.123456Z'});
const page=(items=[row()],next_cursor:unknown=null)=>({club_id:club,dealer_id:dealer,as_of:'2026-08-10T08:00:00Z',items,next_cursor});
const parsed=(p:unknown,before=null)=>parsePtStatementHistory(p,{club_id:club,dealer_id:dealer},before);
describe('recipient frozen PT history',()=>{
  beforeEach(()=>{f.rpc.mockReset();f.auth={user:{id:'actor-a'},session:{access_token:'history-a'},loading:false};});
  it('validates bounded deterministic pages without computing earned money',()=>{
    const rows=Array.from({length:20},(_,i)=>row(100-i)),cursor={statement_id:rows[19].statement_id,finalized_at:rows[19].finalized_at};
    expect(parsed(page(rows,cursor)).items).toHaveLength(20);
    expect(()=>parsed(page([...rows,row(79)],cursor))).toThrow();
    expect(()=>parsed(page(rows,{...cursor,statement_id:id(79)}))).toThrow();
    expect(()=>parsed(page([row(100),row(100)]))).toThrow();
    expect(()=>parsed(page([row(99),row(100)]))).toThrow();
    expect(()=>parsed(page([{...row(),remaining_vnd:0}]))).toThrow();
    expect(()=>parsed(page([{...row(),club_id:id(2)}]))).toThrow();
    expect(()=>parsed({...page(),dealer_id:id(53)})).toThrow();
    expect(()=>parsed(page([{...row(),state:'voided'}]))).toThrow();
    expect(parsed(page([{...row(),state:'voided',paid_total_vnd:0,remaining_vnd:0}])).items[0].remaining_vnd).toBe(0);
  });
  it('preserves microsecond ordering instead of treating every Date.parse millisecond as a tie',()=>{
    expect(parsed(page([{...row(99),finalized_at:'2026-08-09T08:00:00.123456Z'},
      {...row(100),finalized_at:'2026-08-09T08:00:00.123455Z'}])).items).toHaveLength(2);
  });
  it('shows canonical remaining money, no payment control and no false received confirmation',async()=>{
    f.rpc.mockResolvedValue({data:page(),error:null});render(<DealerPtStatementHistory clubId={club} dealerId={dealer}/>);
    const section=await screen.findByRole('region',{name:'Phiếu lương PT đã chốt'});
    await within(section).findByText(/3\.000\.000/);
    expect(within(section).getByText(/chưa thay thế xác nhận nhận tiền/)).toBeInTheDocument();
    expect(within(section).queryByRole('button',{name:/Trả|Chi tiền|Chốt kỳ/})).toBeNull();
    expect(f.rpc).toHaveBeenCalledWith('list_my_pt_statements_v1',{p_club_id:club,p_dealer_id:dealer,p_before_at:null,p_before_id:null});
  });
  it('pages using the exact server cursor and refreshes latest instead of appending mixed pages',async()=>{
    const rows=Array.from({length:20},(_,i)=>row(100-i));const cursor={statement_id:rows[19].statement_id,finalized_at:rows[19].finalized_at};
    f.rpc.mockResolvedValueOnce({data:page(rows,cursor),error:null}).mockResolvedValue({data:page([row(79)]),error:null});
    render(<DealerPtStatementHistory clubId={club} dealerId={dealer}/>);
    fireEvent.click(await screen.findByRole('button',{name:'Xem phiếu cũ hơn'}));
    await waitFor(()=>expect(f.rpc).toHaveBeenLastCalledWith('list_my_pt_statements_v1',{
      p_club_id:club,p_dealer_id:dealer,p_before_at:cursor.finalized_at,p_before_id:cursor.statement_id}));
    expect(await screen.findByRole('listitem',{name:`Phiếu ${id(79)}`})).toBeInTheDocument();
    expect(screen.queryByRole('listitem',{name:`Phiếu ${id(100)}`})).toBeNull();
    f.rpc.mockResolvedValue({data:page(),error:null});fireEvent.click(screen.getByRole('button',{name:'Tải lại mới nhất'}));
    await waitFor(()=>expect(f.rpc).toHaveBeenLastCalledWith('list_my_pt_statements_v1',{
      p_club_id:club,p_dealer_id:dealer,p_before_at:null,p_before_id:null}));
  });
  it('removes failed or revoked data rather than showing zero debt',async()=>{
    f.rpc.mockResolvedValueOnce({data:page(),error:null}).mockResolvedValue({data:null,error:{code:'42501'}});
    render(<DealerPtStatementHistory clubId={club} dealerId={dealer}/>);await screen.findByText(/3\.000\.000/);
    fireEvent(window,new Event('focus'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Chưa tải được/);
    expect(screen.queryByText(/3\.000\.000/)).toBeNull();
    expect(screen.queryByRole('button',{name:/Xem phiếu 180/})).toBeNull();
  });
  it.each(['actor','session','club','dealer'])('masks a stale %s response before replacement verification',async(change)=>{
    let finish!:(value:unknown)=>void;
    f.rpc.mockReturnValueOnce(new Promise(r=>{finish=r;})).mockResolvedValue({data:null,error:{code:'42501'}});
    const v=render(<DealerPtStatementHistory clubId={club} dealerId={dealer}/>);
    await waitFor(()=>expect(f.rpc).toHaveBeenCalledTimes(1));
    if(change==='actor') f.auth={...f.auth,user:{id:'actor-b'}};
    if(change==='session') f.auth={...f.auth,session:{access_token:'history-b'}};
    v.rerender(<DealerPtStatementHistory clubId={change==='club'?id(2):club} dealerId={change==='dealer'?id(53):dealer}/>);
    await act(async()=>finish({data:page(),error:null}));
    expect(screen.queryByText(/3\.000\.000/)).toBeNull();expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
