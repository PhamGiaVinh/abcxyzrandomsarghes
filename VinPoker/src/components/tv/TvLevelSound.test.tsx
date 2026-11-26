import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { TvLevelSound } from './TvLevelSound';
import type { TvData } from '@/types/tv';
const audio = vi.hoisted(() => ({ enableTvLevelAudio: vi.fn(), playTvLevelChime: vi.fn(), playTvCountdownTone: vi.fn(), stopTvLevelAudio: vi.fn() }));
vi.mock('@/lib/sound', () => audio);
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const data = { tournamentId: 't', currentLevel: { levelNumber: 1 }, isBreak: false, isRunning: true, remainingSeconds: 70, status: 'live' } as TvData;
const toggle = () => screen.getByRole('button', { name: /tv.levelSound(On|Off)/ });
beforeEach(() => vi.clearAllMocks());
it('plays once per confirmed transition after enabling, with no mount/reconnect/scope or mute chime', async () => {
 audio.enableTvLevelAudio.mockResolvedValue(true);
 const { rerender } = render(<TvLevelSound data={data} />);
 expect(audio.playTvLevelChime).not.toHaveBeenCalled();
 await act(async () => fireEvent.click(toggle()));
 rerender(<TvLevelSound data={{ ...data, remainingSeconds: 1 }} />);
 expect(audio.playTvLevelChime).not.toHaveBeenCalled();
 const next = { ...data, currentLevel: { ...data.currentLevel!, levelNumber: 2 } };
 rerender(<TvLevelSound data={next} />);
 rerender(<TvLevelSound data={{ ...next, remainingSeconds: 1199 }} />);
 expect(audio.playTvLevelChime).toHaveBeenCalledTimes(1);
 rerender(<TvLevelSound data={{ ...next, tournamentId: 'other' }} />);
 expect(audio.playTvLevelChime).toHaveBeenCalledTimes(1);
 await act(async () => fireEvent.click(toggle()));
 rerender(<TvLevelSound data={{ ...next, isBreak: true }} />);
 expect(audio.playTvLevelChime).toHaveBeenCalledTimes(1);
});

it('keeps sound disabled when the browser cannot unlock audio', async () => {
 audio.enableTvLevelAudio.mockResolvedValue(false);
 render(<TvLevelSound data={data} />);
 await act(async () => fireEvent.click(toggle()));
 expect(toggle()).toHaveAttribute('aria-pressed','false');
});

it('retains opt-in but does not replay a missed transition after a read outage', async () => {
 audio.enableTvLevelAudio.mockResolvedValue(true);
 const { rerender } = render(<TvLevelSound data={data} />);
 await act(async () => fireEvent.click(toggle()));
 rerender(<TvLevelSound data={null} />);
 expect(screen.queryByRole('button')).not.toBeInTheDocument();
 rerender(<TvLevelSound data={{ ...data, currentLevel: { ...data.currentLevel!, levelNumber: 2 } }} />);
 expect(toggle()).toHaveAttribute('aria-pressed', 'true');
 expect(audio.playTvLevelChime).not.toHaveBeenCalled();
});

it('sounds six short ticks and one long expiry tone exactly once, without requiring a level change', async () => {
 audio.enableTvLevelAudio.mockResolvedValue(true);
 const { rerender } = render(<TvLevelSound data={{ ...data, remainingSeconds: 7 }} />);
 await act(async () => fireEvent.click(toggle()));
 audio.playTvCountdownTone.mockClear();
 for (const second of [6, 6, 5, 4, 3, 2, 1, 0, 0]) {
   rerender(<TvLevelSound data={{ ...data, remainingSeconds: second }} />);
 }
 expect(audio.playTvCountdownTone.mock.calls).toEqual([[false], [false], [false], [false], [false], [false], [true]]);
 expect(audio.playTvLevelChime).not.toHaveBeenCalled();
});

it('does not sound on initial expired data, pauses, missing data, tournament changes, or a large clock correction', async () => {
 audio.enableTvLevelAudio.mockResolvedValue(true);
 const { rerender } = render(<TvLevelSound data={{ ...data, remainingSeconds: 0 }} />);
 await act(async () => fireEvent.click(toggle()));
 audio.playTvCountdownTone.mockClear();
 for (const next of [
   { ...data, remainingSeconds: 7 },
   { ...data, remainingSeconds: 6, isRunning: false },
   { ...data, remainingSeconds: 5, isRunning: false },
   null,
   { ...data, remainingSeconds: 3 },
   { ...data, tournamentId: 'other', remainingSeconds: 2 },
   { ...data, remainingSeconds: 70 },
   { ...data, remainingSeconds: 4 },
 ]) rerender(<TvLevelSound data={next} />);
 expect(audio.playTvCountdownTone).not.toHaveBeenCalled();
});

it('offers an immediate speaker test and cancels TV tones when muted', async () => {
 audio.enableTvLevelAudio.mockResolvedValue(true);
 render(<TvLevelSound data={data} />);
 await act(async () => fireEvent.click(screen.getByRole('button', { name: 'tv.testSound' })));
 expect(toggle()).toHaveAttribute('aria-pressed', 'true');
 expect(audio.playTvCountdownTone.mock.calls).toEqual([[false], [true, 0.4]]);
 audio.stopTvLevelAudio.mockClear();
 await act(async () => fireEvent.click(toggle()));
 expect(audio.stopTvLevelAudio).toHaveBeenCalled();
});
