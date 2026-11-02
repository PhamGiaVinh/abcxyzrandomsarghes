import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {FinanceWorkspaceView} from './FinanceWorkspaceView';

afterEach(cleanup);
describe('finance timestamp range business-calendar presentation',()=>{
 it.each([
  ['2026-09-30T17:00:00.000Z','2026-09-30T17:30:00.123Z','1/10/2026–1/10/2026'],
  ['2026-12-31T17:00:00.000Z','2026-12-31T17:30:00.123Z','1/1/2027–1/1/2027'],
 ])('labels %s in UTC+7, not the browser calendar',(from,to,label)=>{
  render(<FinanceWorkspaceView clubName="TEST scope" range={{from,to}} summary={null} loading={false} blockedReason="TEST_UNAVAILABLE" onRefresh={vi.fn()}/>);
  expect(screen.getByText(`TEST scope · ${label} · Tạm tính`)).toBeTruthy();
  expect(screen.queryByText('0 ₫')).toBeNull();
 });
});

it('labels PT paid as a subset of the server payroll total',()=>{
 render(<FinanceWorkspaceView clubName="TEST" range={{from:'2026-10-01T00:00:00+07:00',to:'2026-10-31T00:00:00+07:00'}}
  summary={{revenue:{total:0,rake:0,serviceFee:0,stakingFees:0,payoutFees:0,fnb:0},cost:{payrollNet:3379,ptWagePaid:3379,fnbCogs:0,compCogs:0,clubExpenses:0},net:-3379}}
  loading={false} blockedReason={null} onRefresh={vi.fn()}/>);
 expect(screen.getByText('Lương net (gồm PT đã trả)')).toBeInTheDocument();
 expect(screen.getByText('Trong đó: PT đã trả')).toBeInTheDocument();
 expect(screen.getByText('Chưa xác minh được tổng hợp lương nhân viên ngoài dealer từ backend hiện tại.')).toBeInTheDocument();
});

it('labels current staff balances separately from booked costs and the selected report period',()=>{
 render(<FinanceWorkspaceView clubName="TEST" range={{from:'2026-09-01T00:00:00+07:00',to:'2026-09-30T23:59:59+07:00'}}
  summary={{revenue:{total:0,rake:0,serviceFee:0,stakingFees:0,payoutFees:0,fnb:0},cost:{payrollNet:100000,ptWagePaid:0,fnbCogs:0,compCogs:0,clubExpenses:0},net:-100000,
   staffLive:{scope:'current_outstanding',asOf:'2026-10-31T11:00:00Z',ftPeriod:'2026-10',ftProvisionalGross:200000,ftProvisionalNet:180000,ptUnpaidBalance:11152}}}
  loading={false} blockedReason={null} onRefresh={vi.fn()}/>);
 expect(screen.getByText('FT net tạm tính')).toBeInTheDocument();expect(screen.getByText('PT chưa trả')).toBeInTheDocument();
 expect(screen.getByText(/Các khoản này chưa cộng vào chi phí đã ghi nhận/)).toBeInTheDocument();
 expect(screen.queryByText(/Chưa xác minh được tổng hợp lương/)).toBeNull();
});

it('keeps current dealer PT debt outside the selected period booked payroll',()=>{
 render(<FinanceWorkspaceView clubName="TEST" range={{from:'2026-09-01T00:00:00+07:00',to:'2026-09-30T23:59:59+07:00'}} summary={{revenue:{total:0,rake:0,serviceFee:0,stakingFees:0,payoutFees:0,fnb:0},cost:{payrollNet:100000,ptWagePaid:0,fnbCogs:0,compCogs:0,clubExpenses:0},net:-100000,dealerLive:{scope:'current_outstanding',asOf:'2026-11-01T01:40:00Z',ptActiveUnfinalizedBalance:1207,ptFinalizedUnpaidBalance:2500,ptTotalUnpaid:3707}}} loading={false} blockedReason={null} onRefresh={vi.fn()}/>);
 expect(screen.getByText('Lương dealer PT chưa trả · hiện tại')).toBeInTheDocument();expect(screen.getByText('3.707 ₫')).toBeInTheDocument();expect(screen.getByText(/chi phí PT được ghi nhận khi trả/)).toBeInTheDocument();expect(screen.queryByText('Chưa có dữ liệu lương dealer PT đã xác minh.')).toBeNull();
});

it('labels the current FT policy estimate independently from a historical P&L range',()=>{
 render(<FinanceWorkspaceView clubName="TEST" range={{from:'2026-09-01T00:00:00+07:00',to:'2026-09-30T23:59:59+07:00'}} summary={{revenue:{total:0,rake:0,serviceFee:0,stakingFees:0,payoutFees:0,fnb:0},cost:{payrollNet:100000,ptWagePaid:0,fnbCogs:0,compCogs:0,clubExpenses:0},net:-100000,dealerFtLive:{scope:'current_month_provisional',asOf:'2026-11-01T01:40:00Z',period:'2026-11',gross:461538,net:-100}}} loading={false} blockedReason={null} onRefresh={vi.fn()}/>);
 expect(screen.getByText('Dealer FT dự tính · kỳ hiện tại chưa ghi nhận')).toBeInTheDocument();expect(screen.getByText('-100 ₫')).toBeInTheDocument();expect(screen.getByText(/chỉ gồm dealer chưa được ghi nhận trong kỳ/)).toBeInTheDocument();expect(screen.getByText(/Ca đang mở dự tính theo giờ chuẩn/)).toBeInTheDocument();expect(screen.queryByText('Chưa có dữ liệu dự tính dealer FT đã xác minh.')).toBeNull();
});
