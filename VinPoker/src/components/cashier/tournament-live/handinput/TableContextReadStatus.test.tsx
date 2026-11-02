import {fireEvent,render,screen} from '@testing-library/react';
import {describe,expect,it,vi} from 'vitest';
import {TableContextReadStatus} from './TableContextReadStatus';

describe('selected Tracker table read status',()=>{
  it('shows the verified authority rejection explanation instead of a generic fetch error',()=>{
    render(<TableContextReadStatus state="error" message="Quyền hoặc phiên/chế độ bàn đã thay đổi. Quay lại danh sách bàn để xác minh lại." onBack={vi.fn()} onRetry={vi.fn()}/>);
    expect(screen.getByRole('alert')).toHaveTextContent('Quyền hoặc phiên/chế độ bàn đã thay đổi');
    expect(screen.queryByText('Chưa xác minh được người chơi hoặc trạng thái hand. Không thao tác trên dữ liệu chưa tải được.')).toBeNull();
    expect(screen.getByRole('button',{name:'Quay lại danh sách bàn'})).toBeEnabled();
  });
  it('shows loading rather than empty seats or mutation controls',()=>{
    const back=vi.fn(),retry=vi.fn();render(<TableContextReadStatus state="loading" onBack={back} onRetry={retry}/>);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy','true');
    expect(screen.queryByText('Bàn này chưa có người chơi đang hoạt động.')).toBeNull();
    expect(screen.queryByRole('button',{name:'Thử tải lại bàn'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Quay lại danh sách bàn'}));expect(back).toHaveBeenCalledOnce();expect(retry).not.toHaveBeenCalled();
  });
  it('offers explicit read retry for unavailable context',()=>{
    const retry=vi.fn();render(<TableContextReadStatus state="error" onBack={vi.fn()} onRetry={retry}/>);
    expect(screen.getByRole('alert')).toHaveTextContent('Chưa xác minh được');
    fireEvent.click(screen.getByRole('button',{name:'Thử tải lại bàn'}));expect(retry).toHaveBeenCalledOnce();
  });
});
