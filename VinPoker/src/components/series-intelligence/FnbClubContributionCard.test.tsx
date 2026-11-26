import {cleanup, render, screen} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import type {FnbReport} from '@/hooks/useFnbReport';
import {FnbClubContributionCard} from './FnbClubContributionCard';

vi.mock('@/lib/featureFlags', () => ({FEATURES:{seriesEmptyExplainer:false}}));
afterEach(cleanup);
const window = {clubId:'TEST',fromIso:'2026-11-01T00:00:00Z',toIso:'2026-11-02T00:00:00Z',fromLabel:'01/11/2026',toLabel:'02/11/2026'};
const empty: FnbReport = {
  revenue:0,cogs:0,grossProfit:0,orderCount:0,statusCounts:{},topItems:[],lowStock:[],
  dailyTrend:[],compCount:0,compCogs:0,byTable:[],byPlayer:[],
};

it.each([
  [{revenue:-100000,cogs:-30000,grossProfit:-70000}, '−70k'],
  [{revenue:-100000,grossProfit:-100000}, '−100k'],
  [{compCount:1,compCogs:30000}, '−30k'],
  [{orderCount:1,revenue:100000,cogs:30000,grossProfit:70000}, '+70k'],
] as const)('shows contribution for verified refund, comp, and sale activity', (patch, expected) => {
  render(<FnbClubContributionCard window={window} report={{...empty,...patch}} loading={false} error={false} />);
  expect(screen.getByText(expected)).toBeInTheDocument();
  expect(screen.queryByText(/tổng ròng bằng 0/)).toBeNull();
});

it('separates an empty report from a net zero day with activity', () => {
  const view = render(<FnbClubContributionCard window={window} report={empty} loading={false} error={false} />);
  expect(screen.getByText(/tổng ròng bằng 0/)).toBeInTheDocument();
  view.rerender(<FnbClubContributionCard window={window} report={{...empty,dailyTrend:[{date:'2026-11-01',revenue:0,cogs:0}]}} loading={false} error={false} />);
  expect(screen.getByText('+0')).toBeInTheDocument();
});

it('keeps failed and loading states separate from an empty report', () => {
  const view = render(<FnbClubContributionCard window={window} report={empty} loading={true} error={false} />);
  expect(view.container.querySelector('[aria-busy="true"]')).toBeTruthy();
  view.rerender(<FnbClubContributionCard window={window} report={empty} loading={false} error={true} />);
  expect(screen.getByText(/Chưa đọc được dữ liệu F&B/)).toBeInTheDocument();
  expect(screen.queryByText(/tổng ròng bằng 0/)).toBeNull();
});
