import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({read:vi.fn(),export:vi.fn(),loading:false,admin:false,summary:null as any}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({isAdmin:f.admin,isClubAdmin:false,isClubOwner:true})}));
vi.mock('@/hooks/useClubFinanceSummary',()=>({useClubFinanceSummary:(q:unknown)=>{f.read(q);return{loading:f.loading,error:null,clubs:[],summary:f.summary,reload:vi.fn()};}}));
vi.mock('@/lib/exportExcel',()=>({exportToExcel:(...args:unknown[])=>f.export(...args)}));
vi.mock('recharts',()=>({ResponsiveContainer:()=>null,AreaChart:()=>null,Area:()=>null,XAxis:()=>null,YAxis:()=>null,CartesianGrid:()=>null,Tooltip:()=>null,PieChart:()=>null,Pie:()=>null,Cell:()=>null,BarChart:()=>null,Bar:()=>null}));
import ClubFinanceDashboard from './ClubFinanceDashboard';
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-31T17:30:00Z'));f.read.mockReset();f.export.mockReset();f.summary=null;f.loading=false;f.admin=false;});
afterEach(()=>{cleanup();vi.useRealTimers();});
const mount=()=>render(<MemoryRouter><ClubFinanceDashboard/></MemoryRouter>);
it.each([0,-500])('does not label an undefined margin as zero when revenue is %s',revenue=>{
 f.summary={fnbAvailable:true,revenue:{total:revenue,stakingFees:0,payoutFees:0,rake:revenue,serviceFee:0,fnb:0},
 cost:{payrollNet:100000,fnbCogs:0,compCogs:0},net:revenue-100000,statusTotals:{},unpaidTotal:0,reconciledTotal:0,
 aging:{d0_30:0,d31_60:0,d61_90:0,d90p:0},trend:[],perClub:[],perPeriod:[]};
 mount();expect(screen.queryByText(/biên 0%/)).toBeNull();
 expect(screen.getByText(/Chưa xác định biên/)).toBeTruthy();
});
it('opens a thirty-day inclusive report ending on the Vietnam business date',()=>{
 mount();expect(f.read).toHaveBeenLastCalledWith({from:'2026-10-03',to:'2026-11-01',clubFilter:'all'});
});
it('selects current month from the first Vietnam calendar day rather than the browser month',()=>{
 mount();fireEvent.click(screen.getByRole('button',{name:'Tháng này'}));
 expect(f.read).toHaveBeenLastCalledWith({from:'2026-11-01',to:'2026-11-01',clubFilter:'all'});
});
it('selects exactly seven inclusive calendar dates',()=>{
 mount();fireEvent.click(screen.getByRole('button',{name:'7 ngày'}));
 expect(f.read).toHaveBeenLastCalledWith({from:'2026-10-26',to:'2026-11-01',clubFilter:'all'});
});
it.each([['2026-12-31T17:30:00Z','2027-01-01'],['2028-02-29T17:30:00Z','2028-03-01']])('selects the Vietnam month across year/leap boundaries %s',(instant,day)=>{
 vi.setSystemTime(new Date(instant));mount();fireEvent.click(screen.getByRole('button',{name:'Tháng này'}));
 expect(f.read).toHaveBeenLastCalledWith({from:day,to:day,clubFilter:'all'});
});
it('does not export unverified data',()=>{
 mount();expect((screen.getByRole('button',{name:'Xuất Excel'}) as HTMLButtonElement).disabled).toBe(true);expect(f.export).not.toHaveBeenCalled();
});
it('exports recorded total costs and dealer net entitlement with accurate headers',()=>{
 f.admin=true;
 f.summary={revenue:{total:200000,stakingFees:0,payoutFees:0,rake:200000,serviceFee:0,fnb:0},cost:{payrollNet:100000,fnbCogs:0,compCogs:0},net:50000,
 statusTotals:{},unpaidTotal:100000,reconciledTotal:0,aging:{d0_30:100000,d31_60:0,d61_90:0,d90p:0},trend:[],
 perClub:[{clubId:'club',name:'TEST',revenue:200000,cost:150000,net:50000}],perPeriod:[{id:'period',clubId:'club',clubName:'TEST',periodKey:'11/2026',gross:100000,net:100000,status:'locked'}]};
 const view=mount();fireEvent.click(screen.getByRole('button',{name:'Xuất Excel'}));
 expect(f.export).toHaveBeenCalledTimes(2);const [rows,columns]=f.export.mock.calls[0];
 expect(columns.map((c:any)=>c.header)).toContain('CHI PHÍ ĐÃ GHI NHẬN (₫)');
 expect(columns.map((c:any)=>c.header)).toContain('CÒN LẠI SAU CHI PHÍ (₫)');
 expect(columns.find((c:any)=>c.header==='CHI PHÍ ĐÃ GHI NHẬN (₫)').get(rows[0])).toBe(150000);
 expect(f.export.mock.calls[1][1].map((c:any)=>c.header)).toContain('LƯƠNG NET (₫)');
 expect(within(screen.getByRole('row',{name:/TỔNG/})).getByText('150.000 ₫')).toBeTruthy();
 f.loading=true;view.rerender(<MemoryRouter><ClubFinanceDashboard/></MemoryRouter>);
 expect(screen.getByText('Còn lại sau chi phí')).toBeTruthy();expect((screen.getByRole('button',{name:'Xuất Excel'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Xuất Excel'}));expect(f.export).toHaveBeenCalledTimes(2);
});

it.each([0,-500])('shows verified F&B zero/refund movement %s and COMP costs without a UI flag',(fnb)=>{
 f.summary={fnbAvailable:true,revenue:{total:fnb,stakingFees:0,payoutFees:0,rake:0,serviceFee:0,fnb},cost:{payrollNet:0,fnbCogs:-100,compCogs:75},net:fnb+25,
 statusTotals:{},unpaidTotal:0,reconciledTotal:0,aging:{d0_30:0,d31_60:0,d61_90:0,d90p:0},trend:[],perClub:[],perPeriod:[]};
 mount();expect(screen.getByText('F&B (Đồ ăn / thức uống)')).toBeTruthy();expect(screen.getByText('Giá vốn COMP (miễn phí)')).toBeTruthy();
 expect(screen.queryByText(/chưa tích hợp/)).toBeNull();expect(screen.queryByText(/F&B KHÔNG tính/)).toBeNull();
});

it.each([['default','2026-10-03'],['7 ngày','2026-10-26'],['Tháng này','2026-11-01']] as const)('advances the live %s preset after Vietnam midnight',async(preset,from)=>{
 vi.useRealTimers();vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-31T16:59:59Z'));
 const view=mount();try{
  if(preset!=='default')fireEvent.click(screen.getByRole('button',{name:preset}));
  await act(async()=>vi.advanceTimersByTimeAsync(5001));
  expect(f.read).toHaveBeenLastCalledWith({from,to:'2026-11-01',clubFilter:'all'});
 }finally{view.unmount();}
});
it('keeps an explicitly selected historical range unchanged after Vietnam midnight',async()=>{
 vi.useRealTimers();vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-31T16:59:59Z'));const view=mount();try{
  fireEvent.change(screen.getByLabelText('Từ ngày'),{target:{value:'2026-10-15'}});fireEvent.change(screen.getByLabelText('Đến ngày'),{target:{value:'2026-10-20'}});
  await act(async()=>vi.advanceTimersByTimeAsync(5001));expect(f.read).toHaveBeenLastCalledWith({from:'2026-10-15',to:'2026-10-20',clubFilter:'all'});
 }finally{view.unmount();}
});

const dealerSummary=()=>({revenue:{total:0,stakingFees:0,payoutFees:0,rake:0,serviceFee:0,fnb:0},cost:{payrollNet:100000,fnbCogs:0,compCogs:0},net:-100000,statusTotals:{},unpaidTotal:0,reconciledTotal:0,aging:{d0_30:0,d31_60:0,d61_90:0,d90p:0},trend:[],perClub:[],perPeriod:[]});
it('shows current dealer PT separately and exports a current balance file without adding it to booked costs',()=>{
 f.summary={...dealerSummary(),dealerLive:{scope:'current_outstanding',asOf:'2026-11-01T01:40:00Z',ptActiveUnfinalizedBalance:1207,ptFinalizedUnpaidBalance:2500,ptTotalUnpaid:3707}};
 mount();fireEvent.change(screen.getByLabelText('Từ ngày'),{target:{value:'2026-09-01'}});fireEvent.change(screen.getByLabelText('Đến ngày'),{target:{value:'2026-09-30'}});
 expect(screen.getByRole('heading',{name:'Lương dealer PT chưa trả · hiện tại'})).toBeTruthy();expect(screen.getByText('Lương ghi nhận chưa trả')).toBeTruthy();expect(screen.getByText('các kỳ trong báo cáo')).toBeTruthy();expect(screen.getByText('3.707 ₫')).toBeTruthy();expect(screen.getByText(/chi phí PT được ghi nhận khi trả/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Xuất Excel'}));expect(f.export).toHaveBeenCalledTimes(3);
 const [rows,columns,filename]=f.export.mock.calls[2];expect(filename).toBe('tai-chinh-clb-luong-dealer-pt-hien-tai');expect(columns.find((c:any)=>c.header==='TỔNG PT DEALER CHƯA TRẢ (₫)').get(rows[0])).toBe(3707);expect(columns.map((c:any)=>c.header)).not.toContain('CHI PHÍ ĐÃ GHI NHẬN (₫)');expect(f.summary.cost.payrollNet).toBe(100000);expect(f.summary.net).toBe(-100000);
});
it('marks missing dealer PT evidence unavailable and does not export a fabricated zero balance',()=>{
 f.summary=dealerSummary();mount();expect(screen.getByText('Chưa có dữ liệu lương dealer PT đã xác minh.')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Xuất Excel'}));expect(f.export).toHaveBeenCalledTimes(2);
});

it('labels FT as a current policy estimate and exports it separately from PT and booked P&L',()=>{
 f.summary={...dealerSummary(),dealerLive:{scope:'current_outstanding',asOf:'2026-11-01T01:40:00Z',ptActiveUnfinalizedBalance:1207,ptFinalizedUnpaidBalance:2500,ptTotalUnpaid:3707},dealerFtLive:{scope:'current_month_provisional',asOf:'2026-11-01T01:40:00Z',period:'2026-11',gross:461538,net:413077}};
 mount();expect(screen.getByRole('heading',{name:'Dealer FT dự tính · kỳ hiện tại chưa ghi nhận'})).toBeTruthy();expect(screen.getByText('413.077 ₫')).toBeTruthy();expect(screen.getByText(/Ca đang mở dự tính theo giờ chuẩn/)).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Xuất Excel'}));expect(f.export).toHaveBeenCalledTimes(4);
 const [rows,columns,filename]=f.export.mock.calls[3];expect(screen.getByText(/chỉ gồm dealer chưa được ghi nhận trong kỳ/)).toBeTruthy();expect(columns.find((c:any)=>c.header==='CƠ SỞ DỰ TÍNH').get(rows[0])).toContain('chỉ dealer chưa được ghi nhận trong kỳ');expect(filename).toBe('tai-chinh-clb-du-tinh-dealer-ft-hien-tai');expect(columns.find((c:any)=>c.header==='DEALER FT NET DỰ TÍNH (₫)').get(rows[0])).toBe(413077);expect(columns.find((c:any)=>c.header==='KỲ DỰ TÍNH').get(rows[0])).toBe('2026-11');expect(f.summary.cost.payrollNet).toBe(100000);expect(f.summary.net).toBe(-100000);
});
it('marks missing FT policy estimates unavailable rather than exporting a zero',()=>{f.summary=dealerSummary();mount();expect(screen.getByText('Chưa có dữ liệu dự tính dealer FT đã xác minh.')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Xuất Excel'}));expect(f.export).toHaveBeenCalledTimes(2);});
