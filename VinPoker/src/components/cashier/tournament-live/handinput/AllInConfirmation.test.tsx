import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {AllInConfirmation} from './AllInConfirmation';
import type {StandaloneHandInput} from './useStandaloneHandInput';
afterEach(cleanup);
const fixture=()=>({pendingAllIn:{playerId:'TEST',displayName:'TEST PLAYER',stack:20000,fingerprint:'scope'},
 submitting:false,isReadOnly:false,actionSyncBlocked:false,cancelPendingAllIn:vi.fn(),confirmPendingAllIn:vi.fn()});
it('opens without dispatch and focuses the safe cancel choice',async()=>{
 const h=fixture();render(<AllInConfirmation hook={h as unknown as StandaloneHandInput}/>);
 expect(screen.getByRole('alertdialog',{name:'Xác nhận ALL-IN'})).toHaveTextContent('TEST PLAYER');
 expect(h.confirmPendingAllIn).not.toHaveBeenCalled();
 await waitFor(()=>expect(screen.getByRole('button',{name:'Hủy'})).toHaveFocus());
 fireEvent.click(screen.getByRole('button',{name:'Hủy'}));
 expect(h.cancelPendingAllIn).toHaveBeenCalledOnce();expect(h.confirmPendingAllIn).not.toHaveBeenCalled();
});
it('delegates only the explicit confirmation to the controller',()=>{
 const h=fixture();render(<AllInConfirmation hook={h as unknown as StandaloneHandInput}/>);
 fireEvent.click(screen.getByRole('button',{name:'Xác nhận ALL-IN'}));expect(h.confirmPendingAllIn).toHaveBeenCalledOnce();
});
it.each(['submitting','isReadOnly','actionSyncBlocked'] as const)('disables confirmation while %s',flag=>{
 const h={...fixture(),[flag]:true};render(<AllInConfirmation hook={h as unknown as StandaloneHandInput}/>);
 const button=screen.getByRole('button',{name:'Xác nhận ALL-IN'});expect(button).toBeDisabled();
 fireEvent.click(button);expect(h.confirmPendingAllIn).not.toHaveBeenCalled();
});
