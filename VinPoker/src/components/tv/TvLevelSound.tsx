import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TvData } from '@/types/tv';
import { enableTvLevelAudio, playTvLevelChime } from '@/lib/sound';

export function TvLevelSound({ data }: { data: TvData }) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  const previous = useRef<{ tournament: string; level: string } | null>(null);
  const tournament = data.tournamentId ?? data.tournamentName;
  const level = data.currentLevel ? `${data.currentLevel.levelNumber}-${data.isBreak}` : null;
  const terminal = data.status === 'finished' || data.status === 'cancelled';
  useEffect(() => {
    const last = previous.current;
    previous.current = level ? { tournament, level } : null;
    if (enabled && !terminal && level && last?.tournament === tournament && last.level !== level) {
      playTvLevelChime();
    }
  }, [tournament, level, enabled, terminal]);

  return <button type="button" aria-pressed={enabled}
    className="absolute right-3 top-12 z-20 rounded-full border border-amber-200/40 bg-black/70 px-3 py-2 text-sm text-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
    onClick={async () => { if (enabled) setEnabled(false); else setEnabled(await enableTvLevelAudio()); }}>
    {t(enabled ? 'tv.levelSoundOn' : 'tv.levelSoundOff')}
  </button>;
}
