import { describe, expect, it, vi } from 'vitest';
vi.mock('@/integrations/supabase/client', () => ({supabase:{rpc:vi.fn()}}));
import { parsePaidWinnings, parsePlayerFinancialReport } from './playerFinancialReport';
const report = {clubId:'club-a',clubs:[],customers:[],selected:null,totalCount:0,history:[],totalHistory:0};
describe('financial report boundary', () => {
  it('rejects another club or selected customer', () => {
    expect(() => parsePlayerFinancialReport(report,'club-b',null)).toThrow();
    expect(() => parsePlayerFinancialReport(report,'club-a','other-person')).toThrow();
  });
  it('rejects rounded unsafe money and accepts explicitly unavailable costs', () => {
    const customer={customerRef:'a',name:'A',cost:null,paidPrize:100,rake:null};
    expect(parsePlayerFinancialReport({...report,customers:[customer]},'club-a',null).customers[0].cost).toBeNull();
    expect(() => parsePlayerFinancialReport({...report,customers:[{...customer,paidPrize:Number.MAX_SAFE_INTEGER+1}]},'club-a',null)).toThrow();
  });
  it('public winnings require exact player, scope and complete evidence', () => {
    const paid={playerId:'a',totalWinnings:100,complete:true,scope:'cashier-confirmed'};
    expect(parsePaidWinnings(paid,'a').totalWinnings).toBe(100);
    expect(() => parsePaidWinnings(paid,'b')).toThrow();
    expect(() => parsePaidWinnings({...paid,complete:false},'a')).toThrow();
    expect(() => parsePaidWinnings({...paid,totalWinnings:-1},'a')).toThrow();
    expect(parsePaidWinnings({...paid,complete:false,totalWinnings:null},'a').totalWinnings).toBeNull();
  });
  it('never accepts another customer F&B history or unsafe F&B totals', () => {
    const fnb={paid:10000,refunded:0,net:10000,pending:0,comp:0,totalCount:1,unavailableCount:0,unlinkedOrderCount:1,
      orders:[{id:'order-a',customerRef:'person-a',items:[]}]};
    const selected={customerRef:'person-a',name:'A'};
    expect(parsePlayerFinancialReport({...report,selected,fnb},'club-a','person-a').fnb?.net).toBe(10000);
    expect(() => parsePlayerFinancialReport({...report,selected,fnb:{...fnb,orders:[{...fnb.orders[0],customerRef:'person-b'}]}},'club-a','person-a')).toThrow();
    expect(() => parsePlayerFinancialReport({...report,selected,fnb:{...fnb,net:Number.MAX_SAFE_INTEGER+1}},'club-a','person-a')).toThrow();
  });
});
