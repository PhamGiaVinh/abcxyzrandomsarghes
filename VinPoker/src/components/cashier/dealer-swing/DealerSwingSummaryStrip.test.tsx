import {render,screen,within} from '@testing-library/react';
import {describe,it,expect} from 'vitest';
import DealerSwingSummaryStrip from './DealerSwingSummaryStrip';

describe('DealerSwingSummaryStrip responsive readouts',()=>{
 it('keeps all eight metrics in a width-bounded mobile grid without changing counts',()=>{
  render(<DealerSwingSummaryStrip activeTables={100} assignedTables={99} overdue={3} warnings={2}
   onBreak={4} predictedPending={5} stabilityPct={92} earliestShortageLabel={null} nowMs={0}/>);
  const metrics=screen.getByRole('group',{name:'Chỉ số sàn'});
  expect(metrics).toHaveClass('grid','w-full','min-w-0','grid-cols-4','sm:flex','sm:w-auto');
  const content=within(metrics);
  for(const label of ['Bàn mở','Có dealer','Bàn trống','Quá hạn','Cảnh báo','Đang nghỉ','Dự kiến','Ổn định'])expect(content.getByText(label)).toBeInTheDocument();
  expect(content.getByText('100')).toBeInTheDocument();expect(content.getByText('99')).toBeInTheDocument();
  expect(content.getByText('1')).toBeInTheDocument();expect(content.getByText('92%')).toBeInTheDocument();
 });
 it('retains unknown stability and the zero-table display',()=>{
  render(<DealerSwingSummaryStrip activeTables={0} assignedTables={0} overdue={0} warnings={0}
   onBreak={0} predictedPending={0} stabilityPct={null} earliestShortageLabel={null} nowMs={0}/>);
  expect(screen.getByText('0/0')).toBeInTheDocument();
  expect(within(screen.getByRole('group',{name:'Chỉ số sàn'})).getByText('—')).toBeInTheDocument();
 });
});
