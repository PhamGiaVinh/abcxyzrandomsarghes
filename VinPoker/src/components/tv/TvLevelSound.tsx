import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TvData } from '@/types/tv';
import { enableTvLevelAudio, playTvCountdownTone, playTvLevelChime, stopTvLevelAudio } from '@/lib/sound';

export function TvLevelSound({ data }: { data: TvData | null }) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const countdown = useRef<{ tournament: string; level: string; second: number; running: boolean; heard: Set<number> } | null>(null);
  const previous = useRef<{ tournament: string; level: string } | null>(null);
  const tournament = data?.tournamentId ?? data?.tournamentName;
  const level = data?.currentLevel ? `${data.currentLevel.levelNumber}-${data.isBreak}` : null;
  const terminal = data?.status === 'finished' || data?.status === 'cancelled';
  const second = data && Number.isFinite(data.remainingSeconds) ? Math.max(0, Math.ceil(data.remainingSeconds)) : null;
  const running = data?.isRunning === true;
  const available = data !== null;
  useEffect(() => () => stopTvLevelAudio(), []);
  useEffect(() => { if (!enabled || !available) stopTvLevelAudio(); }, [enabled, available]);
  useEffect(() => {
    const last = countdown.current;
    if (!tournament || !level || second === null) { countdown.current = null; return; }
    const same = last?.tournament === tournament && last.level === level;
    const heard = same && second <= 6 ? last.heard : new Set<number>();
    countdown.current = { tournament, level, second, running, heard };
    // Never replay skipped seconds or a clock adjustment. Pauses/reconnects and
    // new tournaments establish a new baseline; only a progressing clock sounds.
    if (enabled && !terminal && same && running && last.running && second <= 6
      && last.second > second && last.second - second <= 2 && !heard.has(second)) {
      heard.add(second);
      void playTvCountdownTone(second === 0);
    }
  }, [tournament, level, second, running, enabled, terminal]);
  useEffect(() => {
    const last = previous.current;
    previous.current = level && tournament ? { tournament, level } : null;
    if (enabled && !terminal && level && last?.tournament === tournament && last.level !== level) {
      playTvLevelChime();
    }
  }, [tournament, level, enabled, terminal]);

  // The route keeps this controller mounted while its clock scene reloads.
  // Missing data clears the transition baseline, but never the user's audio opt-in.
  if (!data) return null;
  const enable = async (test: boolean) => {
    const ready = await enableTvLevelAudio();
    setEnabled(ready);
    setUnavailable(!ready);
    if (ready) {
      void playTvCountdownTone(false);
      if (test) void playTvCountdownTone(true, 0.4);
    }
  };
  const buttonClass = 'rounded-full border border-amber-200/40 bg-black/70 px-3 py-2 text-sm text-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200';
  return <div className="absolute right-3 top-12 z-20 flex flex-wrap justify-end gap-2" data-silent="true">
    <button type="button" aria-pressed={enabled} className={buttonClass}
      onClick={() => { if (enabled) { stopTvLevelAudio(); setEnabled(false); } else void enable(false); }}>
      {t(enabled ? 'tv.levelSoundOn' : 'tv.levelSoundOff')}
    </button>
    <button type="button" className={buttonClass} onClick={() => void enable(true)}>{t('tv.testSound')}</button>
    {unavailable ? <p role="alert" className="basis-full rounded bg-black/80 p-2 text-sm text-amber-100">{t('tv.soundUnavailable')}</p> : null}
  </div>;
}
