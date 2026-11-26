import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import type {DealerRecord} from '@/hooks/useDealerManagement';
import {BulkSalaryDialog} from './BulkSalaryDialog';

const mock = vi.hoisted(() => ({
  update: vi.fn(), read: vi.fn(), rows: new Map<string, any>(), failures: new Map<string, string>(),
  writeIds: [] as string[], readIds: [] as string[], filters: [] as unknown[],
  onRead: null as null | ((id: string) => Promise<void>),
  onWrite: null as null | ((id: string) => Promise<void>),
}));
vi.mock('@/integrations/supabase/client', () => ({supabase:{from:()=>({update:mock.update, select:mock.read})}}));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const dealers = [
  {id:'pt',club_id:'club',full_name:'TEST PT',employment_type:'part_time',monthly_salary_vnd:null,base_rate_vnd:null,hourly_rate_vnd:null,standard_hours_per_shift:null},
  {id:'ft',club_id:'club',full_name:'TEST FT',employment_type:'full_time',monthly_salary_vnd:null,base_rate_vnd:null,hourly_rate_vnd:null,standard_hours_per_shift:8},
] as DealerRecord[];

function query(rates?: Record<string, number>) {
  const filters: Array<[string, unknown]> = [];
  const result = {
    eq: (key: string, value: unknown) => { filters.push([key, value]); return result; },
    is: (key: string, value: unknown) => { filters.push([key, value]); return result; },
    select: () => result,
    maybeSingle: async () => {
      const id = filters.find(([key]) => key === 'id')?.[1] as string;
      if (!rates) {
        mock.readIds.push(id);
        if (mock.onRead) await mock.onRead(id);
      } else {
        mock.writeIds.push(id);
        mock.filters.push([...filters]);
      }
      const row = mock.rows.get(id);
      if (!row || !filters.every(([key, value]) => row[key] === value)) return {data: null, error: null};
      if (!rates) return {data: {...row}, error: null};
      const failure = mock.failures.get(id);
      mock.failures.delete(id);
      if (failure === 'empty') return {data: null, error: null};
      if (failure === 'before') return {data: null, error: {message: 'TEST denied'}};
      if (failure === 'throw-before') throw new Error('TEST transport error');
      Object.assign(row, rates);
      if (mock.onWrite) await mock.onWrite(id);
      if (failure === 'throw-after') throw new Error('TEST lost response after commit');
      if (failure === 'after') return {data: null, error: {message: 'TEST lost response after commit'}};
      return {data: {...row, ...(failure === 'wrong-id' ? {id: 'wrong-id'} : {})}, error: null};
    },
  };
  return result;
}

beforeEach(() => {
  mock.rows = new Map(dealers.map(dealer => [dealer.id, {...dealer, deleted_at: null}]));
  mock.failures.clear(); mock.writeIds = []; mock.readIds = []; mock.filters = []; mock.onRead = null; mock.onWrite = null;
  mock.read.mockImplementation(() => query());
  mock.update.mockImplementation((rates) => query(rates));
});

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
  mock.rows.get('ft').standard_hours_per_shift = 0.5;
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
  render(<BulkSalaryDialog dealers={dealers} onDone={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', {name: 'Áp lương hàng loạt'}));
  fireEvent.click(screen.getByRole('button', {name: 'Chọn tất cả đang hiển thị'}));
  fireEvent.change(screen.getByLabelText('Lương tháng cho FT'), {target: {value: '2.600.000'}});
  fireEvent.click(screen.getByRole('button', {name: 'Áp lương cho 1 dealer'}));
  await act(async () => { fireEvent.click(screen.getByRole('button', {name: 'Áp lương'})); });
  await vi.waitFor(() => expect(mock.update).toHaveBeenCalledTimes(1));
  expect(mock.update).toHaveBeenCalledWith({monthly_salary_vnd: 2600000, base_rate_vnd: 100000, hourly_rate_vnd: 12500});
  expect(mock.writeIds).toEqual(['ft']);
});

it('writes whole VND amounts for PT and FT using either supported format', async () => {
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

function prepareBatch(rows = dealers) {
  const onDone = vi.fn();
  const view = render(<BulkSalaryDialog key="club" dealers={rows} onDone={onDone} />);
  fireEvent.click(screen.getByRole('button', {name: 'Áp lương hàng loạt'}));
  fireEvent.click(screen.getByRole('button', {name: 'Chọn tất cả đang hiển thị'}));
  fireEvent.change(screen.getByLabelText('Lương giờ cho PT'), {target: {value: '100000'}});
  fireEvent.change(screen.getByLabelText('Lương tháng cho FT'), {target: {value: '100.000'}});
  return {...view, onDone};
}

async function confirmBatch(count = 2) {
  fireEvent.click(screen.getByRole('button', {name: `Áp lương cho ${count} dealer`}));
  await act(async () => { fireEvent.click(screen.getByRole('button', {name: 'Áp lương'})); });
}

it.each(['before', 'after', 'throw-after'])('keeps only the unresolved FT selected and recovers %s without rewriting PT', async (failure) => {
  mock.failures.set('ft', failure);
  const {onDone} = prepareBatch();
  await confirmBatch();
  expect(screen.getByText('Đã xác minh: TEST PT.')).toBeInTheDocument();
  expect(screen.getByText('Chưa xác minh: TEST FT.')).toBeInTheDocument();
  expect(mock.writeIds).toEqual(['pt', 'ft']);
  expect(onDone).toHaveBeenCalledTimes(1);
  await confirmBatch(1);
  expect(screen.getByText('Đã xác minh: TEST FT.')).toBeInTheDocument();
  expect(mock.writeIds).toEqual(failure === 'before' ? ['pt', 'ft', 'ft'] : ['pt', 'ft']);
  expect(mock.readIds).toEqual(['pt', 'ft', 'ft']);
});

it.each([0, 1, 2])('reports exactly %s returned dealer rows as confirmed', async (count) => {
  if (count < 2) mock.failures.set('ft', 'empty');
  if (count === 0) mock.failures.set('pt', 'empty');
  prepareBatch();
  await confirmBatch();
  if (count === 1) expect(screen.getByText('Đã xác minh: TEST PT.')).toBeInTheDocument();
  if (count === 0) expect(screen.queryByText(/^Đã xác minh:/)).not.toBeInTheDocument();
  if (count === 2) expect(screen.getByText('Đã xác minh: TEST PT, TEST FT.')).toBeInTheDocument();
});

it('does not confirm a returned row with another identity', async () => {
  mock.failures.set('ft', 'wrong-id');
  prepareBatch();
  await confirmBatch();
  expect(screen.getByText('Đã xác minh: TEST PT.')).toBeInTheDocument();
  expect(screen.getByText('Chưa xác minh: TEST FT.')).toBeInTheDocument();
});

it('does not update a dealer soft-deleted after selection', async () => {
  prepareBatch();
  mock.rows.get('ft').deleted_at = '2026-11-26T00:00:00Z';
  await confirmBatch();
  expect(mock.writeIds).toEqual(['pt']);
  expect(mock.rows.get('ft').monthly_salary_vnd).toBeNull();
  expect(screen.getByText('Chưa xác minh: TEST FT.')).toBeInTheDocument();
});

it('preserves another operator salary edit across parent refresh and retry', async () => {
  mock.failures.set('ft', 'empty');
  const view = prepareBatch();
  await confirmBatch();
  Object.assign(mock.rows.get('ft'), {monthly_salary_vnd: 200000, base_rate_vnd: 7692, hourly_rate_vnd: 962});
  view.rerender(<BulkSalaryDialog key="club" dealers={[...mock.rows.values()]} onDone={view.onDone} />);
  await confirmBatch(1);
  expect(mock.writeIds).toEqual(['pt', 'ft']);
  expect(mock.rows.get('ft').monthly_salary_vnd).toBe(200000);
  expect(screen.getByText('Chưa xác minh: TEST FT.')).toBeInTheDocument();
});

it('allows an explicitly changed FT amount to use the refreshed visible rate as its new comparison', async () => {
  mock.failures.set('ft', 'empty');
  const view = prepareBatch();
  await confirmBatch();
  Object.assign(mock.rows.get('ft'), {monthly_salary_vnd: 200000, base_rate_vnd: 7692, hourly_rate_vnd: 962});
  view.rerender(<BulkSalaryDialog key="club" dealers={[...mock.rows.values()]} onDone={view.onDone} />);
  fireEvent.change(screen.getByLabelText('Lương tháng cho FT'), {target: {value: '250000'}});
  await confirmBatch(1);
  expect(mock.rows.get('ft').monthly_salary_vnd).toBe(250000);
  expect(screen.getByText('Đã xác minh: TEST FT.')).toBeInTheDocument();
});

it('does not renew the unresolved FT comparison when only the PT input changes', async () => {
  mock.failures.set('ft', 'empty');
  const view = prepareBatch();
  await confirmBatch();
  Object.assign(mock.rows.get('ft'), {monthly_salary_vnd: 200000, base_rate_vnd: 7692, hourly_rate_vnd: 962});
  view.rerender(<BulkSalaryDialog key="club" dealers={[...mock.rows.values()]} onDone={view.onDone} />);
  fireEvent.change(screen.getByLabelText('Lương giờ cho PT'), {target: {value: '200000'}});
  await confirmBatch(1);
  expect(mock.writeIds).toEqual(['pt', 'ft']);
  expect(mock.rows.get('ft').monthly_salary_vnd).toBe(200000);
});

it('clears old result names when the dialog is closed and reopened', async () => {
  prepareBatch();
  await confirmBatch();
  expect(screen.getByText('Đã xác minh: TEST PT, TEST FT.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', {name: 'Đóng'}));
  fireEvent.click(screen.getByRole('button', {name: 'Áp lương hàng loạt'}));
  expect(screen.queryByText(/^Đã xác minh:/)).not.toBeInTheDocument();
});

it('stops the old club batch before writing when that session is unmounted', async () => {
  let release!: () => void;
  mock.onRead = async () => { await new Promise<void>(resolve => { release = resolve; }); };
  const view = prepareBatch();
  fireEvent.click(screen.getByRole('button', {name: 'Áp lương cho 2 dealer'}));
  fireEvent.click(screen.getByRole('button', {name: 'Áp lương'}));
  await vi.waitFor(() => expect(mock.readIds).toEqual(['pt']));
  view.rerender(<BulkSalaryDialog key="other-club" dealers={[]} onDone={vi.fn()} />);
  mock.onRead = null;
  await act(async () => { release(); });
  expect(mock.update).not.toHaveBeenCalled();
  expect(view.onDone).not.toHaveBeenCalled();
});

it('marks a hung dealer read unknown after the existing 15-second deadline and ignores its late result', async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  mock.onRead = async id => { if (id === 'pt') await gate; };
  try {
    prepareBatch();
    fireEvent.click(screen.getByRole('button', {name: 'Áp lương cho 2 dealer'}));
    fireEvent.click(screen.getByRole('button', {name: 'Áp lương'}));
    await act(async () => { await vi.advanceTimersByTimeAsync(15001); });
    expect(screen.getByText('Chưa xác minh: TEST PT.')).toBeInTheDocument();
    expect(screen.getByText('Đã xác minh: TEST FT.')).toBeInTheDocument();
    await act(async () => { release(); });
    expect(mock.writeIds).toEqual(['ft']);
    expect(screen.getByRole('button', {name: 'Áp lương cho 1 dealer'})).toBeEnabled();
  } finally { release(); vi.useRealTimers(); }
});

it('recovers a committed write whose response never settles without another update', async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  mock.onWrite = async id => { if (id === 'pt') await gate; };
  try {
    prepareBatch();
    fireEvent.click(screen.getByRole('button', {name: 'Áp lương cho 2 dealer'}));
    fireEvent.click(screen.getByRole('button', {name: 'Áp lương'}));
    await act(async () => { await vi.advanceTimersByTimeAsync(15001); });
    expect(screen.getByText('Chưa xác minh: TEST PT.')).toBeInTheDocument();
    expect(screen.getByText('Đã xác minh: TEST FT.')).toBeInTheDocument();
    await confirmBatch(1);
    expect(screen.getByText('Đã xác minh: TEST PT.')).toBeInTheDocument();
    await act(async () => { release(); });
    expect(mock.writeIds).toEqual(['pt', 'ft']);
    expect(screen.getByText('Đã xác minh: TEST PT.')).toBeInTheDocument();
  } finally { release(); vi.useRealTimers(); }
});
