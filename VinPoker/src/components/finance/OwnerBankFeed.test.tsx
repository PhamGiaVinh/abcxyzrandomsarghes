import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import OwnerBankFeed, { parseBankObservation } from './OwnerBankFeed';
const row = { id:'demo-a',createdAt:'2026-11-17T00:00:00Z',occurredAt:null,amount:100000,direction:'in',status:'unmatched',verified:false };
const envelope = (rows = [row], clubId = 'club-a') => ({ version:'owner-bank-observation-v1',clubId,asOf:'2026-11-17T00:00:00Z',rows });
beforeEach(()=>vi.useFakeTimers());
afterEach(()=>{cleanup();vi.useRealTimers();});
describe('owner bank observation lifecycle',()=>{
  it('highlights changed rows once, without treating initial rows as new',async()=>{
    const rpc=vi.fn().mockResolvedValueOnce({data:envelope(),error:null}).mockResolvedValue({data:envelope([{...row,verified:true}]),error:null});
    render(<OwnerBankFeed client={{rpc} as never} clubId="club-a" scope="owner-a"/>);
    await act(async()=>{});
    expect(screen.queryByText('Vừa cập nhật')).not.toBeInTheDocument();
    await act(async()=>{await vi.advanceTimersByTimeAsync(10_000);});
    expect(screen.getByText('Vừa cập nhật')).toBeInTheDocument();
    await act(async()=>{await vi.advanceTimersByTimeAsync(1400);});
    expect(screen.queryByText('Vừa cập nhật')).not.toBeInTheDocument();
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it('drops prior financial rows when access fails',async()=>{
    const rpc=vi.fn().mockResolvedValueOnce({data:envelope(),error:null}).mockResolvedValue({data:null,error:{code:'42501'}});
    render(<OwnerBankFeed client={{rpc} as never} clubId="club-a" scope="owner-a"/>);
    await act(async()=>{});expect(screen.getByText('+100.000 ₫')).toBeInTheDocument();
    await act(async()=>{await vi.advanceTimersByTimeAsync(10_000);});
    expect(screen.queryByText('+100.000 ₫')).not.toBeInTheDocument();expect(screen.getByRole('alert')).toBeInTheDocument();
  });
  it('does not commit a late response after scope changes or overlap reads',async()=>{
    let resolve!:(v:unknown)=>void;
    const rpc=vi.fn().mockImplementationOnce(()=>new Promise(r=>{resolve=r;})).mockResolvedValue({data:envelope([], 'club-b'),error:null});
    const view=render(<OwnerBankFeed client={{rpc} as never} clubId="club-a" scope="owner-a"/>);
    await act(async()=>{await vi.advanceTimersByTimeAsync(30_000);});expect(rpc).toHaveBeenCalledTimes(1);
    view.rerender(<OwnerBankFeed client={{rpc} as never} clubId="club-b" scope="owner-b"/>);
    await act(async()=>{resolve({data:envelope(),error:null});});
    expect(screen.queryByText('+100.000 ₫')).not.toBeInTheDocument();
  });
  it('rejects another club, unsafe money and duplicate rows',()=>{
    for(const invalid of [envelope([row],'other'),envelope([{...row,amount:Number.MAX_SAFE_INTEGER+1}]),envelope([row,row])]) expect(()=>parseBankObservation(invalid,'club-a')).toThrow();
  });
});
