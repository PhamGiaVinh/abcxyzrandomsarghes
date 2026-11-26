import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({read:vi.fn(),write:vi.fn(),cashFlag:false,pendingInput:null as any,clubError:false,clubs:[{id:'club-a',name:'LOCAL TEST A'}],summary:{data:undefined as any,isError:true,isLoading:false,isFetching:false,refetch:vi.fn()}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'owner-test'},loading:false,isClubOwner:true})}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:{clubExpenses:true,get clubExpenseCashSource(){return f.cashFlag;}}}));
vi.mock('@/components/clubExpenses/CashierExpenseEntry',()=>({default:()=> <p>LOCAL TEST SOURCE ENTRY</p>}));
vi.mock('@/lib/clubExpenses/dataSource',()=>({clubExpensesSource:()=> 'live'}));
vi.mock('@/hooks/clubExpenses/useExpenseClubs',()=>({useExpenseClubs:()=>({data:f.clubs,isLoading:false,isError:f.clubError,refetch:vi.fn()})}));
vi.mock('@/hooks/clubExpenses/useClubExpenses',()=>({useClubExpenses:(...args:unknown[])=>{f.read(...args);return f.summary;},useRecordClubExpense:()=>({isPending:false,mutateAsync:f.write,pendingInput:f.pendingInput,contextKey:'LOCAL_TEST'})}));
import ClubExpenses from './ClubExpenses';
beforeEach(()=>{sessionStorage.clear();f.cashFlag=false;f.read.mockReset();f.write.mockReset();f.pendingInput=null;f.clubError=false;f.clubs=[{id:'club-a',name:'LOCAL TEST A'}];f.summary={data:undefined,isError:true,isLoading:false,isFetching:false,refetch:vi.fn()};});
afterEach(()=>{cleanup();vi.useRealTimers();});
const mount=()=>render(<MemoryRouter><ClubExpenses/></MemoryRouter>);
it('does not render a failed expense read as verified zero or empty history',()=>{
 mount();expect(screen.getByRole('alert').textContent).toContain('Không xác minh được sổ chi phí');expect(screen.queryByText('Chưa có chi phí trong tháng này.')).toBeNull();expect(screen.getAllByText('Chưa xác minh')).toHaveLength(4);expect((screen.getByRole('button',{name:'Ghi chi phí'}) as HTMLButtonElement).disabled).toBe(true);
});
it('does not claim no memberships when the club list read fails',()=>{
 f.clubError=true;f.clubs=[];mount();expect(screen.getByRole('alert').textContent).toContain('Không tải được danh sách CLB');expect(screen.queryByText(/Bạn chưa có CLB/)).toBeNull();
});
it('queries the Vietnam month using a half-open interval at UTC year rollover',()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-12-31T17:30:00Z'));mount();expect(f.read).toHaveBeenLastCalledWith('live','club-a','2026-12-31T17:00:00.000Z','2027-01-31T17:00:00.000Z');expect((screen.getByLabelText('Ngày') as HTMLInputElement).value).toBe('2027-01-01');
});
it('drops a selected club when it disappears from current membership evidence',()=>{
 const v=mount();f.clubs=[{id:'club-b',name:'LOCAL TEST B'}];v.rerender(<MemoryRouter><ClubExpenses/></MemoryRouter>);expect(f.read.mock.calls.at(-1)?.[1]).toBe('club-b');
});
const verified=()=>{f.summary={...f.summary,isError:false,data:{rows:[],totalVnd:0,paidVnd:0,unpaidVnd:0}};};
it('offers one entry task at a time and keeps the explicit cash source hidden by default',async()=>{
 verified();const view=mount();expect(screen.queryByRole('button',{name:'Chi từ két Cashier'})).toBeNull();
 f.cashFlag=true;view.rerender(<MemoryRouter><ClubExpenses/></MemoryRouter>);
 fireEvent.click(screen.getByRole('button',{name:'Chi từ két Cashier'}));await screen.findByText('LOCAL TEST SOURCE ENTRY');expect(screen.queryByLabelText('Số tiền')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Ghi nhận chi phí'}));expect(screen.getByLabelText('Số tiền')).toBeTruthy();expect(screen.queryByText('LOCAL TEST SOURCE ENTRY')).toBeNull();
});
it('keeps source recovery reachable after the UI flag is off and blocks switching to another expense',async()=>{
 verified();sessionStorage.setItem('vinpoker:cashier-expense:v1:owner-test:club-a','unresolved source request');mount();
 await screen.findByText('LOCAL TEST SOURCE ENTRY');expect(screen.getByRole('button',{name:'Ghi nhận chi phí'})).toBeDisabled();expect(screen.queryByLabelText('Số tiền')).toBeNull();
});
const draft=()=>{fireEvent.change(screen.getByLabelText('Số tiền'),{target:{value:'10000'}});fireEvent.change(screen.getByLabelText('Mô tả'),{target:{value:'LOCAL TEST draft'}});};
it('retains the draft until a confirmed asynchronous receipt and prevents double submit',async()=>{
 verified();let resolve!:(v:unknown)=>void;f.write.mockReturnValue(new Promise(r=>{resolve=r;}));mount();draft();const form=screen.getByLabelText('Số tiền').closest('form')!;fireEvent.submit(form);fireEvent.submit(form);expect(f.write).toHaveBeenCalledTimes(1);expect((screen.getByLabelText('Số tiền') as HTMLInputElement).value).toBe('10000');await act(async()=>{resolve({status:'ok'});});await waitFor(()=>expect((screen.getByLabelText('Số tiền') as HTMLInputElement).value).toBe(''));
});
it('retains entered values and shows an explicit unknown-outcome message on failure',async()=>{
 verified();f.write.mockRejectedValue(Error('Chưa xác minh giao dịch'));mount();draft();fireEvent.submit(screen.getByLabelText('Số tiền').closest('form')!);await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('Chưa xác minh'));expect((screen.getByLabelText('Số tiền') as HTMLInputElement).value).toBe('10000');expect((screen.getByLabelText('Mô tả') as HTMLTextAreaElement).value).toBe('LOCAL TEST draft');
});
it('restores an unresolved journal draft after reload',()=>{
 verified();f.pendingInput={category:'misc',amountVnd:12345,incurredAt:'2026-10-30T12:00:00+07:00',description:'UNCONFIRMED TEST',paymentStatus:'unpaid',paymentSource:null};mount();expect((screen.getByLabelText('Số tiền') as HTMLInputElement).value).toBe('12345');expect((screen.getByLabelText('Ngày') as HTMLInputElement).value).toBe('2026-10-30');expect(screen.getByText(/Có lần ghi chưa xác minh/)).toBeTruthy();
});

it('keeps embedded expenses in the selected club and clears the scope after membership loss', () => {
  f.clubs.push({id:'club-b',name:'LOCAL TEST B'});
  const view = render(<MemoryRouter><ClubExpenses embedded scopedClubId="club-b" /></MemoryRouter>);
  expect(f.read.mock.calls.at(-1)?.[1]).toBe('club-b');

  f.clubs = f.clubs.filter((club) => club.id !== 'club-b');
  view.rerender(<MemoryRouter><ClubExpenses embedded scopedClubId="club-b" /></MemoryRouter>);
  expect(f.read.mock.calls.at(-1)?.[1]).toBeNull();
  expect(screen.queryByRole('button', {name:'Ghi chi phí'})).toBeNull();
});
it.each([['100000',100000],['100.000',100000],['1.000.000',1000000],['-100.000',-100000]])('submits Vietnamese VND %s accurately',async(input,expected)=>{
 verified();f.write.mockResolvedValue({status:'ok'});mount();draft();
 fireEvent.change(screen.getByLabelText('Số tiền'),{target:{value:input}});
 await act(async()=>fireEvent.submit(screen.getByLabelText('Số tiền').closest('form')!));
 expect(f.write.mock.calls[0]?.[0].amountVnd).toBe(expected);
});
it.each(['1e5','10.00','1.5','9007199254740992'])('rejects ambiguous VND %s',async(input)=>{
 verified();mount();draft();fireEvent.change(screen.getByLabelText('Số tiền'),{target:{value:input}});
 await act(async()=>fireEvent.submit(screen.getByLabelText('Số tiền').closest('form')!));
 expect(f.write).not.toHaveBeenCalled();
});
