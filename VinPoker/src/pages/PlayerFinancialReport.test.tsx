import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
const mock = vi.hoisted(() => ({load:vi.fn(),auth:{user:{id:'owner-a'},session:null}}));
vi.mock('@/hooks/useAuth', () => ({useAuth:()=>mock.auth}));
vi.mock('@/lib/playerFinancialReport', () => ({loadPlayerFinancialReport:mock.load}));
vi.mock('react-i18next', () => ({useTranslation:()=>({t:(key:string)=>key})}));
import PlayerFinancialReport from './PlayerFinancialReport';
const customer={customerRef:'person-a',name:'Customer A',cost:110000,rake:10000,paidPrize:200000,pendingPrize:0,profit:90000,roi:81.8182,unavailableCount:0,paidBuys:1,tournaments:1,visits:1,activeTournaments:0,averageSpend:110000};
const report={clubId:'club-a',clubs:[{id:'club-a',name:'Club A'}],customers:[customer],selected:null,totalCount:1,history:[],totalHistory:0};
beforeEach(()=>{mock.load.mockReset();mock.auth.user={id:'owner-a'};});
describe('club player finance screen',()=>{
 it('opens a player and shows the receipt history with the server ROI',async()=>{
  mock.load.mockImplementation(async(_club,person)=>person?{...report,selected:customer,totalHistory:1,history:[{id:'ticket-a',kind:'buyin',tournamentId:'tour-a',tournamentName:'Morning TEST',at:'2026-11-03T01:00:00Z',cost:110000,rake:10000,verified:true,movements:[{id:'receipt-a',at:'2026-11-03T01:00:00Z',kind:'buyin',amount:110000,method:'cash'}]}]}:report);
  render(<MemoryRouter initialEntries={['/club/admin/player-finance?club=club-a']}><PlayerFinancialReport/></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button',{name:'Customer A'}));
  expect(await screen.findByText('Morning TEST')).toBeInTheDocument();
  expect(screen.getByText('81,82%')).toBeInTheDocument();
  expect(mock.load.mock.calls.at(-1)?.slice(0,2)).toEqual(['club-a','person-a']);
 });
 it('keeps F&B spending separate and shows unlinked-order coverage',async()=>{
  mock.load.mockResolvedValue({...report,selected:customer,fnb:{paid:50000,refunded:10000,net:40000,pending:20000,comp:5000,unavailableCount:0,totalCount:1,unlinkedOrderCount:3,
   orders:[{id:'order-a',createdAt:'2026-11-03T01:00:00Z',status:'paid',method:'cash',paidAt:'2026-11-03T01:00:00Z',isComp:false,verified:true,paid:50000,refunded:10000,net:40000,items:[{id:'tea',name:'LOCAL Tea',quantity:2,unitPrice:25000}]}]}});
  render(<MemoryRouter initialEntries={['/?club=club-a&customer=person-a']}><PlayerFinancialReport/></MemoryRouter>);
  expect(await screen.findByText(/LOCAL Tea/)).toBeInTheDocument();
  expect(screen.getByText('playerFinance.fnbUnlinked')).toBeInTheDocument();
  expect(screen.getByText('81,82%')).toBeInTheDocument();
 });
 it('hides the previous owner data immediately when the session identity changes',async()=>{
  mock.load.mockResolvedValue(report);
  const view=render(<MemoryRouter initialEntries={['/?club=club-a']}><PlayerFinancialReport/></MemoryRouter>);
  await screen.findByRole('button',{name:'Customer A'});
  mock.auth.user={id:'owner-b'};mock.load.mockImplementation(()=>new Promise(()=>{}));
  view.rerender(<MemoryRouter initialEntries={['/?club=club-a']}><PlayerFinancialReport/></MemoryRouter>);
  expect(screen.queryByRole('button',{name:'Customer A'})).not.toBeInTheDocument();
  await waitFor(()=>expect(mock.load).toHaveBeenCalledTimes(2));
 });
});
