import {cleanup,render,screen,fireEvent} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {VoidConfirmation} from '@/components/cashier/tournament-live/handinput/VoidConfirmation';
afterEach(cleanup);
const intent={handId:'test-exact-hand-id',scope:'test-scope',generation:1};
it('requires the visible confirmation and identifies the exact hand without implying a Finish',()=>{
 const confirm=vi.fn(),cancel=vi.fn();render(<VoidConfirmation hook={{pendingVoid:intent,submitting:false,cancelPendingVoid:cancel,confirmPendingVoid:confirm}}/>);
 expect(confirm).not.toHaveBeenCalled();expect(screen.getByRole('alertdialog')).toHaveTextContent('test-exact-hand-id');
 expect(screen.getByRole('alertdialog')).toHaveTextContent('không phải Finish');
 fireEvent.click(screen.getByRole('button',{name:'Giữ hand'}));expect(cancel).toHaveBeenCalled();expect(confirm).not.toHaveBeenCalled();
});
it('disables confirmation while another request owns submission',()=>{
 render(<VoidConfirmation hook={{pendingVoid:intent,submitting:true,cancelPendingVoid:vi.fn(),confirmPendingVoid:vi.fn()}}/>);
 expect(screen.getByRole('button',{name:'Xác nhận Void hand'})).toBeDisabled();
});
