# Tracker action sounds — provenance

| File | Source clip | Meaning (owner mapping) |
|---|---|---|
| pot-collect.mp3 | IMG_1360.MP4 | Gom chip vào pot |
| deal-turn-river.mp3 | IMG_1361.MP4 | Chia bài turn / river |
| fold.mp3 | IMG_1362.MP4 | Fold (bỏ bài) |
| deal-flop.mp3 | IMG_1363.MP4 | Mở flop 3 lá |
| check.mp3 | IMG_1364.MP4 | Check |
| pot-award.mp3 | IMG_2431.MP4 | Trao pot cho người thắng |

- **Source:** owner-provided clips (Telegram, 2026-07-08), supplied by the product owner
  for use as VinPoker product sound assets. `IMG_2431.MP4` was supplied on 2026-09-12.
- **Usage:** VinPoker internal/product UI sound effects (tracker operator console + `/live` viewer).
- **Processing:** audio extracted from the MP4 clips with ffmpeg, silence-trimmed at the edges
  (−60 dB threshold, 0.3 s decay tail kept), mono 44.1 kHz, peak-normalized to −3 dBTP,
  encoded MP3 (libmp3lame `-q:a 3`).
- **pot-award.mp3 revision (2026-09-14):** preserves the complete 1.72-second audio
  track of IMG_2431.MP4 (no internal silence removal), +10 dB gain from the original
  -13.3 dB peak, 8 ms fade-in / 70 ms fade-out, mono 44.1 kHz MP3. This replaces
  the earlier truncated 0.86-second cue. Tracker playback volume is 1.0.

If the rights to any source clip later turn out to be unclear, remove the corresponding
MP3 and this entry; the sound engine falls back to its procedural synth automatically.

## Owner replacement cues — 2026-09-15

| Active file | Owner video | Extracted interval (seconds) | Decoded RMS / peak (dBFS) |
|---|---|---|---|
| hand-ranking-2536.mp3 | IMG_2536.MP4 | 1.06–2.88 | -24.3 / -4.7 |
| deal-turn-river-2535.mp3 | IMG_2535.MP4 | 0.85–1.23 | -27.0 / -2.0 |
| deal-flop-2534.mp3 | IMG_2534.MP4 | 2.29–2.87 | -24.9 / -2.5 |
| showdown-2533.mp3 | IMG_2533.MP4 | 0.00–0.58 | -24.3 / -2.3 |
| pot-award-2531.mp3 | IMG_2531.MP4 | 0.34–0.94 | -23.4 / -7.8 |

Supplied by the owner for these specific Tracker effects. Source video stays local;
only short audio cues ship. Flop preserves the three transients and their original
spacing; turn and river share the single-card cue. Keep internal silences intact.

FFmpeg: trim the intervals above, `loudnorm=I=-20:TP=-3:LRA=7`, then a -4 dB
adjustment for the award only, `alimiter=limit=0.56:level=0:latency=1`, 5 ms fade-in,
30 ms fade-out, mono 44.1 kHz, `libmp3lame -q:a 2`. Measurements above are after MP3
decode; encoded true peaks differ from the limiter ceiling. Filename revisions
avoid reusing cached earlier clips. Earlier assets are retained for rollback.

Automated validation checks decoded content and browser playback. Listening quality,
absence of background speech, and actual iPhone speaker output require owner UAT;
they are not established by these measurements.

Kenney Casino Audio (CC0), https://kenney.nl/assets/casino-audio. deal-one.mp3 is a trimmed card-slide-1.ogg. post-chip.mp3 is chip-lay-1.ogg.
