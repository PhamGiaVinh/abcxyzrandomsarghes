export type AcquireChipSetupWrite = () => (() => void) | null;

/** One synchronous owner across Setup cards, before React can render disabled controls. */
export function createChipSetupWriteGate(onBusy: (busy: boolean) => void): AcquireChipSetupWrite {
  let owner: object | null = null;
  return () => {
    if (owner) return null;
    const token = {};
    owner = token;
    onBusy(true);
    return () => {
      if (owner !== token) return;
      owner = null;
      onBusy(false);
    };
  };
}
