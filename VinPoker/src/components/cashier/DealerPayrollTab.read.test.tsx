import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {formatVND} from '@/lib/format';
import type {DealerPayrollRow} from '@/hooks/useDealerPayroll';
import type {PayrollSaveIntent} from '@/lib/payrollSaveIntent';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({rpc:vi.fn(),failure:vi.fn(),actor:'actor' as string|null,session:{access_token:'TEST payroll old session'},pending:null as PayrollSaveIntent|null,lookup:vi.fn(),cancel:vi.fn(),persist:vi.fn(),rows:[] as DealerPayrollRow[],save:vi.fn(),success:vi.fn(),fetch:vi.fn().mockResolvedValue(undefined),saved:vi.fn(),adjustments:vi.fn(),payment:vi.fn()}));
vi.mock('@/lib/payrollSaveIntent',()=>({
 readPayrollSaveIntent:(_storage:unknown,scope:PayrollSaveIntent)=>state.pending?.actorId===scope.actorId&&state.pending.clubId===scope.clubId&&state.pending.year===scope.year&&state.pending.month===scope.month?state.pending:null,
 persistPayrollSaveIntent:(_storage:unknown,scope:PayrollSaveIntent)=>{state.persist();state.pending={...scope,version:1,requestId:'33333333-3333-4333-8333-333333333333'};return state.pending;},
 clearPayrollSaveIntent:()=>{state.pending=null;},
}));
vi.mock('sonner',()=>({toast:{success:state.success,error:state.failure}}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:state.rpc}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:state.actor?{id:state.actor}:null,session:state.session,isAdmin:false})}));
vi.mock('@/hooks/useOperatorClubs',()=>({useOperatorClubs:()=>({scope:[]})}));
vi.mock('@/hooks/useFtPayrollStatements',()=>({useFtPayrollStatements:()=>({availability:'legacy',refresh:vi.fn()})}));
vi.mock('@/hooks/usePayrollStatementTelegramDelivery',()=>({usePayrollStatementTelegramDelivery:()=>({})}));
vi.mock('@/hooks/useDealerPayroll',async(importOriginal)=>({...await importOriginal<typeof import('@/hooks/useDealerPayroll')>(),
  useDealerPayroll:()=>({data:state.rows,period:{start:'',end:''},loading:false,error:null,fetchPayroll:state.fetch}),getSavedPayroll:state.saved,savePayrollWithIntent:state.save,getPayrollSaveReceipt:state.lookup,cancelUnresolvedPayrollSave:state.cancel,
  loadPayrollAdjustments:state.adjustments,getPaymentRecord:state.payment,addPayrollAdjustment:(...args:unknown[])=>state.rpc(...args),deletePayrollAdjustment:(...args:unknown[])=>state.rpc(...args)}));
import DealerPayrollTab from './DealerPayrollTab';
beforeEach(()=>{vi.clearAllMocks();state.actor='actor';state.session={access_token:'TEST payroll old session'};state.pending=null;state.lookup.mockResolvedValue(null);state.rows=[];state.saved.mockRejectedValue(new Error('LOCAL 503'));state.adjustments.mockResolvedValue({});state.payment.mockResolvedValue(null);});
function editablePayroll(){
  state.saved.mockResolvedValue({periodId:null,status:null,records:[]});
  state.rows=[{dealer_id:'dealer',full_name:'LOCAL TEST dealer',employment_type:'part_time',shifts:[],
    monthly_salary_vnd:0,hourly_rate_vnd:0,standard_hours_per_shift:8,ot_multiplier:1.5,standard_shifts_per_month:26,
    total_shifts:0,total_hours:0,regular_hours:0,ot_hours:0,base_salary_vnd:0,regular_pay_vnd:0,ot_pay_vnd:0,gross_pay_vnd:0,
    total_adjustments_vnd:0,tips_amount_vnd:0,bhxh_deduction_vnd:0,bhyt_deduction_vnd:0,bhtn_deduction_vnd:0,pit_deduction_vnd:0,net_pay_vnd:0,net_pay_after_tax_vnd:0}];
}
describe('payroll saved-state availability',()=>{
  it.each(['full_time','part_time'] as const)('totals only visible %s rows in the section subtotal without changing period totals',async employment_type=>{
    editablePayroll();
    const base=state.rows[0];
    state.rows=[{...base,employment_type,dealer_id:'visible',full_name:'VISIBLE TEST',total_hours:2,regular_hours:2,regular_pay_vnd:100000,gross_pay_vnd:100000,net_pay_vnd:100000,net_pay_after_tax_vnd:100000},
      {...base,employment_type,dealer_id:'hidden',full_name:'HIDDEN TEST',total_hours:8,regular_hours:8,regular_pay_vnd:400000,gross_pay_vnd:400000,net_pay_vnd:400000,net_pay_after_tax_vnd:400000}];
    render(<DealerPayrollTab clubIds={['club']} clubs={[{id:'club',name:'TEST'}]}/>);
    await screen.findByText('Chưa lưu — tạm tính, chưa chốt giờ công');
    fireEvent.change(screen.getByRole('textbox'),{target:{value:'VISIBLE'}});
    const subtotal=screen.getByText(employment_type==='full_time'?'FT subtotal':'PT subtotal').closest('tr')!;
    expect(within(subtotal).getAllByText('2h')).toHaveLength(2);
    expect(subtotal).not.toHaveTextContent('10h');
    const cellText=within(subtotal).getAllByRole('cell').map(cell=>cell.textContent);
    expect(cellText).toContain(formatVND(100000));
    expect(cellText).not.toContain(formatVND(500000));
    expect(screen.getAllByText('10h').length).toBeGreaterThan(0); // whole-period summary remains unfiltered
    expect(state.save).not.toHaveBeenCalled();
  });
  it.each([false,true])('allows a scoped adjustment after leaving an unresolved old-club dialog (return=%s)',async(returnToOriginal)=>{
    editablePayroll();state.saved.mockImplementation(async(clubId:string)=>({periodId:`period-${clubId}`,status:'draft',records:[{...state.rows[0],id:`saved-${clubId}`,club_id:clubId,period_id:`period-${clubId}`,status:'pending'}]}));
    let finish!:(value:unknown)=>void;state.rpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    render(<DealerPayrollTab clubIds={['club','other']} clubs={[{id:'club',name:'TEST A'},{id:'other',name:'TEST B'}]}/>);
    fireEvent.click(await screen.findByTitle('Điều chỉnh'));
    fireEvent.change(screen.getByPlaceholderText('VD: 500000'),{target:{value:'1000'}});
    fireEvent.click(screen.getByRole('button',{name:'Thêm'}));
    fireEvent.click(screen.getByRole('button',{name:'Huỷ'}));
    Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:vi.fn()});
    try {
      fireEvent.keyDown(screen.getAllByRole('combobox')[0],{key:'ArrowDown'});
      fireEvent.click(await screen.findByRole('option',{name:'TEST B'}));
      await waitFor(()=>expect(state.fetch).toHaveBeenLastCalledWith('other',expect.any(String),expect.any(String)));
      await screen.findByTitle('Điều chỉnh');
      if(returnToOriginal){
        fireEvent.keyDown(screen.getAllByRole('combobox')[0],{key:'ArrowDown'});
        fireEvent.click(await screen.findByRole('option',{name:'TEST A'}));
        await waitFor(()=>expect(state.fetch).toHaveBeenLastCalledWith('club',expect.any(String),expect.any(String)));
      }
      fireEvent.click(await screen.findByTitle('Điều chỉnh'));
      fireEvent.change(screen.getByPlaceholderText('VD: 500000'),{target:{value:'2000'}});
      expect(screen.getByRole('button',{name:'Thêm'})).toBeEnabled();
      await act(async()=>finish({id:'old-adjustment'}));
      expect(state.success).not.toHaveBeenCalled();
      expect(screen.getByDisplayValue('2000')).toBeInTheDocument();
    } finally {Reflect.deleteProperty(HTMLElement.prototype,'scrollIntoView');}
  });
  it.each(['success','failure'])('ignores old-account adjustment deletion %s',async(outcome)=>{
    editablePayroll();state.saved.mockResolvedValue({periodId:'period',status:'draft',records:[{...state.rows[0],id:'saved',club_id:'club',period_id:'period',status:'pending'}]});
    state.adjustments.mockResolvedValue({dealer:[{id:'adjustment',adjustment_type:'BONUS',amount_vnd:1000,reason:'LOCAL TEST'}]});
    let finish!:(value:unknown)=>void;let fail!:(reason:Error)=>void;
    state.rpc.mockImplementationOnce(()=>new Promise((resolve,reject)=>{finish=resolve;fail=reject;}));
    const props={clubIds:['club'],clubs:[{id:'club',name:'TEST'}]};const view=render(<DealerPayrollTab {...props}/>);
    fireEvent.click(await screen.findByTitle('Xóa'));expect(state.rpc).toHaveBeenCalledWith('adjustment');
    state.actor='second';view.rerender(<DealerPayrollTab {...props}/>);
    await screen.findByTitle('Xóa');const reads=state.saved.mock.calls.length;
    await act(async()=>{if(outcome==='failure')fail(new Error('LOCAL old delete failure'));else finish(undefined);});
    expect(state.success).not.toHaveBeenCalled();expect(state.failure).not.toHaveBeenCalled();
    expect(state.saved).toHaveBeenCalledTimes(reads);
  });
  it('refreshes and confirms an adjustment when its account and period remain current',async()=>{
    editablePayroll();state.saved.mockResolvedValue({periodId:'period',status:'draft',records:[{...state.rows[0],id:'saved',club_id:'club',period_id:'period',status:'pending'}]});
    state.rpc.mockResolvedValueOnce({id:'adjustment'});
    render(<DealerPayrollTab clubIds={['club']} clubs={[{id:'club',name:'TEST'}]}/>);
    fireEvent.click(await screen.findByTitle('Điều chỉnh'));
    fireEvent.change(screen.getByPlaceholderText('VD: 500000'),{target:{value:'1000'}});
    const reads=state.saved.mock.calls.length;
    fireEvent.click(screen.getByRole('button',{name:'Thêm'}));
    await waitFor(()=>expect(state.success).toHaveBeenCalledWith('Đã thêm điều chỉnh'));
    expect(state.saved.mock.calls.length).toBeGreaterThan(reads);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it.each(['account','session','failure'])('ignores an adjustment completion from the previous %s',async(kind)=>{
    editablePayroll();state.saved.mockResolvedValue({periodId:'period',status:'draft',records:[{...state.rows[0],id:'saved',club_id:'club',period_id:'period',status:'pending'}]});
    let finish!:(value:unknown)=>void;let fail!:(reason:Error)=>void;
    state.rpc.mockImplementationOnce(()=>new Promise((resolve,reject)=>{finish=resolve;fail=reject;}));
    const props={clubIds:['club'],clubs:[{id:'club',name:'TEST'}]};const view=render(<DealerPayrollTab {...props}/>);
    fireEvent.click(await screen.findByTitle('Điều chỉnh'));
    fireEvent.change(screen.getByPlaceholderText('VD: 500000'),{target:{value:'1000'}});
    fireEvent.click(screen.getByRole('button',{name:'Thêm'}));
    expect(state.rpc).toHaveBeenCalledWith('saved','BONUS',1000,'BONUS','actor');
    if(kind==='session')state.session={access_token:'TEST payroll replacement session'};else state.actor='second';
    view.rerender(<DealerPayrollTab {...props}/>);
    fireEvent.click(await screen.findByTitle('Điều chỉnh'));
    const reads=state.saved.mock.calls.length;
    await act(async()=>{if(kind==='failure')fail(new Error('LOCAL old adjustment failure'));else finish({id:'adjustment'});});
    expect(state.success).not.toHaveBeenCalled();expect(state.failure).not.toHaveBeenCalled();
    expect(state.saved).toHaveBeenCalledTimes(reads);
    expect(screen.getByRole('dialog',{name:'Thêm điều chỉnh'})).toBeInTheDocument();
  });
  it('does not truncate the payroll status and provisional-hours explanation on narrow cards',async()=>{
    editablePayroll();render(<DealerPayrollTab clubIds={['club']} clubs={[{id:'club',name:'TEST'}]}/>);
    const note=await screen.findByText('Chưa lưu — tạm tính, chưa chốt giờ công');
    expect(note).not.toHaveClass('truncate');
    expect(screen.getByText('Trạng thái bảng lương')).not.toHaveClass('truncate');
    expect(screen.getByText('Chưa lưu')).not.toHaveClass('truncate');
  });
  it('labels an open-shift standard-hours preview as provisional rather than a running clock',async()=>{
    editablePayroll();state.rows[0].total_hours=8;state.rows[0].regular_hours=8;state.rows[0].total_shifts=1;
    state.rows[0].shifts=[{attendance_id:'attendance',check_in_time:'2026-10-20T11:59:00Z',check_out_time:null,
      shift_hours:8,regular_hours:8,ot_hours:0,is_overnight:false,total_worked_minutes:0,overtime_minutes:0,regular_minutes:0}];
    render(<DealerPayrollTab clubIds={['club']} clubs={[{id:'club',name:'TEST'}]}/>);
    expect(await screen.findByText(/Chưa lưu — tạm tính/)).toBeInTheDocument();
    expect(screen.getByText(/ca chưa checkout — giờ tạm tính theo ca chuẩn/)).toBeInTheDocument();
    expect(screen.queryByText(/chi phí có thể đang tăng sai/)).not.toBeInTheDocument();
  });
  it('does not replace an empty saved period with a newly calculated live dealer',async()=>{
    editablePayroll();state.rows[0].full_name='LIVE ONLY NOT IN SAVED SNAPSHOT';
    state.saved.mockResolvedValue({periodId:'period',status:'paid',records:[]});
    render(<DealerPayrollTab clubIds={['club']} clubs={[{id:'club',name:'TEST'}]}/>);
    await waitFor(()=>expect(state.payment).toHaveBeenCalled());
    await waitFor(()=>expect(screen.queryByText(/Đang xác minh trạng thái kỳ lương/)).not.toBeInTheDocument());
    expect(screen.queryAllByText('LIVE ONLY NOT IN SAVED SNAPSHOT')).toHaveLength(0);
  });
  it.each([
    ['draft','Gửi duyệt'],['submitted','Duyệt bảng lương'],['approved','Khoá sổ'],
    ['rejected','Sửa lại và gửi duyệt'],['submitted','Từ chối'],
  ])('fences old-account %s/%s failures without leaking a stale toast',async(status,label)=>{
    editablePayroll();state.saved.mockResolvedValue({periodId:'period',status,records:[{...state.rows[0],id:'saved',club_id:'club',period_id:'period',status:'pending'}]});
    let finish!:(value:unknown)=>void;state.rpc.mockImplementationOnce(()=>new Promise(done=>{finish=done;}));
    const props={clubIds:['club'],clubs:[{id:'club',name:'TEST'}]};const view=render(<DealerPayrollTab {...props}/>);
    const button=await screen.findByRole('button',{name:label});
    if(label==='Từ chối')fireEvent.change(screen.getByPlaceholderText('Nhập lý do từ chối...'),{target:{value:'LOCAL TEST'}});
    fireEvent.click(button);expect(state.rpc).toHaveBeenCalledTimes(1);
    state.actor='second';view.rerender(<DealerPayrollTab {...props}/>);
    await screen.findByRole('button',{name:label});
    await act(async()=>finish({data:null,error:new Error('LOCAL old account failure')}));
    expect(state.success).not.toHaveBeenCalled();expect(state.failure).not.toHaveBeenCalled();
  });
  it.each(['account','session'])('ignores a submit completion from the previous %s',async(kind)=>{
    editablePayroll();state.saved.mockResolvedValue({periodId:'period',status:'draft',records:[{...state.rows[0],id:'saved',club_id:'club',period_id:'period',status:'pending'}]});
    let finish!:(value:unknown)=>void;state.rpc.mockImplementationOnce(()=>new Promise(done=>{finish=done;}));
    const props={clubIds:['club'],clubs:[{id:'club',name:'TEST'}]};
    const view=render(<DealerPayrollTab {...props}/>);
    fireEvent.click(await screen.findByRole('button',{name:'Gửi duyệt'}));
    if(kind==='account')state.actor='second';else state.session={access_token:'TEST payroll new session'};
    view.rerender(<DealerPayrollTab {...props}/>);
    await screen.findByRole('button',{name:'Gửi duyệt'});
    await act(async()=>finish({data:true,error:null}));
    expect(state.success).not.toHaveBeenCalled();expect(state.failure).not.toHaveBeenCalled();
  });
  it('serializes same-tick submit requests',async()=>{
    editablePayroll();state.saved.mockResolvedValue({periodId:'period',status:'draft',records:[{...state.rows[0],id:'saved',club_id:'club',period_id:'period',status:'pending'}]});
    let finish!:(value:unknown)=>void;state.rpc.mockImplementation(()=>new Promise(done=>{finish=done;}));
    render(<DealerPayrollTab clubIds={['club']} clubs={[{id:'club',name:'TEST'}]}/>);
    const button=await screen.findByRole('button',{name:'Gửi duyệt'});
    act(()=>{fireEvent.click(button);fireEvent.click(button);});
    const calls=state.rpc.mock.calls.length;
    await act(async()=>finish({data:true,error:null}));
    expect(calls).toBe(1);
  });
  it('does not show a successful submit after an actual helper receives false',async()=>{
    editablePayroll();state.saved.mockResolvedValue({periodId:'period',status:'draft',records:[{...state.rows[0],id:'saved',club_id:'club',period_id:'period',status:'pending'}]});
    state.rpc.mockResolvedValue({data:false,error:null});
    render(<DealerPayrollTab clubIds={['club']} clubs={[{id:'club',name:'TEST'}]}/>);
    fireEvent.click(await screen.findByRole('button',{name:'Gửi duyệt'}));
    await waitFor(()=>expect(state.failure).toHaveBeenCalledWith(expect.stringContaining('Trạng thái kỳ lương')));
    expect(state.success).not.toHaveBeenCalled();
    expect(screen.getByRole('button',{name:'Gửi duyệt'})).toBeInTheDocument();
  });
  it('recovers a committed save after reload through lookup without resubmitting',async()=>{
    editablePayroll();const now=new Date();
    state.pending={version:1,actorId:'actor',clubId:'club',year:now.getFullYear(),month:now.getMonth()+1,requestId:'33333333-3333-4333-8333-333333333333'};
    state.lookup.mockResolvedValue({ok:true,outcome:'saved',periodId:'2236ec97-2f12-402f-8912-025d238d5618',savedCount:1});
    render(<DealerPayrollTab clubIds={['club']} clubs={[{id:'club',name:'TEST'}]}/>);
    await screen.findByRole('button',{name:'Lưu bảng lương'});
    expect(state.lookup).toHaveBeenCalledTimes(1);expect(state.save).not.toHaveBeenCalled();expect(state.persist).not.toHaveBeenCalled();expect(state.pending).toBeNull();
  });
  it('holds an unresolved reloaded request and explicitly cancels without another save',async()=>{
    editablePayroll();const now=new Date();
    const pending={version:1 as const,actorId:'actor',clubId:'club',year:now.getFullYear(),month:now.getMonth()+1,requestId:'33333333-3333-4333-8333-333333333333'};state.pending=pending;
    state.cancel.mockResolvedValue({ok:true,outcome:'cancelled',periodId:null,savedCount:0});
    render(<DealerPayrollTab clubIds={['club']} clubs={[{id:'club',name:'TEST'}]}/>);
    const cancel=await screen.findByRole('button',{name:'Hủy request chưa xác minh'});await waitFor(()=>expect(cancel).toBeEnabled());
    expect(state.fetch).not.toHaveBeenCalled();expect(state.save).not.toHaveBeenCalled();
    fireEvent.click(cancel);await screen.findByRole('button',{name:'Lưu bảng lương'});
    expect(state.cancel).toHaveBeenCalledWith(pending);expect(state.save).not.toHaveBeenCalled();expect(state.persist).not.toHaveBeenCalled();
  });
  it('does not send a save when intent persistence fails',async()=>{
    editablePayroll();state.persist.mockImplementationOnce(()=>{throw new Error('LOCAL storage unavailable');});
    render(<DealerPayrollTab clubIds={['club']} clubs={[{id:'club',name:'TEST'}]}/>);
    fireEvent.click(await screen.findByRole('button',{name:'Lưu bảng lương'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Chưa xác minh');expect(state.save).not.toHaveBeenCalled();
  });
  it('ignores an old-account save completion without success toast or stale refresh',async()=>{
    editablePayroll();let finish!:(value:unknown)=>void;state.save.mockImplementationOnce(()=>new Promise(done=>{finish=done;}));
    const props={clubIds:['club'],clubs:[{id:'club',name:'TEST'}]};const view=render(<DealerPayrollTab {...props}/>);
    fireEvent.click(await screen.findByRole('button',{name:'Lưu bảng lương'}));
    state.actor='second';view.rerender(<DealerPayrollTab {...props}/>);
    await screen.findByRole('button',{name:'Lưu bảng lương'});
    await act(async()=>finish({periodId:'2236ec97-2f12-402f-8912-025d238d5618',savedCount:1}));
    expect(state.success).not.toHaveBeenCalled();expect(state.fetch).toHaveBeenCalledTimes(2);
  });
  it('serializes same-tick saves',async()=>{
    editablePayroll();let finish!:(value:unknown)=>void;state.save.mockImplementationOnce(()=>new Promise(done=>{finish=done;}));
    render(<DealerPayrollTab clubIds={['club']} clubs={[{id:'club',name:'TEST'}]}/>);
    const button=await screen.findByRole('button',{name:'Lưu bảng lương'});
    act(()=>{fireEvent.click(button);fireEvent.click(button);});expect(state.save).toHaveBeenCalledTimes(1);
    await act(async()=>finish({periodId:'2236ec97-2f12-402f-8912-025d238d5618',savedCount:1}));
  });
  it('blocks an unknown save result until a fresh read',async()=>{
    editablePayroll();state.save.mockRejectedValue(new Error('LOCAL lost response'));
    render(<DealerPayrollTab clubIds={['club']} clubs={[{id:'club',name:'TEST'}]}/>);
    fireEvent.click(await screen.findByRole('button',{name:'Lưu bảng lương'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Chưa xác minh được kết quả lưu');
    expect(state.success).not.toHaveBeenCalled();expect(state.save).toHaveBeenCalledTimes(1);
  });
  it('does not continue old-account secondary reads after an account change',async()=>{
    let resolveOld!:(value:unknown)=>void;
    state.saved.mockImplementationOnce(()=>new Promise(done=>{resolveOld=done;})).mockImplementation(()=>new Promise(()=>{}));
    const props={clubIds:['club'],clubs:[{id:'club',name:'TEST'}]};
    const view=render(<DealerPayrollTab {...props}/>);
    await waitFor(()=>expect(state.saved).toHaveBeenCalledTimes(1));
    state.actor='second';view.rerender(<DealerPayrollTab {...props}/>);
    await waitFor(()=>expect(state.saved).toHaveBeenCalledTimes(2));
    await act(async()=>resolveOld({periodId:'old-paid',status:'paid',records:[]}));
    expect(state.adjustments).not.toHaveBeenCalled();expect(state.payment).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Đang xác minh trạng thái kỳ lương');
  });
  it('clears private operational UI on logout and starts no new read',async()=>{
    state.actor=null;render(<DealerPayrollTab clubIds={['club']} clubs={[{id:'club',name:'TEST'}]}/>);
    expect(screen.getByRole('alert')).toHaveTextContent('Đăng nhập');expect(state.saved).not.toHaveBeenCalled();
  });
  it('switches to an allowed club when the operator club scope changes',async()=>{
    state.saved.mockImplementation(()=>new Promise(()=>{}));
    const view=render(<DealerPayrollTab clubIds={['a']} clubs={[{id:'a',name:'A TEST'}]}/>);
    await waitFor(()=>expect(state.saved).toHaveBeenCalledWith('a',expect.any(Number),expect.any(Number)));
    view.rerender(<DealerPayrollTab clubIds={['b']} clubs={[{id:'b',name:'B TEST'}]}/>);
    await waitFor(()=>expect(state.saved).toHaveBeenLastCalledWith('b',expect.any(Number),expect.any(Number)));
  });
  it.each(['adjustments','payment'] as const)('blocks operations when the %s read fails',async(kind)=>{
    state.saved.mockResolvedValue({periodId:'period',status:'paid',records:[]});
    state[kind].mockRejectedValue(new Error('LOCAL secondary 503'));
    render(<DealerPayrollTab clubIds={['club']} clubs={[{id:'club',name:'TEST'}]}/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Không xác minh được trạng thái kỳ lương');
    expect(screen.getByRole('button',{name:'Tải lại kỳ lương'})).toBeEnabled();
  });
  it('blocks the operational screen when saved period status cannot be verified',async()=>{
    render(<DealerPayrollTab clubIds={['club']} clubs={[{id:'club',name:'TEST'}]}/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Không xác minh được trạng thái kỳ lương');
    expect(screen.getByRole('button',{name:'Tải lại kỳ lương'})).toBeEnabled();
    expect(screen.queryByText('Lưu bảng lương')).not.toBeInTheDocument();
  });
});

it('refreshes the monthly wage preview and saved state while idle without a manual click',async()=>{
 vi.useFakeTimers();editablePayroll();
 const view=render(<DealerPayrollTab clubIds={['club']} clubs={[{id:'club',name:'TEST'}]}/>);
 try{
  await act(async()=>vi.advanceTimersByTimeAsync(1));expect(state.fetch).toHaveBeenCalledTimes(1);
  await act(async()=>vi.advanceTimersByTimeAsync(5000));expect(state.fetch).toHaveBeenCalledTimes(2);
  expect(state.save).not.toHaveBeenCalled();
 }finally{view.unmount();vi.useRealTimers();}
});

it('keeps frozen FT money after the next automatic live preview changes',async()=>{
 vi.useFakeTimers();editablePayroll();const base=state.rows[0];
 const frozen={...base,employment_type:'full_time',gross_pay_vnd:100000,net_pay_vnd:100000,net_pay_after_tax_vnd:100000,
   id:'saved',club_id:'club',period_id:'period',status:'pending'};
 state.rows=[{...base,employment_type:'full_time'}];state.saved.mockResolvedValue({periodId:'period',status:'paid',records:[frozen]});
 const view=render(<DealerPayrollTab clubIds={['club']} clubs={[{id:'club',name:'TEST'}]}/>);
 try{
  await act(async()=>vi.advanceTimersByTimeAsync(1));
  state.rows=[{...base,employment_type:'full_time',gross_pay_vnd:9000000,net_pay_vnd:9000000,net_pay_after_tax_vnd:9000000}];
  await act(async()=>vi.advanceTimersByTimeAsync(5000));expect(state.fetch).toHaveBeenCalledTimes(2);
  expect(screen.getAllByText(/100\.000\s*₫/).length).toBeGreaterThan(0);
  expect(screen.queryByText(/9\.000\.000\s*₫/)).not.toBeInTheDocument();expect(state.save).not.toHaveBeenCalled();
 }finally{view.unmount();vi.useRealTimers();}
});
it('pauses monthly polling while an adjustment dialog contains operator input',async()=>{
 vi.useFakeTimers();editablePayroll();state.saved.mockResolvedValue({periodId:'period',status:'draft',records:[{...state.rows[0],id:'saved',club_id:'club',period_id:'period',status:'pending'}]});
 const view=render(<DealerPayrollTab clubIds={['club']} clubs={[{id:'club',name:'TEST'}]}/>);
 try{
  await act(async()=>vi.advanceTimersByTimeAsync(1));fireEvent.click(screen.getByTitle('Điều chỉnh'));
  fireEvent.change(screen.getByPlaceholderText('VD: 500000'),{target:{value:'17000'}});
  await act(async()=>vi.advanceTimersByTimeAsync(10000));expect(state.fetch).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('dialog',{name:'Thêm điều chỉnh'})).toBeInTheDocument();
  expect(screen.getByPlaceholderText('VD: 500000')).toHaveValue(17000);expect(state.save).not.toHaveBeenCalled();
 }finally{view.unmount();vi.useRealTimers();}
});
it.each([
 ['locked','Chuẩn bị chi trả',null],
 ['payment_prepared','Xác nhận đã chi trả','Mã/tham chiếu thanh toán...'],
 ['paid','Đối soát',null],
] as const)('resumes report verification after a stalled %s payment operation',async(status,label,placeholder)=>{
 vi.useFakeTimers();editablePayroll();state.saved.mockResolvedValue({periodId:'period',status,records:[{...state.rows[0],id:'saved',club_id:'club',period_id:'period',status:'pending'}]});state.rpc.mockImplementation(()=>new Promise(()=>{}));
 const view=render(<DealerPayrollTab clubIds={['club']} clubs={[{id:'club',name:'TEST'}]}/>);
 try{
  await act(async()=>vi.advanceTimersByTimeAsync(1));
  if(placeholder)fireEvent.change(screen.getByPlaceholderText(placeholder),{target:{value:'LOCAL TEST reference'}});
  fireEvent.click(screen.getByRole('button',{name:label}));
  await act(async()=>vi.advanceTimersByTimeAsync(20001));
  await act(async()=>vi.advanceTimersByTimeAsync(5001));
  expect(state.fetch.mock.calls.length).toBeGreaterThan(1);
  expect(state.success).not.toHaveBeenCalled();expect(state.rpc).toHaveBeenCalledTimes(1);
 }finally{view.unmount();vi.useRealTimers();}
});
it.each([
 ['locked','Chuẩn bị chi trả',null,'actor'],['payment_prepared','Xác nhận đã chi trả','Mã/tham chiếu thanh toán...','actor'],['paid','Đối soát',null,'actor'],
 ['locked','Chuẩn bị chi trả',null,'session'],['payment_prepared','Xác nhận đã chi trả','Mã/tham chiếu thanh toán...','session'],['paid','Đối soát',null,'session'],
] as const)('ignores late %s payment completion after %s context replacement',async(status,label,placeholder,replacement)=>{
 editablePayroll();state.saved.mockResolvedValue({periodId:'period',status,records:[{...state.rows[0],id:'saved',club_id:'club',period_id:'period',status:'pending'}]});
 let finish!:(value:unknown)=>void;state.rpc.mockImplementationOnce(()=>new Promise(done=>{finish=done;}));
 const props={clubIds:['club'],clubs:[{id:'club',name:'TEST'}]};const view=render(<DealerPayrollTab {...props}/>);
 const button=await screen.findByRole('button',{name:label});if(placeholder)fireEvent.change(screen.getByPlaceholderText(placeholder),{target:{value:'LOCAL TEST reference'}});fireEvent.click(button);
 if(replacement==='actor')state.actor='second';else state.session={access_token:'TEST payroll replacement session'};
 view.rerender(<DealerPayrollTab {...props}/>);await screen.findByRole('button',{name:label});
 await act(async()=>finish({data:status==='locked'?'11111111-1111-4111-8111-111111111111':true,error:null}));
 expect(state.success).not.toHaveBeenCalled();expect(state.fetch).toHaveBeenCalledTimes(2);
});
it('allows payment in a newly selected club while ignoring the old club completion',async()=>{
 editablePayroll();state.saved.mockImplementation(async(clubId:string)=>({periodId:`period-${clubId}`,status:'locked',records:[{...state.rows[0],id:`saved-${clubId}`,club_id:clubId,period_id:`period-${clubId}`,status:'pending'}]}));
 let finish!:(value:unknown)=>void;state.rpc.mockImplementationOnce(()=>new Promise(done=>{finish=done;}));
 const view=render(<DealerPayrollTab clubIds={['club','other']} clubs={[{id:'club',name:'TEST A'},{id:'other',name:'TEST B'}]}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Chuẩn bị chi trả'}));
 Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:vi.fn()});
 try{
  fireEvent.keyDown(screen.getAllByRole('combobox')[0],{key:'ArrowDown'});fireEvent.click(await screen.findByRole('option',{name:'TEST B'}));
  await waitFor(()=>expect(state.fetch).toHaveBeenLastCalledWith('other',expect.any(String),expect.any(String)));
  expect(await screen.findByRole('button',{name:'Chuẩn bị chi trả'})).toBeEnabled();
  await act(async()=>finish({data:'11111111-1111-4111-8111-111111111111',error:null}));
  expect(state.success).not.toHaveBeenCalled();
 }finally{await act(async()=>finish({data:'11111111-1111-4111-8111-111111111111',error:null}));view.unmount();Reflect.deleteProperty(HTMLElement.prototype,'scrollIntoView');}
});
