import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
vi.mock('@/integrations/supabase/client',()=>({supabase:{}}));
vi.mock('@/components/tracker/useTournamentTableAppearance',()=>({useTournamentTableAppearance:()=>({data:undefined})}));
vi.mock('./useInputTableAlerts',()=>({useInputTableAlerts:()=>new Map()}));
vi.mock('./ActionStepPanel',()=>({ActionStepPanel:()=>null}));
vi.mock('./BetSizingChips',()=>({BetSizingChips:()=>null}));
vi.mock('./WorkflowProgressRail',()=>({WorkflowProgressRail:()=>null}));
vi.mock('./HandControlsStrip',()=>({HandControlsStrip:()=>null}));
vi.mock('./HandGuideDrawer',()=>({HandGuideDrawer:()=>null}));
vi.mock('./ViewerSyncStatus',()=>({ViewerSyncStatus:()=>null}));
vi.mock('./TableStateSummary',()=>({TableStateSummary:()=>null}));
vi.mock('./OperatorActionLog',()=>({OperatorActionLog:()=>null}));
vi.mock('@/components/tracker/TrackerRacetrack',()=>({TrackerRacetrack:()=>null}));
// Review wiring only. Voice/provider acceptance is separate and still blocked
// by the documented local @google/genai dependency gap; never stub that SDK.
vi.mock('@/components/tracker/voice/TrackerVoicePanelGate',()=>({TrackerVoicePanelGate:()=>null}));
vi.mock('@/components/tracker/DealerTabletCockpit',()=>({DealerTabletCockpit:({guided}:{guided:React.ReactNode})=><>{guided}</>}));
import {StandaloneHandInputConsole} from './StandaloneHandInputConsole';
import {RacetrackHandInputConsole} from './RacetrackHandInputConsole';
import type {StandaloneHandInput} from './useStandaloneHandInput';
// JSDOM has no layout observer. These tests verify callback wiring only;
// actual mobile layout and native Undo are checked separately in the browser.
beforeEach(()=>vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function reviewUndoHook(overrides:Record<string,unknown>={}){
 return {tournamentId:'tour',tableId:'table',tableName:'TEST',handStarted:true,handNumber:37,isSummary:true,
 streetLabel:'Preflop',players:[{player_id:'p1',seat_number:1,display_name:'TEST',starting_stack:58900,current_stack:58800,is_folded:true},
 {player_id:'p2',seat_number:2,display_name:'TEST2',starting_stack:1100,current_stack:900}],actions:[],communityCards:[],
 positionsBySeat:new Map([[1,'BTN/SB'],[2,'BB']]),maxSeats:9,buttonSeat:1,endingStacks:{p1:58800,p2:1200},
 potSize:300,reviewPotBreakdown:{totalPot:200,uncalled:{player_id:'p2',amount:100}},potBreakdown:{mainPot:200,sidePots:[]},
 conservationOk:true,winnerDetermined:true,reviewValid:true,canUndo:true,handleUndo:vi.fn(),setEndingStacks:vi.fn(),...overrides} as unknown as StandaloneHandInput;
}
function status(actionOpen:boolean){
 const caller={player_id:'caller',display_name:'Caller TEST',seat_number:3,entry_number:1,
  starting_stack:160200,current_stack:160100,current_bet:100,total_bet:100,is_active:true,is_folded:false,is_all_in:false};
 const hook={tournamentId:'tour',tableId:'table',tableName:'TEST',handStarted:true,handNumber:9,
  streetLabel:'Preflop',players:[caller,{...caller,player_id:'raiser',display_name:'All-in TEST',seat_number:5,
   starting_stack:19800,current_stack:0,current_bet:19800,total_bet:19800,is_all_in:true}],
  actions:[],communityCards:[],positionsBySeat:new Map([[3,'BB'],[5,'BTN/SB']]),maxSeats:9,
  buttonSeat:5,selectedActorId:null,toActId:null,effectiveActorId:actionOpen?'caller':null,
  allInRunout:true,showActionStep:actionOpen,actorPlayer:actionOpen?caller:null,
  actorViewData:actionOpen?{toCall:19700}:null,bigBlind:100,potSize:19900,
  potBreakdown:{mainPot:19900,sidePots:[]},blindLevelSnapshot:{small_blind:100,big_blind:100,ante:0},
 } as unknown as StandaloneHandInput;
 const html=renderToStaticMarkup(<StandaloneHandInputConsole hook={hook}/>);
 return new DOMParser().parseFromString(html,'text/html').querySelector('[data-testid="felt-status-bar"]')?.textContent??'';
}
describe('standalone felt follows actionable workflow, not all-in seat-count hint',()=>{
 it('does not announce an acting player before the next hand has started',()=>{
  const hook=reviewUndoHook({handStarted:false,isSummary:false,toActId:'p1',showActionStep:false,
   availableTables:[],endingStacks:{},players:[
    {player_id:'p1',seat_number:1,display_name:'TEST',starting_stack:58900,current_stack:58900,is_folded:false},
    {player_id:'p2',seat_number:2,display_name:'TEST2',starting_stack:1100,current_stack:1100,is_folded:false}]});
  const html=renderToStaticMarkup(<MemoryRouter><StandaloneHandInputConsole hook={hook}/></MemoryRouter>);
  expect(html).not.toMatch(/◀\s*(?:to act|chờ)/i);
 });
 it('does not show a stale actor spotlight on the operator felt during Review',()=>{
  const hook=reviewUndoHook({toActId:'p1',showActionStep:false,players:[
   {player_id:'p1',seat_number:1,display_name:'TEST',starting_stack:58800,current_stack:58600,is_folded:false},
   {player_id:'p2',seat_number:2,display_name:'TEST2',starting_stack:1200,current_stack:1100,is_folded:true}],endingStacks:{p1:58900,p2:1100}});
  const html=renderToStaticMarkup(<MemoryRouter><StandaloneHandInputConsole hook={hook}/></MemoryRouter>);
  expect(html).toContain('Review hand');
  expect(html).not.toMatch(/◀\s*(?:to act|chờ)/i);
 });
 it.each(['standalone','racetrack'])('uses explicit canonical Undo rather than clearing computed stacks in %s Review',layout=>{
  const hook=reviewUndoHook();
  render(<MemoryRouter>{layout==='standalone'?<StandaloneHandInputConsole hook={hook}/>:<RacetrackHandInputConsole hook={hook}/>}</MemoryRouter>);
  fireEvent.click(screen.getByRole('button',{name:'Hoàn tác hành động cuối'}));
  expect(hook.handleUndo).toHaveBeenCalledOnce();
  expect(hook.setEndingStacks).not.toHaveBeenCalled();
 });
 it.each(['standalone','racetrack'])('disables Review Undo without a snapshot or while submitting in %s',layout=>{
  const hook=reviewUndoHook({canUndo:false});
  const tree=()=> <MemoryRouter>{layout==='standalone'?<StandaloneHandInputConsole hook={hook}/>:<RacetrackHandInputConsole hook={hook}/>}</MemoryRouter>;
  const view=render(tree());
  expect(screen.getByRole('button',{name:'Hoàn tác hành động cuối'})).toBeDisabled();
  hook.canUndo=true;hook.submitting=true;view.rerender(tree());
  fireEvent.click(screen.getByRole('button',{name:'Hoàn tác hành động cuối'}));
  expect(screen.getByRole('button',{name:'Hoàn tác hành động cuối'})).toBeDisabled();
  expect(hook.handleUndo).not.toHaveBeenCalled();
 });
 it.each(['standalone','racetrack'])('shows the canonical contested pot and separate return in %s Review',layout=>{
  const hook={tournamentId:'tour',tableId:'table',tableName:'TEST',handStarted:true,handNumber:18,isSummary:true,
   streetLabel:'Preflop',players:[
    {player_id:'p1',seat_number:1,display_name:'Cover TEST',starting_stack:59400,current_stack:59300,is_folded:true},
    {player_id:'p2',seat_number:2,display_name:'Short TEST',starting_stack:600,current_stack:400}],
   actions:[],communityCards:[],positionsBySeat:new Map([[1,'BTN/SB'],[2,'BB']]),maxSeats:9,buttonSeat:1,
   endingStacks:{p1:59300,p2:700},potSize:300,reviewPotBreakdown:{totalPot:200,uncalled:{player_id:'p2',amount:100}},
   potBreakdown:{mainPot:200,sidePots:[]},conservationOk:true,winnerDetermined:true,reviewValid:true,
  } as unknown as StandaloneHandInput;
  const content=layout==='standalone'?<StandaloneHandInputConsole hook={hook}/>:<RacetrackHandInputConsole hook={hook}/>;
  const doc=new DOMParser().parseFromString(renderToStaticMarkup(<MemoryRouter>{content}</MemoryRouter>),'text/html');
  const panel=Array.from(doc.querySelectorAll('h3')).find(el=>el.textContent==='Review hand')?.parentElement;
  expect(panel?.textContent).toContain('Pot: 200');
  expect(panel?.querySelector('[role="note"]')?.textContent).toContain('Hoàn cược chưa được theo: 100 → Ghế 2');
  expect(panel?.textContent).not.toContain('Pot: 300');
 });
 it('shows the outstanding caller rather than betting-closed runout',()=>{
  expect(status(true)).toContain('Caller TEST');
 });
 it('keeps runout when no action remains',()=>{
  const value=status(false);expect(value).not.toContain('Caller TEST');expect(value).toMatch(/runout|chạy board/i);
 });
});
