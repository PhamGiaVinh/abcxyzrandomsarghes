import {render,screen,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {TvBroadcastBoard} from './TvBroadcastBoard';
import type {TvData} from '@/types/tv';
vi.mock('@/hooks/useTvStackRange',()=>({useTvStackRange:()=>null}));
afterEach(cleanup);
const data:TvData={tournamentName:'TEST TV',clubName:'TEST Club',status:'live',isRunning:true,isBreak:false,remainingSeconds:318,
 currentLevel:{levelNumber:19,smallBlind:1750,bigBlind:3500,ante:450,durationMinutes:20,isBreak:false},nextLevel:null,nextBreakSeconds:515,
 playersRemaining:2,totalEntries:4,reEntries:0,averageStack:30000,totalChips:60000,totalBuyIns:null,prizePool:null,prizePoolIsCanonical:true,
 prizes:[],startingStack:30000,buyIn:null,rakeAmount:null};
it('keeps canonical unknown prize and extrema unknown instead of estimating',()=>{
 render(<TvBroadcastBoard data={data}/>);
 expect(screen.getByRole('timer')).toHaveTextContent('05:18');
 expect(screen.getByRole('heading',{name:'Largest Stack'}).nextElementSibling).toHaveTextContent('—');
 expect(screen.getByRole('heading',{name:'Smallest Stack'}).nextElementSibling).toHaveTextContent('—');
 expect(screen.getByRole('heading',{name:'Total Prize'}).nextElementSibling).toHaveTextContent('—');
 expect(screen.getByText('2 / 4')).toBeInTheDocument();expect(screen.getByText('08:35')).toBeInTheDocument();
});
it('renders configured ranks and chip/BB values without fake currency conversion',()=>{
 render(<TvBroadcastBoard data={{...data,prizes:[{position:1,amount:1000000},{position:2,amount:500000}],largestStack:50000,smallestStack:10000}}/>);
 expect(screen.getByRole('heading',{name:'Places Paid'}).nextElementSibling).toHaveTextContent('2');
 expect(screen.getByText('50.000 (14 BB)')).toBeInTheDocument();expect(screen.getByText('1.000.000')).toBeInTheDocument();
});
