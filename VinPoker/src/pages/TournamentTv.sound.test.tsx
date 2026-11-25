import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { TvData } from '@/types/tv';
import TournamentTv from './TournamentTv';

const fixture = vi.hoisted(() => ({
  live: { state: 'ready', data: null as TvData | null, realtimeStatus: 'online' },
  redraw: { state: 'empty', data: null },
  enableTvLevelAudio: vi.fn(), playTvLevelChime: vi.fn(),
}));
vi.mock('react-router-dom', () => ({ useParams: () => ({ tournamentId: 'test' }), useSearchParams: () => [new URLSearchParams()] }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/hooks/useTournamentTvData', () => ({ useTournamentTvData: () => fixture.live }));
vi.mock('@/hooks/useTournamentRedrawTv', () => ({ useTournamentRedrawTv: () => fixture.redraw }));
vi.mock('@/lib/tv/mockTvData', () => ({ useMockTvData: () => null }));
vi.mock('@/lib/featureFlags', () => ({ FEATURES: { tournamentClockV2: true, floorRedrawSeatLockV1: true } }));
vi.mock('@/lib/sound', () => ({ enableTvLevelAudio: fixture.enableTvLevelAudio, playTvLevelChime: fixture.playTvLevelChime }));
vi.mock('@/components/tv/TvChrome', () => ({ TvChrome: ({ children, overlay }: { children: React.ReactNode; overlay: React.ReactNode }) => <>{children}{overlay}</> }));
vi.mock('@/components/tv/TvBroadcastBoard', () => ({ TvBroadcastBoard: () => <div>Clock</div> }));

it('keeps the audio opt-in across temporary clock screen removal and chimes on the next confirmed level', async () => {
  const data = { tournamentId: 'test', tournamentName: 'TEST', status: 'live', currentLevel: { levelNumber: 1 }, isBreak: false } as TvData;
  fixture.live.data = data;
  fixture.enableTvLevelAudio.mockResolvedValue(true);
  const { rerender } = render(<TournamentTv />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'tv.levelSoundOff' })));
  fixture.redraw.state = 'loading';
  rerender(<TournamentTv />);
  fixture.redraw.state = 'empty';
  rerender(<TournamentTv />);
  expect(screen.getByRole('button', { name: 'tv.levelSoundOn' })).toHaveAttribute('aria-pressed', 'true');
  fixture.live = { ...fixture.live, state: 'loading', data: null };
  rerender(<TournamentTv />);
  fixture.live = { ...fixture.live, state: 'ready', data };
  rerender(<TournamentTv />);
  expect(screen.getByRole('button', { name: 'tv.levelSoundOn' })).toHaveAttribute('aria-pressed', 'true');
  expect(fixture.playTvLevelChime).not.toHaveBeenCalled();
  fixture.live.data = { ...data, currentLevel: { ...data.currentLevel!, levelNumber: 2 } };
  rerender(<TournamentTv />);
  expect(fixture.playTvLevelChime).toHaveBeenCalledTimes(1);
});
