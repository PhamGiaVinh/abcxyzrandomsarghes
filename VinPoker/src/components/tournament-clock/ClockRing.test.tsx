import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {ClockRing} from './ClockRing';
afterEach(cleanup);
it('terminal clock hides frozen time and upcoming break instead of implying play continues',()=>{
 render(<ClockRing levelLabel="Finished" secondsLeft={1199} nextBreakSecondsLeft={3599} terminal/>);
 expect(screen.getByText('Finished')).toBeInTheDocument();
 expect(screen.getByText('--:--')).toBeInTheDocument();
 expect(screen.queryByText('19:59')).not.toBeInTheDocument();
 expect(screen.queryByText('Next Break')).not.toBeInTheDocument();
});
it('keeps active paused time and unknown-break display unchanged',()=>{
 render(<ClockRing levelLabel="Level 4" secondsLeft={1199} nextBreakSecondsLeft={null}/>);
 expect(screen.getByText('19:59')).toBeInTheDocument();
 expect(screen.getByText('Next Break')).toBeInTheDocument();
 expect(screen.getByText('—')).toBeInTheDocument();
});
