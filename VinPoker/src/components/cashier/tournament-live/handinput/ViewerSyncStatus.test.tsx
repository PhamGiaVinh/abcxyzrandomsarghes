import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {ViewerSyncStatus} from './ViewerSyncStatus';
afterEach(cleanup);
describe('operator sync rejection status',()=>{
 it('keeps an authoritative denial readable after transient toast disappears',()=>{
  render(<ViewerSyncStatus phase="error" lastLabel="Số chip vượt quá stack còn lại trên server. Hãy tải lại hand trước khi nhập lại."/>);
  expect(screen.getByRole('alert')).toHaveTextContent('Hãy tải lại hand trước khi nhập lại.');
 });
 it('keeps a fallback when no specific failure was supplied',()=>{
  render(<ViewerSyncStatus phase="error" lastLabel={null}/>);
  expect(screen.getByRole('alert')).toHaveTextContent('Lỗi gửi');
 });
 it('moves keyboard focus from the submit control to a newly visible error',()=>{
  const view=render(<><button>Submit TEST</button><ViewerSyncStatus phase="idle" lastLabel={null}/></>);
  screen.getByRole('button').focus();
  view.rerender(<><button>Submit TEST</button><ViewerSyncStatus phase="error" lastLabel="Tải lại bàn trước khi gửi."/></>);
  expect(screen.getByRole('alert')).toHaveFocus();
 });
 it('does not steal focus on a normal sending or successful state',()=>{
  const view=render(<><button>Action TEST</button><ViewerSyncStatus phase="sending" lastLabel={null}/></>);
  screen.getByRole('button').focus();view.rerender(<><button>Action TEST</button><ViewerSyncStatus phase="sent" lastLabel="Đã lưu"/></>);
  expect(screen.getByRole('button')).toHaveFocus();
 });
 it('focuses an uncertain result that blocks further actions',()=>{
  render(<ViewerSyncStatus phase="uncertain" lastLabel={null}/>);expect(screen.getByRole('alert')).toHaveFocus();
 });
 it('keeps the missing blind instructions and lets the dealer reload the table', () => {
  const reload = vi.fn();
  const reason = 'Floor cần lưu cấu trúc blind và chọn level đang chơi.';
  render(<ViewerSyncStatus phase="uncertain" lastLabel={reason} onReload={reload} />);
  expect(screen.getByRole('alert')).toHaveTextContent(reason);
  fireEvent.click(screen.getByRole('button', {name: 'Tải lại'}));
  expect(reload).toHaveBeenCalledTimes(1);
 });
 it('does not repeatedly steal focus when an unchanged error rerenders',()=>{
  const content=<><button>Inspect TEST</button><ViewerSyncStatus phase="error" lastLabel="Giữ nguyên request ID."/></>;
  const view=render(content);screen.getByRole('button').focus();view.rerender(<><button>Inspect TEST</button><ViewerSyncStatus phase="error" lastLabel="Giữ nguyên request ID."/></>);
  expect(screen.getByRole('button')).toHaveFocus();
 });
});
