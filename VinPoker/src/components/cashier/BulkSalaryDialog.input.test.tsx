import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import type {DealerRecord} from '@/hooks/useDealerManagement';
import {BulkSalaryDialog} from './BulkSalaryDialog';

const mock = vi.hoisted(() => ({update:vi.fn(), in:vi.fn()}));
vi.mock('@/integrations/supabase/client', () => ({supabase:{from:()=>({update:mock.update})}}));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const dealers = [
  {id:'pt',club_id:'club',full_name:'TEST PT',employment_type:'part_time'},
  {id:'ft',club_id:'club',full_name:'TEST FT',employment_type:'full_time',standard_hours_per_shift:8},
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

it('writes whole VND amounts for PT and FT using either supported format', async () => {
  mock.update.mockReturnValue({in:mock.in});
  mock.in.mockResolvedValue({error:null});
  render(<BulkSalaryDialog dealers={dealers} onDone={vi.fn()} />);
  fireEvent.click(screen.getByRole('button',{name:'Áp lương hàng loạt'}));
  fireEvent.click(screen.getByRole('button',{name:'Chọn tất cả đang hiển thị'}));
  fireEvent.change(screen.getByLabelText('Lương giờ cho PT'),{target:{value:'100000'}});
  fireEvent.change(screen.getByLabelText('Lương tháng cho FT'),{target:{value:'100.000'}});
  fireEvent.click(screen.getByRole('button',{name:'Áp lương cho 2 dealer'}));
  fireEvent.click(screen.getByRole('button',{name:'Áp lương',exact:true}));
  await vi.waitFor(() => expect(mock.update).toHaveBeenNthCalledWith(2,{monthly_salary_vnd:100000,base_rate_vnd:3846,hourly_rate_vnd:481}));
  expect(mock.update).toHaveBeenNthCalledWith(1,{hourly_rate_vnd:100000,monthly_salary_vnd:0});
});
