import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({read:Promise.resolve({data:null,error:null}) as Promise<{data:unknown;error:unknown}>,write:vi.fn(),signal:null as AbortSignal|null}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:()=>{
  const query={select:()=>query,eq:()=>query,maybeSingle:()=>query,abortSignal:(signal:AbortSignal)=>{h.signal=signal;return query;},then:(...args:Parameters<Promise<{data:unknown;error:unknown}>['then']>)=>h.read.then(...args),upsert:h.write};return query;
}}}));
vi.mock('sonner',()=>({toast:{success:vi.fn(),error:vi.fn(),info:vi.fn()}}));
import {PokerIqQuestionsEditor} from './PokerIqQuestionsEditor';
import {DRILL_HANDS} from '@/lib/pokerIQ';
import {loadQuestionBank,loadRemoteApprovedHands} from '@/lib/pokerIQ/loadRemoteQuestions';
beforeEach(()=>{h.read=Promise.resolve({data:null,error:null});h.write.mockReset().mockResolvedValue({error:null});h.signal=null;});
afterEach(()=>{cleanup();vi.useRealTimers();});
it('does not expose an empty writable bank after a failed read; explicit retry recovers',async()=>{
 h.read=Promise.resolve({data:null,error:{message:'TEST read unavailable'}});render(<PokerIqQuestionsEditor/>);await act(async()=>{});
 expect(screen.queryByText('Chưa có câu hỏi nào.')).not.toBeInTheDocument();expect(screen.getByRole('alert')).toHaveTextContent('Chưa xác minh');
 expect(screen.getByRole('button',{name:'Nhập câu mẫu'})).toBeDisabled();expect(screen.getByRole('button',{name:'Câu hỏi mới'})).toBeDisabled();expect(h.write).not.toHaveBeenCalled();
 h.read=Promise.resolve({data:{value:[DRILL_HANDS[0]]},error:null});fireEvent.click(screen.getByRole('button',{name:'Thử tải lại câu hỏi'}));await act(async()=>{});
 expect(screen.getByText(DRILL_HANDS[0].scenario)).toBeInTheDocument();expect(screen.getByRole('button',{name:'Câu hỏi mới'})).toBeEnabled();expect(h.write).not.toHaveBeenCalled();
});
it('keeps writes disabled while the initial bank read is pending',async()=>{
 let resolve!:(x:{data:unknown;error:unknown})=>void;h.read=new Promise(r=>{resolve=r;});render(<PokerIqQuestionsEditor/>);
 expect(screen.getByRole('button',{name:'Nhập câu mẫu'})).toBeDisabled();expect(screen.getByRole('button',{name:'Câu hỏi mới'})).toBeDisabled();
 await act(async()=>resolve({data:null,error:null}));expect(screen.getByText('Chưa có câu hỏi nào.')).toBeInTheDocument();expect(screen.getByRole('button',{name:'Nhập câu mẫu'})).toBeEnabled();
});
it.each([null,{},[DRILL_HANDS[0],{id:'invalid'}],[DRILL_HANDS[0],DRILL_HANDS[0]]])('rejects an unverified or partial authored bank: %j',async(value)=>{
 h.read=Promise.resolve({data:{value},error:null});await expect(loadQuestionBank()).rejects.toThrow();
});
it('bounds and aborts a hung authored-bank read',async()=>{
 vi.useFakeTimers();h.read=new Promise(()=>{});const pending=loadQuestionBank();const result=expect(pending).rejects.toThrow();await vi.advanceTimersByTimeAsync(10000);await result;expect(h.signal?.aborted).toBe(true);
});
it('preserves verified empty and complete authored banks and public fallback',async()=>{
 h.read=Promise.resolve({data:{value:[]},error:null});await expect(loadQuestionBank()).resolves.toEqual([]);
 h.read=Promise.resolve({data:{value:[DRILL_HANDS[0]]},error:null});await expect(loadQuestionBank()).resolves.toEqual([DRILL_HANDS[0]]);
 h.read=Promise.resolve({data:null,error:{message:'TEST unavailable'}});await expect(loadRemoteApprovedHands()).resolves.toEqual([]);
});
