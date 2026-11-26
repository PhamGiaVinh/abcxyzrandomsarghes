type DealerVoiceReadoutProps = {
  statusLabel: string;
  partial: string;
  finalTranscript: string;
};

export function DealerVoiceReadout({ statusLabel, partial, finalTranscript }: DealerVoiceReadoutProps) {
  return (
    <div className="min-w-0 border-b border-emerald-200/15 px-3 py-2 text-xs">
      <p className="font-medium text-emerald-200">{statusLabel}</p>
      {partial && <p className="mt-1 break-words text-zinc-300">Đang nghe · {partial}</p>}
      {finalTranscript && <p className="mt-1 break-words text-white">Đã nghe · {finalTranscript}</p>}
    </div>
  );
}
