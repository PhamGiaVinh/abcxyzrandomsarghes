import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {PlayerActionSheet,type ActionSeat} from './PlayerActionSheet';
const seat:ActionSeat={seat_id:'seat-test',player_id:'player-test',player_name:'Player TEST',entry_number:1,
 table_id:'table-test',table_name:'Table TEST',seat_number:1,chip_count:20000};
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function show(entryId:string|undefined,canMove:boolean){
 const onMove=vi.fn();const close=vi.fn();
 render(<PlayerActionSheet open onOpenChange={close} seat={seat} entryId={entryId} canMove={canMove}
  busting={false} onMove={onMove} onBust={vi.fn()}/>);
 return {onMove,close};
}
it('clarifies empty-seat movement without promising a separate waitlist',()=>{
 let nextFrame:FrameRequestCallback|undefined;
 vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{nextFrame=callback;return 1;});
 const {onMove,close}=show('entry-test',true);
 expect(screen.getByText(/Để chọn ghế trống/)).toBeInTheDocument();
 expect(screen.queryByText('Sắp có')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:/Chuyển/}));
 expect(close).toHaveBeenCalledWith(false);expect(onMove).not.toHaveBeenCalled();
 nextFrame?.(0);expect(onMove).toHaveBeenCalledTimes(1);
});
it.each([[undefined,true],['entry-test',false]] as const)('retains existing move permission for entry=%s allowed=%s',(entry,allowed)=>{
 const {onMove}=show(entry,allowed);
 expect(screen.getByRole('button',{name:/Chuyển/})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:/Chuyển/}));expect(onMove).not.toHaveBeenCalled();
});
