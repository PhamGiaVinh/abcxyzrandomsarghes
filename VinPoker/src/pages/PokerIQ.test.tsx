import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {DrillAnswer,DrillHand,DrillResult} from '@/lib/pokerIQ';
const h=vi.hoisted(()=>({load:vi.fn()}));
vi.mock('react-router-dom',()=>({useNavigate:()=>vi.fn()}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:{pokerIqRemoteQuestions:true}}));
vi.mock('@/lib/pokerIQ/loadRemoteQuestions',()=>({loadRemoteApprovedHands:h.load}));
vi.mock('@/components/pokerIQ/DraftRibbon',()=>({DraftRibbon:()=>null}));
vi.mock('@/components/pokerIQ/HandQuestion',()=>({HandQuestion:({hand,onAnswer}:{hand:DrillHand;onAnswer:(a:DrillAnswer)=>void})=><div><p>{hand.scenario}</p><button onClick={()=>onAnswer({handId:hand.id,optionId:hand.options[0].id,selfConfidence:'medium'})}>Answer TEST</button></div>}));
vi.mock('@/components/pokerIQ/ResultCard',()=>({ResultCard:({result}:{result:DrillResult})=><pre data-testid="result">{JSON.stringify(result)}</pre>}));
import PokerIQ from './PokerIQ';
import {computeDrillResult,DRILL_HANDS} from '@/lib/pokerIQ';
let resolve:(hands:DrillHand[])=>void;
const override:DrillHand={...DRILL_HANDS[0],reviewStatus:'approved',scenario:'REMOTE OVERRIDE TEST',options:DRILL_HANDS[0].options.map(o=>({...o,score:0}))};
beforeEach(()=>{h.load.mockReset();h.load.mockReturnValue(new Promise<DrillHand[]>(r=>{resolve=r;}));});
afterEach(cleanup);
const start=()=>fireEvent.click(screen.getByRole('button',{name:'pokerDrill.intro.start'}));
function finish(){for(let i=0;i<DRILL_HANDS.length;i++)fireEvent.click(screen.getByRole('button',{name:'Answer TEST'}));}
describe('Poker IQ per-run bank snapshot (component transport modeled)',()=>{
 it('does not replace a displayed question when remote content arrives mid-run; next run can use it',async()=>{
  render(<PokerIQ/>);start();
  expect(screen.getByText(DRILL_HANDS[0].scenario)).toBeInTheDocument();
  await act(async()=>resolve([override]));
  expect(screen.queryByText('REMOTE OVERRIDE TEST')).not.toBeInTheDocument();
  expect(screen.getByText(DRILL_HANDS[0].scenario)).toBeInTheDocument();
  finish();fireEvent.click(screen.getByRole('button',{name:'pokerDrill.result.cta'}));
  expect(screen.getByText('REMOTE OVERRIDE TEST')).toBeInTheDocument();
 });
 it('does not retroactively change a finished result when the bank loads later',async()=>{
  render(<PokerIQ/>);start();finish();
  const expected=computeDrillResult(DRILL_HANDS,DRILL_HANDS.map(hand=>({handId:hand.id,optionId:hand.options[0].id,selfConfidence:'medium'})));
  expect(screen.getByTestId('result').textContent).toBe(JSON.stringify(expected));
  await act(async()=>resolve([override]));
  expect(screen.getByTestId('result').textContent).toBe(JSON.stringify(expected));
 });
 it('uses approved content that finishes loading before the player starts',async()=>{
  render(<PokerIQ/>);await act(async()=>resolve([override]));start();
  expect(screen.getByText('REMOTE OVERRIDE TEST')).toBeInTheDocument();
 });
});
