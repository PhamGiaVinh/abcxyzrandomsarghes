import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
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

it.each(['-2600000', '1e3', 'lương 2600000', '2.60.000', '2,600,000', '0', '55834574823', '9007199254740993'])('blocks an invalid FT amount even when PT is valid: %s', (value) => {
  render(<BulkSalaryDialog dealers={dealers} onDone={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', {name: 'Áp lương hàng loạt'}));
  fireEvent.click(screen.getByRole('button', {name: 'Chọn tất cả đang hiển thị'}));
  fireEvent.change(screen.getByLabelText('Lương giờ cho PT'), {target: {value: '100000'}});
  const input = screen.getByLabelText('Lương tháng cho FT');
  fireEvent.change(input, {target: {value}});
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('button', {name: /Áp lương cho/})).toBeDisabled();
  expect(mock.update).not.toHaveBeenCalled();
});

it('connects each invalid field to its explanation and clears the error after correction', () => {
  render(<BulkSalaryDialog dealers={dealers} onDone={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', {name: 'Áp lương hàng loạt'}));
  fireEvent.click(screen.getByRole('button', {name: 'Chọn tất cả đang hiển thị'}));
  for (const label of ['Lương giờ cho PT', 'Lương tháng cho FT']) {
    const input = screen.getByLabelText(label);
    fireEvent.change(input, {target: {value: '-100000'}});
    expect(input).toHaveAccessibleDescription('Nhập số VND nguyên dương trong giới hạn.');
    fireEvent.change(input, {target: {value: '100.000'}});
    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(input).not.toHaveAccessibleDescription('Nhập số VND nguyên dương trong giới hạn.');
  }
  expect(screen.getByRole('button', {name: /Áp lương cho/})).toBeEnabled();
});

it('blocks the whole selection when a half-hour FT shift would overflow the derived hourly rate', () => {
  const halfHourDealers = dealers.map(dealer => ({...dealer, standard_hours_per_shift: 0.5}));
  render(<BulkSalaryDialog dealers={halfHourDealers} onDone={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', {name: 'Áp lương hàng loạt'}));
  fireEvent.click(screen.getByRole('button', {name: 'Chọn tất cả đang hiển thị'}));
  fireEvent.change(screen.getByLabelText('Lương giờ cho PT'), {target: {value: '100000'}});
  fireEvent.change(screen.getByLabelText('Lương tháng cho FT'), {target: {value: '55.834.574.822'}});
  expect(screen.getByRole('button', {name: /Áp lương cho/})).toBeDisabled();
  expect(screen.getByLabelText('Lương tháng cho FT')).toHaveAttribute('aria-invalid', 'true');
  expect(mock.update).not.toHaveBeenCalled();
});

it('preserves the existing FT rounding at the valid half-hour integer boundary', async () => {
  mock.update.mockReturnValue({in: mock.in});
  mock.in.mockResolvedValue({error: null});
  const halfHourDealers = dealers.map(dealer => ({...dealer, standard_hours_per_shift: 0.5}));
  render(<BulkSalaryDialog dealers={halfHourDealers} onDone={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', {name: 'Áp lương hàng loạt'}));
  fireEvent.click(screen.getByRole('button', {name: 'Chọn tất cả đang hiển thị'}));
  fireEvent.change(screen.getByLabelText('Lương tháng cho FT'), {target: {value: '27.917.287.417'}});
  fireEvent.click(screen.getByRole('button', {name: 'Áp lương cho 1 dealer'}));
  await act(async () => { fireEvent.click(screen.getByRole('button', {name: 'Áp lương'})); });
  expect(mock.update).toHaveBeenCalledWith({monthly_salary_vnd: 27917287417, base_rate_vnd: 1073741824, hourly_rate_vnd: 2147483647});
});

it('leaves a blank selected group unchanged while applying the other valid group', async () => {
  mock.update.mockReturnValue({in: mock.in});
  mock.in.mockResolvedValue({error: null});
  render(<BulkSalaryDialog dealers={dealers} onDone={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', {name: 'Áp lương hàng loạt'}));
  fireEvent.click(screen.getByRole('button', {name: 'Chọn tất cả đang hiển thị'}));
  fireEvent.change(screen.getByLabelText('Lương tháng cho FT'), {target: {value: '2.600.000'}});
  fireEvent.click(screen.getByRole('button', {name: 'Áp lương cho 1 dealer'}));
  await act(async () => { fireEvent.click(screen.getByRole('button', {name: 'Áp lương'})); });
  await vi.waitFor(() => expect(mock.update).toHaveBeenCalledTimes(1));
  expect(mock.update).toHaveBeenCalledWith({monthly_salary_vnd: 2600000, base_rate_vnd: 100000, hourly_rate_vnd: 12500});
  expect(mock.in).toHaveBeenCalledWith('id', ['ft']);
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
  await act(async () => { fireEvent.click(screen.getByRole('button',{name:'Áp lương'})); });
  await vi.waitFor(() => expect(mock.update).toHaveBeenNthCalledWith(2,{monthly_salary_vnd:100000,base_rate_vnd:3846,hourly_rate_vnd:481}));
  expect(mock.update).toHaveBeenNthCalledWith(1,{hourly_rate_vnd:100000,monthly_salary_vnd:0});
});
