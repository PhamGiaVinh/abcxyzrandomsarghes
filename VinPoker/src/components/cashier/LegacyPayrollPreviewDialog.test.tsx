import {fireEvent,render,screen,cleanup} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {LegacyPayrollPreviewDialog} from './LegacyPayrollPreviewDialog';
afterEach(cleanup);
describe('legacy payroll preview mobile display',()=>{
  it('fits the sandboxed preview to narrow screens without changing the original A4 HTML',()=>{
    const html='<style>.payroll-print { width: 210mm; }</style><article class="payroll-print">TEST immutable input</article>';
    render(<LegacyPayrollPreviewDialog preview={{title:'TEST preview',html}} onOpenChange={()=>{}} onDownload={()=>{}}/>);
    const frame=screen.getByTitle('Bản xem tạm tính phiếu lương');
    const doc=frame.getAttribute('srcdoc')!;
    expect(frame).toHaveAttribute('sandbox','');expect(doc).toContain(html);
    expect(doc).toContain('@media screen and (max-width: 800px)');
    expect(doc).toContain('.payroll-print { width: 100%;');
    expect(doc.lastIndexOf('.payroll-print { width: 100%;')).toBeGreaterThan(doc.indexOf(html));
  });
  it('keeps PDF download as the original explicit callback, not an automatic export',()=>{
    const download=vi.fn();render(<LegacyPayrollPreviewDialog preview={{title:'TEST preview',html:'TEST'}} onOpenChange={()=>{}} onDownload={download}/>);
    expect(download).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Tải PDF'}));expect(download).toHaveBeenCalledTimes(1);
  });
});
