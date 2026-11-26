export interface LivePresentationSnapshot {
  handId: string | null;
  actionKeys: string[];
  blindCount: number;
  blindsReady: boolean;
  seatCount: number;
  inProgress: boolean;
  present: (actionCount: number, dealing: boolean) => void;
  deal: () => void;
}

/** Serializes already-recorded actions. A fresh viewer starts at the current snapshot. */
export function createLivePresentationQueue() {
  let initialized = false;
  let handId: string | null = null;
  let actionKeys: string[] = [];
  let dealt = true;
  let tasks: Array<() => number> = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latest: LivePresentationSnapshot | null = null;

  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    tasks = [];
  };
  const drain = () => {
    const task = tasks.shift();
    if (!task) {
      timer = null;
      latest?.present(latest.actionKeys.length, !dealt);
      return;
    }
    timer = setTimeout(drain, task());
  };
  const submit = (snapshot: LivePresentationSnapshot) => {
    const newHand = handId !== snapshot.handId;
    const rewritten = !newHand && actionKeys.some((key, index) => snapshot.actionKeys[index] !== key);
    if (!initialized || rewritten || !snapshot.handId) {
      clear();
      initialized = true;
      handId = snapshot.handId;
      actionKeys = [...snapshot.actionKeys];
      dealt = true;
      latest = snapshot;
      snapshot.present(actionKeys.length, false);
      return;
    }
    if (newHand) {
      clear();
      actionKeys = [];
      dealt = !snapshot.inProgress;
      handId = snapshot.handId;
      snapshot.present(0, !dealt);
    }
    latest = snapshot;
    for (let count = actionKeys.length + 1; count <= snapshot.actionKeys.length; count++) {
      if (!dealt && count > snapshot.blindCount) {
        tasks.push(() => {
          snapshot.present(snapshot.blindCount, false);
          snapshot.deal();
          return snapshot.seatCount * 400 + 300;
        });
        dealt = true;
      }
      const hideCards = !dealt;
      tasks.push(() => {
        snapshot.present(count, hideCards);
        return 700;
      });
    }
    actionKeys = [...snapshot.actionKeys];
    if (!dealt && snapshot.blindsReady && snapshot.actionKeys.length === snapshot.blindCount) {
      tasks.push(() => {
        snapshot.present(snapshot.blindCount, false);
        snapshot.deal();
        return snapshot.seatCount * 400 + 300;
      });
      dealt = true;
    }
    if (timer === null) drain();
  };
  return {
    submit,
    reset() {
      clear();
      initialized = false;
      latest = null;
      handId = null;
      actionKeys = [];
      dealt = true;
    },
  };
}
