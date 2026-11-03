import {render,screen,act,cleanup} from '@testing-library/react';
import {it,expect,vi,afterEach} from 'vitest';
import {LiveTrackerCountdown} from './LiveTrackerCountdown';
afterEach(()=>{cleanup();vi.useRealTimers();});
it('ticks locally, compensates elapsed time and notifies once without rerendering its parent',()=>{
 vi.useFakeTimers();vi.setSystemTime(1_000_000);const zero=vi.fn();let parentRenders=0;
 function Parent(){parentRenders++;return <LiveTrackerCountdown remaining={3} running receivedAt={1_000_000} onZero={zero}/>;}
 render(<Parent/>);expect(screen.getByText('00:03')).toBeInTheDocument();
 act(()=>vi.advanceTimersByTime(2_000));expect(screen.getByText('00:01')).toBeInTheDocument();expect(parentRenders).toBe(1);
 act(()=>vi.advanceTimersByTime(5_000));expect(screen.getByText('00:00')).toBeInTheDocument();expect(zero).toHaveBeenCalledTimes(1);
});
