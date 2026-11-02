import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach,expect,it,vi} from 'vitest';
const data=vi.hoisted(()=>({hands:[] as Record<string,unknown>[],players:[] as Record<string,unknown>[],actions:[] as Record<string,unknown>[],draft:vi.fn(),rpc:vi.fn(),from:vi.fn()}));
vi.mock('@/integrations/supabase/SupabaseClientContext',()=>{const backend={from:data.from,rpc:data.rpc,functions:{invoke:vi.fn()}};return {useSupabaseClient:()=>backend};});
vi.mock('@/lib/featureFlags',()=>({FEATURES:{trackerHandHistoryEdit:true,trackerHistoryCompletionWorker:false,trackerResettleForward:false},isTrackerAtomicResettleAvailable:()=>false}));
vi.mock('@/lib/tracker-poker/handPlayerNamesClient',()=>({handPlayersHasSnapshotForClient:async()=>true,fetchHandPlayerDisplayForClient:async()=>new Map()}));
vi.mock('@/components/cashier/tournament-live/HandEditPanel',()=>({HandEditPanel:(props:{players:Array<{entry_number:number}>;actions:Array<{entry_number:number}>})=>{data.draft(props);return <div>Archive draft TEST boundary</div>;}}));
vi.mock('@/components/cashier/tournament-live/FloorHandActionReview',()=>({FloorHandActionReview:()=>null}));
vi.mock('@/components/cashier/tournament-live/HistoricalSettlementDisplayControl',()=>({HistoricalSettlementDisplayWorkspace:()=>null}));
vi.mock('@/components/cashier/tournament-live/HistoricalSettlementBatchControl',()=>({HistoricalSettlementBatchWorkspace:()=>null}));
import {HandHistoryWorkspace} from '@/components/cashier/tournament-live/HandHistoryWorkspace';
const hand=(id:string,n:number)=>({id,hand_number:n,created_at:'2026-10-21T01:00:00Z',status:'completed',community_cards:[],is_voided:false,pot_size:0});
const player=(handId:string,entry:number|null)=>({id:handId+'-player-'+entry,hand_id:handId,player_id:'TEST-player',entry_number:entry,player_name:'Archived TEST player '+entry,seat_number:1,starting_stack:1000,ending_stack:1000,hole_cards:[],is_eliminated:false});
const action=(handId:string,entry:number|null)=>({id:handId+'-action',hand_id:handId,player_id:'TEST-player',entry_number:entry,street:'preflop',action_type:'check',action_amount:0,action_order:1});
function mount(){render(<MemoryRouter><HandHistoryWorkspace actorId="TEST-owner" tournamentId="TEST-tour"/></MemoryRouter>);}
async function draft(n=1){fireEvent.click(await screen.findByText('#'+n));fireEvent.click(screen.getByRole('button',{name:'Xem bản nháp sửa hand',exact:true}));await waitFor(()=>expect(data.draft).toHaveBeenCalled());return data.draft.mock.lastCall![0];}
beforeEach(()=>{data.draft.mockReset();data.rpc.mockReset();data.hands=[hand('hand-a',1)];data.players=[player('hand-a',1)];data.actions=[action('hand-a',1)];data.from.mockImplementation((table:string)=>{const builder={select:()=>builder,eq:()=>builder,in:()=>builder,order:()=>builder,range:()=>builder,then:(resolve:(x:unknown)=>unknown,reject:(x:unknown)=>unknown)=>Promise.resolve({data:table==='tournament_hands'?data.hands:table==='hand_players'?data.players:table==='hand_actions'?data.actions:[],error:null}).then(resolve,reject)};return builder;});data.rpc.mockImplementation((name:string)=>{expect(name).toBe('list_tracker_history_tables_v1');return new Promise(()=>{});});});
it('rejects an explicit action generation absent from its hand roster and recovers by read retry',async()=>{
 data.actions=[action('hand-a',2)];mount();expect(await screen.findByText(/Không đối chiếu được người chơi và lượt vào/)).toBeInTheDocument();expect(screen.queryByText('#1')).not.toBeInTheDocument();data.actions=[action('hand-a',1)];fireEvent.click(screen.getByRole('button',{name:'Thử lại',exact:true}));expect(await screen.findByText('#1')).toBeInTheDocument();expect(data.draft).not.toHaveBeenCalled();
});
it('uses the sole archived participant entry for a legacy action that has no entry number',async()=>{
 data.players=[player('hand-a',2)];data.actions=[action('hand-a',null)];mount();const props=await draft();expect(props.players[0].entry_number).toBe(2);expect(props.actions[0].entry_number).toBe(2);
});
it('rejects an ambiguous missing action entry rather than selecting the first generation',async()=>{
 data.players=[player('hand-a',1),player('hand-a',2)];data.actions=[action('hand-a',null)];mount();expect(await screen.findByText(/Không đối chiếu được người chơi và lượt vào/)).toBeInTheDocument();expect(screen.queryByText('#1')).not.toBeInTheDocument();
});
it('rejects participant and action rows from an unrequested hand rather than silently dropping them',async()=>{
 data.players.push(player('hand-b',1));data.actions.push(action('hand-b',1));mount();expect(await screen.findByText(/Không đối chiếu được người chơi và lượt vào/)).toBeInTheDocument();expect(screen.queryByText('#1')).not.toBeInTheDocument();
});
it('keeps explicit matching entry identity intact for the real draft boundary',async()=>{
 data.players=[player('hand-a',2)];data.actions=[action('hand-a',2)];mount();const props=await draft();expect(props.players[0].entry_number).toBe(2);expect(props.actions[0].entry_number).toBe(2);
});
it('resolves legacy entry identity within each hand even when the same player appears in another generation elsewhere',async()=>{
 data.hands.push(hand('hand-b',2));data.players.push(player('hand-b',2));data.actions.push(action('hand-b',null));mount();const props=await draft(2);expect(props.actions[0].entry_number).toBe(2);expect(props.players[0].entry_number).toBe(2);
});
