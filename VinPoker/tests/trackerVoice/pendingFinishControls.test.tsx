import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {PendingFinishControls} from '../../src/components/cashier/tournament-live/handinput/PendingFinishControls';
import type {StandaloneHandInput} from '../../src/components/cashier/tournament-live/handinput/useStandaloneHandInput';
afterEach(cleanup);
it('requires explicit confirmation bound to the exact Undo journal',()=>{
 const cancel=vi.fn();const hook={pendingUndo:true,pendingUndoCancellationToken:'exact-journal',undoRecoveryBusy:false,
  submitting:false,handleCancelPendingUndo:cancel} as unknown as StandaloneHandInput;
 const view=render(<PendingFinishControls hook={hook}/>);
 fireEvent.click(screen.getByRole('button',{name:'Hủy yêu cầu Undo (giữ hành động)'}));
 expect(cancel).not.toHaveBeenCalled();expect(screen.getByRole('alertdialog')).toBeInTheDocument();
 view.rerender(<PendingFinishControls hook={{...hook,pendingUndoCancellationToken:'replaced-journal'}}/>);
 expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Hủy yêu cầu Undo (giữ hành động)'}));
 fireEvent.click(screen.getByRole('button',{name:'Xác nhận hủy yêu cầu Undo'}));
 expect(cancel).toHaveBeenCalledExactlyOnceWith('replaced-journal');
});
function setup(submitting=false){
 const read=vi.fn(),cancel=vi.fn();
 const hook={pendingFinish:{request_id:'finish-test-request'},pendingFinishError:null,submitting,handleReconcilePendingFinish:read,handleCancelPendingFinish:cancel} as unknown as StandaloneHandInput;
 render(<PendingFinishControls hook={hook}/>);return {read,cancel};
}
it('offers receipt-only reconciliation without cancellation or another writer',()=>{
 const {read,cancel}=setup();fireEvent.click(screen.getByRole('button',{name:'Đối chiếu Finish đã gửi'}));
 expect(read).toHaveBeenCalledOnce();expect(cancel).not.toHaveBeenCalled();
});
it('disables both recovery actions during an active request',()=>{
 setup(true);expect(screen.getByRole('button',{name:'Đối chiếu Finish đã gửi'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'Hủy yêu cầu Finish (không void hand)'})).toBeDisabled();
});
it('requires an accessible explicit confirmation before cancelling the exact pending request',()=>{
 const {cancel}=setup();fireEvent.click(screen.getByRole('button',{name:'Hủy yêu cầu Finish (không void hand)'}));
 expect(cancel).not.toHaveBeenCalled();expect(screen.getByRole('alertdialog')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Giữ yêu cầu'}));expect(cancel).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Hủy yêu cầu Finish (không void hand)'}));
 fireEvent.click(screen.getByRole('button',{name:'Xác nhận hủy yêu cầu Finish'}));
 expect(cancel).toHaveBeenCalledExactlyOnceWith('finish-test-request');
});
it('retires an open confirmation when its pending request is replaced',()=>{
 const cancel=vi.fn();const hook={pendingFinish:{request_id:'old-request'},submitting:false,handleCancelPendingFinish:cancel} as unknown as StandaloneHandInput;
 const view=render(<PendingFinishControls hook={hook}/>);
 fireEvent.click(screen.getByRole('button',{name:'Hủy yêu cầu Finish (không void hand)'}));expect(screen.getByRole('alertdialog')).toBeInTheDocument();
 view.rerender(<PendingFinishControls hook={{...hook,pendingFinish:{...hook.pendingFinish!,request_id:'replacement-request'}}}/>);
 expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();expect(cancel).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Hủy yêu cầu Finish (không void hand)'}));
 fireEvent.click(screen.getByRole('button',{name:'Xác nhận hủy yêu cầu Finish'}));
 expect(cancel).toHaveBeenCalledExactlyOnceWith('replacement-request');
});
it('offers explicit read-only Undo recovery and shows unresolved errors',()=>{
 const read=vi.fn();
 const hook={pendingUndo:true,undoRecoveryBusy:false,undoRecoveryError:'Chưa có receipt',submitting:false,
  handleReconcilePendingUndo:read} as unknown as StandaloneHandInput;
 const view=render(<PendingFinishControls hook={hook}/>);
 fireEvent.click(screen.getByRole('button',{name:'Đối chiếu Undo đã gửi'}));
 expect(read).toHaveBeenCalledOnce();expect(screen.getByRole('alert')).toHaveTextContent('Chưa có receipt');
 view.rerender(<PendingFinishControls hook={{...hook,undoRecoveryBusy:true}}/>);
 expect(screen.getByRole('button',{name:'Đang đối chiếu Undo…'})).toBeDisabled();
});
