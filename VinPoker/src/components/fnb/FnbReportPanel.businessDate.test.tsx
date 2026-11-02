import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import{afterEach,describe,expect,it,vi}from'vitest';
const h=vi.hoisted(()=>({read:vi.fn((_clubId?:string,_from?:string,_to?:string)=>({data:undefined,isLoading:false,error:null}))}));
vi.mock('@/hooks/useFnbReport',()=>({useFnbReport:h.read}));
import{FnbReportPanel}from'./FnbReportPanel';
afterEach(()=>{cleanup();h.read.mockClear();vi.useRealTimers();});
describe('F&B report business calendar',()=>{
 it.each([
  ['2026-10-31T18:00:00Z','2026-11-01','2026-11-01'],
  ['2026-12-31T18:00:00Z','2027-01-01','2027-01-01'],
  ['2028-02-29T18:00:00Z','2028-03-01','2028-03-01'],
 ])('uses UTC+7 days and the inclusive last microsecond for %s',(now,from,to)=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(now));render(<FnbReportPanel clubId="club-test"/>);
  expect(h.read.mock.calls.at(-1)).toEqual(['club-test',from+'T00:00:00+07:00',to+'T23:59:59.999999+07:00']);
 });
 it('blocks invalid/reversed calendar ranges before a report RPC can run',()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-31T09:00:00Z'));const v=render(<FnbReportPanel clubId="club-test"/>);
  const dates=v.container.querySelectorAll('input[type="date"]');fireEvent.change(dates[0],{target:{value:'2026-11-02'}});
  expect(h.read.mock.calls.at(-1)?.[0]).toBeUndefined();expect(screen.getByRole('alert')).toBeTruthy();
 });
});
it.each([['7 ngày','2026-10-26'],['30 ngày','2026-10-03']] as const)('selects exactly the inclusive %s preset', (label,from)=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-31T18:00:00Z'));render(<FnbReportPanel clubId="club-test"/>);fireEvent.click(screen.getByRole('button',{name:label}));expect(h.read.mock.calls.at(-1)).toEqual(['club-test',from+'T00:00:00+07:00','2026-11-01T23:59:59.999999+07:00']);
});
it.each([['default','2026-11-01'],['7 ngày','2026-10-26'],['30 ngày','2026-10-03']] as const)('rolls the live F&B %s preset after Vietnam midnight',async(label,from)=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-31T16:59:59Z'));const view=render(<FnbReportPanel clubId="club-test"/>);try{
  if(label!=='default')fireEvent.click(screen.getByRole('button',{name:label}));await act(async()=>vi.advanceTimersByTimeAsync(5001));expect(h.read.mock.calls.at(-1)).toEqual(['club-test',from+'T00:00:00+07:00','2026-11-01T23:59:59.999999+07:00']);
 }finally{view.unmount();}
});
it('keeps a manually selected F&B historical range after midnight',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-31T16:59:59Z'));const view=render(<FnbReportPanel clubId="club-test"/>);try{
  const dates=view.container.querySelectorAll('input[type="date"]');fireEvent.change(dates[0],{target:{value:'2026-10-15'}});fireEvent.change(dates[1],{target:{value:'2026-10-20'}});await act(async()=>vi.advanceTimersByTimeAsync(5001));expect(h.read.mock.calls.at(-1)).toEqual(['club-test','2026-10-15T00:00:00+07:00','2026-10-20T23:59:59.999999+07:00']);
 }finally{view.unmount();}
});
