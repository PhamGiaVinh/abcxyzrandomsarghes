import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {OverviewTab,type LiveOverviewData} from '../tabs/OverviewTab';
import {PayrollCostTab,type LivePayrollData} from '../tabs/PayrollCostTab';
import {MOCK_OVERVIEW} from '../mock/mockData';
import {formatVND} from '@/lib/format';

afterEach(cleanup);
const overview:LiveOverviewData={periodLabel:'Kỳ TEST',retainedRevenue:12345001,directCosts:4567002,contribution:-334003};
const payroll:LivePayrollData={periodLabel:'Kỳ TEST',payrollNet:4567002,payrollGross:5000003,adjustments:-4321,unpaidTotal:700004,reconciledTotal:0,perPeriod:[]};
const sample={...MOCK_OVERVIEW,retainedRevenue:987654321,directCosts:876543210,contribution:765432109};
const sampleLine={category:'dealer' as const,label:'Lương mẫu riêng',amount:654321098,state:'provisional' as const};

it('describes the live source including PT and recorded costs without changing values',()=>{
 const {container}=render(<OverviewTab onNavigate={()=>{}} live={{active:true,loading:false,error:null,data:overview}}/>);
 expect(screen.getByText('Chi phí lương (đã lưu, gồm PT)')).toBeInTheDocument();
 expect(screen.getByText('Biên đóng góp theo báo cáo tài chính')).toBeInTheDocument();
 expect(container.textContent).toContain('COGS F&B');
 expect(container.textContent).not.toMatch(/chưa (?:có|gồm) (?:trong số này.*)?lương PT|Lương PT chưa có|chờ #656 R2/i);
 for(const value of [overview.retainedRevenue,overview.directCosts,overview.contribution])expect(container.textContent).toContain(formatVND(value));
});

it.each([
 {loading:true,error:null,data:null},
 {loading:false,error:'503',data:null},
 {loading:false,error:null,data:null},
 {loading:false,error:'503',data:overview},
 {loading:true,error:null,data:overview},
])('never substitutes mock or stale overview amounts for an unverified live read %j',state=>{
 const {container}=render(<OverviewTab onNavigate={()=>{}} data={sample} live={{active:true,...state}}/>);
 for(const value of [sample.retainedRevenue,sample.directCosts,sample.contribution,...Object.values(overview).filter((value):value is number=>typeof value==='number')])expect(container.textContent).not.toContain(formatVND(value));
 expect(container.textContent).toMatch(/Đang tải|Chưa xác minh|Không tải được/);
 expect(container.textContent).not.toContain('đang là SỐ THẬT');
});

it.each([
 {loading:true,error:null,data:null},
 {loading:false,error:'503',data:null},
 {loading:false,error:null,data:null},
 {loading:false,error:'503',data:payroll},
 {loading:true,error:null,data:payroll},
])('never substitutes role mock or stale payroll amounts for an unverified live read %j',state=>{
 const {container}=render(<PayrollCostTab lines={[sampleLine]} live={{active:true,...state}}/>);
 for(const value of [sampleLine.amount,payroll.payrollNet,payroll.payrollGross,payroll.unpaidTotal])expect(container.textContent).not.toContain(formatVND(value));
 expect(container.textContent).toMatch(/Đang tải|Chưa xác minh|Không tải được/);
 expect(screen.queryByText('Lương mẫu riêng')).not.toBeInTheDocument();
 expect(container.textContent).not.toContain('Tổng lương là SỐ THẬT');
});

it('retains explicit mock mode instead of deleting demonstration data',()=>{
 const {container}=render(<OverviewTab onNavigate={()=>{}} data={sample}/>);
 expect(container.textContent).toContain(formatVND(sample.retainedRevenue));
});
