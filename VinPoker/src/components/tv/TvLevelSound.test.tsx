import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { TvLevelSound } from './TvLevelSound';
import type { TvData } from '@/types/tv';
const audio = vi.hoisted(() => ({ enableTvLevelAudio: vi.fn(), playTvLevelChime: vi.fn() }));
vi.mock('@/lib/sound', () => audio);
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const data = { tournamentId: 't', currentLevel: { levelNumber: 1 }, isBreak: false, status: 'live' } as TvData;
it('plays once per confirmed transition after enabling, with no mount/reconnect/scope or mute chime', async () => {
 audio.enableTvLevelAudio.mockResolvedValue(true);
 const { rerender } = render(<TvLevelSound data={data} />);
 expect(audio.playTvLevelChime).not.toHaveBeenCalled();
 await act(async () => fireEvent.click(screen.getByRole('button')));
 rerender(<TvLevelSound data={{ ...data, remainingSeconds: 1 }} />);
 expect(audio.playTvLevelChime).not.toHaveBeenCalled();
 const next = { ...data, currentLevel: { ...data.currentLevel!, levelNumber: 2 } };
 rerender(<TvLevelSound data={next} />);
 rerender(<TvLevelSound data={{ ...next, remainingSeconds: 1199 }} />);
 expect(audio.playTvLevelChime).toHaveBeenCalledTimes(1);
 rerender(<TvLevelSound data={{ ...next, tournamentId: 'other' }} />);
 expect(audio.playTvLevelChime).toHaveBeenCalledTimes(1);
 await act(async () => fireEvent.click(screen.getByRole('button')));
 rerender(<TvLevelSound data={{ ...next, isBreak: true }} />);
 expect(audio.playTvLevelChime).toHaveBeenCalledTimes(1);
});

it('keeps sound disabled when the browser cannot unlock audio', async () => {
 audio.enableTvLevelAudio.mockResolvedValue(false);
 render(<TvLevelSound data={data} />);
 await act(async () => fireEvent.click(screen.getByRole('button')));
 expect(screen.getByRole('button')).toHaveAttribute('aria-pressed','false');
});
