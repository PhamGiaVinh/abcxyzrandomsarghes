import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import type {TvData} from '@/types/tv';
import {TvTimer} from './TvTimer';
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
afterEach(cleanup);
it.each(['finished','cancelled'] as const)('legacy timer marks %s instead of showing a frozen live countdown',status=>{
 render(<TvTimer data={{status,isRunning:false,remainingSeconds:1199,currentLevel:{levelNumber:4}} as TvData}/>);
 expect(screen.getByText(`tv.${status}`)).toBeInTheDocument();
 expect(screen.getByText('--:--')).toBeInTheDocument();
 expect(screen.queryByText('19:59')).not.toBeInTheDocument();
});
