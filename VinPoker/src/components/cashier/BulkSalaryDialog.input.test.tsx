import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import type {DealerRecord} from '@/hooks/useDealerManagement';
import {BulkSalaryDialog} from './BulkSalaryDialog';

const mock = vi.hoisted(() => ({update:vi.fn(), read:vi.fn(), written:vi.fn()}));
vi.mock('@/integrations/supabase/client', () => ({supabase:{from:()=>({update:mock.update,select:mock.read})}}));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const missingRates = {monthly_salary_vnd:null,base_rate_vnd:null,hourly_rate_vnd:null,standard_hours_per_shift:null};
const dealers = [
  {...missingRates,id:'pt',club_id:'club',full_name:'TEST PT',employment_type:'part_time'},
  {...missingRates,id:'ft',club_id:'club',full_name:'TEST FT',employment_type:'full_time',standard_hours_per_shift:8},
] as DealerRecord[];

it.each(['-100000','1e3','100,000','100.00','2147483648'])('blocks an invalid PT amount even when FT is valid', (value) => {
  render(<BulkSalaryDialog dealers={dealers} onDone={vi.fn()} />);
  fireEvent.click(screen.getByRole('button',{name:'Áp lương hàng loạt'}));
  fireEvent.click(screen.getByRole('button',{name:'Chọn tất cả đang hiển thị'}));
  fireEvent.change(screen.getByLabelText('Lương giờ cho PT'),{target:{value}});
  fireEvent.change(screen.getByLabelText('Lương tháng cho FT'),{target:{value:'2.600.000'}});
  expect(screen.getByRole('button',{name:/Áp lương cho/})).toBeDisabled();
  expect(mock.update).not.toHaveBeenCalled();
});

it.each(['write rejected', 'response lost after commit'])('retries only FT after %s', async (failure) => {
  const readQuery = {eq:vi.fn().mockReturnThis(),maybeSingle:vi.fn()
    .mockResolvedValueOnce({data:dealers[0],error:null})
    .mockResolvedValueOnce({data:dealers[1],error:null})};
  mock.read.mockReturnValue(readQuery);
  const query = {eq:vi.fn().mockReturnThis(),is:vi.fn().mockReturnThis(),select:vi.fn().mockReturnThis(),maybeSingle:mock.written};
  mock.update.mockReturnValue(query);
  mock.written
    .mockResolvedValueOnce({data:{hourly_rate_vnd:100000,monthly_salary_vnd:0},error:null})
    .mockResolvedValueOnce({data:null,error:{message:'TEST FT write error'}});
  render(<BulkSalaryDialog dealers={dealers} onDone={vi.fn()} />);
  fireEvent.click(screen.getByRole('button',{name:'Áp lương hàng loạt'}));
  fireEvent.click(screen.getByRole('button',{name:'Chọn tất cả đang hiển thị'}));
  fireEvent.change(screen.getByLabelText('Lương giờ cho PT'),{target:{value:'100000'}});
  fireEvent.change(screen.getByLabelText('Lương tháng cho FT'),{target:{value:'100.000'}});
  fireEvent.click(screen.getByRole('button',{name:'Áp lương cho 2 dealer'}));
  fireEvent.click(screen.getByRole('button',{name:'Áp lương',exact:true}));
  await vi.waitFor(() => expect(mock.update).toHaveBeenNthCalledWith(2,{monthly_salary_vnd:100000,base_rate_vnd:3846,hourly_rate_vnd:481}));
  expect(mock.update).toHaveBeenNthCalledWith(1,{hourly_rate_vnd:100000,monthly_salary_vnd:0});
  expect(await screen.findByText('Đã xác minh: TEST PT.')).toBeInTheDocument();
  expect(screen.getByText('Chưa xác minh: TEST FT.')).toBeInTheDocument();

  const ftRates = {monthly_salary_vnd:100000,base_rate_vnd:3846,hourly_rate_vnd:481};
  const alreadyCommitted = failure === 'response lost after commit';
  readQuery.maybeSingle.mockResolvedValueOnce({
    data: alreadyCommitted ? {...dealers[1], ...ftRates} : dealers[1], error:null,
  });
  if (!alreadyCommitted) mock.written.mockResolvedValueOnce({data:ftRates,error:null});
  fireEvent.click(screen.getByRole('button',{name:'Áp lương cho 1 dealer'}));
  fireEvent.click(screen.getByRole('button',{name:'Áp lương',exact:true}));
  expect(await screen.findByText('Đã xác minh: TEST FT.')).toBeInTheDocument();
  expect(readQuery.eq).toHaveBeenNthCalledWith(6, 'id', 'ft');
  expect(mock.update).toHaveBeenCalledTimes(alreadyCommitted ? 2 : 3);
  if (!alreadyCommitted) expect(mock.update).toHaveBeenNthCalledWith(3, ftRates);
});
