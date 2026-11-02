import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import i18n from '@/i18n';
import {BaggedFlightReleaseControl} from './BaggedFlightReleaseControl';
import {eventJournalKey,persistEventJournal} from '@/ops/floor/multiDayEventJournal';
const h=vi.hoisted(()=>{const rpc=vi.fn();return {rpc,client:{rpc}};});
vi.mock('@/integrations/supabase/SupabaseClientContext',()=>({useSupabaseClient:()=>h.client}));
const props={actorId:'675fe35e-60a8-4452-bb90-e79486d54da6',eventId:'dbb49f8d-7d47-4c2c-afd9-f57062c9971d',
 flightId:'fdf91018-09f3-4cdc-b76a-f688eb216cee',blocked:false,canStart:true,onPendingChange:vi.fn(),onReleased:vi.fn()};
const row={tournamentTableId:'8ce69933-b2d0-4dfe-962e-86709c6222ac',tableSessionId:'c3f4dcfe-6dd1-4ef4-8cec-e0a9cf613e55',revision:10,
 name:'Paid journey TEST 1',playerCount:8,baggedTotal:160000,state:'open'};
const context={flightId:props.flightId,eventId:props.eventId,releaseEnabled:true,state:'locked',rosterHash:'9b83697a48dba8fac105ffbf058147a1',dayVersion:1,tables:[row]};
const receipt={ok:true,closed:true,status:'bagged',tournament_table_id:row.tournamentTableId,table_session_id:row.tableSessionId,
 revision:11,releasedPlayers:8,baggedTotal:160000,rosterHash:context.rosterHash,dayVersion:1};
const releases=()=>h.rpc.mock.calls.filter(([name])=>name==='release_bagged_flight_table_v1');
beforeEach(async()=>{await i18n.changeLanguage('en');sessionStorage.clear();vi.clearAllMocks();});
afterEach(async()=>{cleanup();await i18n.changeLanguage('vi');});
const open=async()=>{fireEvent.click(await screen.findByRole('button',{name:'Release this table'}));};
it('reads exact server context and requires confirmation before writing',async()=>{
 h.rpc.mockResolvedValue({data:context,error:null});render(<BaggedFlightReleaseControl {...props}/>);
 await open();expect(releases()).toHaveLength(0);expect(screen.getByRole('alertdialog')).toHaveTextContent('not a bust');
 expect(screen.getByRole('alertdialog')).toHaveTextContent('Paid journey TEST 1');
});
it('fences double clicks and verifies exact receipt before clearing intent',async()=>{
 let finish!:(v:unknown)=>void;
 h.rpc.mockImplementation((name:string)=>name==='get_bagged_flight_tables_v1'?Promise.resolve({data:context,error:null})
  :new Promise(resolve=>{finish=resolve;}));
 render(<BaggedFlightReleaseControl {...props}/>);await open();const confirm=screen.getByRole('button',{name:'Confirm table session release'});
 fireEvent.click(confirm);fireEvent.click(confirm);expect(releases()).toHaveLength(1);
 expect(sessionStorage.getItem(eventJournalKey('bag-release',props.actorId,props.eventId))).not.toBeNull();
 await act(async()=>finish({data:receipt,error:null}));await waitFor(()=>expect(props.onReleased).toHaveBeenCalledTimes(1));
 expect(sessionStorage.getItem(eventJournalKey('bag-release',props.actorId,props.eventId))).toBeNull();
});
it('retains unknown outcome through remount and replays the same key even while new writes are held',async()=>{
 let result={data:null as unknown,error:{message:'response lost'} as {message:string}|null};
 h.rpc.mockImplementation((name:string)=>Promise.resolve(name==='get_bagged_flight_tables_v1'?{data:context,error:null}:result));
 const first=render(<BaggedFlightReleaseControl {...props}/>);await open();fireEvent.click(screen.getByRole('button',{name:'Confirm table session release'}));
 await screen.findByRole('alert');const original=releases()[0][1];
 expect(()=>persistEventJournal(sessionStorage,'qualify',props.actorId,props.eventId,'{}')).toThrow('PENDING');
 first.unmount();result={data:receipt,error:null};render(<BaggedFlightReleaseControl {...props} canStart={false}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Check saved release request'}));
 await waitFor(()=>expect(props.onReleased).toHaveBeenCalledTimes(1));expect(releases()[1][1]).toEqual(original);
});
it('does not accept malformed read state or invent an empty table list',async()=>{
 h.rpc.mockResolvedValue({data:null,error:null});render(<BaggedFlightReleaseControl {...props}/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('unverified');
 expect(screen.queryByRole('button',{name:'Release this table'})).not.toBeInTheDocument();expect(releases()).toHaveLength(0);
});
it('rejects a successful-looking receipt for a different session and keeps the journal',async()=>{
 h.rpc.mockImplementation((name:string)=>Promise.resolve({data:name==='get_bagged_flight_tables_v1'?context:{...receipt,table_session_id:props.eventId},error:null}));
 render(<BaggedFlightReleaseControl {...props}/>);await open();fireEvent.click(screen.getByRole('button',{name:'Confirm table session release'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('unverified');expect(props.onReleased).not.toHaveBeenCalled();
 expect(sessionStorage.getItem(eventJournalKey('bag-release',props.actorId,props.eventId))).not.toBeNull();
});
it('does not clear the original actor journal after a late write completes in another scope',async()=>{
 let finish!:(v:unknown)=>void;
 h.rpc.mockImplementation((name:string)=>name==='get_bagged_flight_tables_v1'?Promise.resolve({data:context,error:null})
  :new Promise(resolve=>{finish=resolve;}));
 const first=render(<BaggedFlightReleaseControl {...props}/>);await open();
 fireEvent.click(screen.getByRole('button',{name:'Confirm table session release'}));
 first.rerender(<BaggedFlightReleaseControl {...props} actorId="3add8ca8-34ff-4f52-8b40-a48c192d3aa5"/>);
 await act(async()=>finish({data:receipt,error:null}));expect(props.onReleased).not.toHaveBeenCalled();
 expect(sessionStorage.getItem(eventJournalKey('bag-release',props.actorId,props.eventId))).not.toBeNull();
});
