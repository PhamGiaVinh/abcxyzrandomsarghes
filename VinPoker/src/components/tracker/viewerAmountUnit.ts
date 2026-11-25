import { useSyncExternalStore } from "react";
import type { ViewerAmountUnit } from "@/lib/tracker-poker/viewerAmounts";

const key = "vinpoker.tracker.amount-unit";
const changed = "tracker-amount-unit-change";
let inMemoryUnit: ViewerAmountUnit | undefined;

function getUnit(): ViewerAmountUnit {
  if (inMemoryUnit) return inMemoryUnit;
  try {
    return window.localStorage.getItem(key) === "chips" ? "chips" : "bb";
  } catch {
    return "bb";
  }
}

function subscribe(listener: () => void) {
  window.addEventListener(changed, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(changed, listener);
    window.removeEventListener("storage", listener);
  };
}

export function toggleViewerAmountUnit() {
  const next = getUnit() === "bb" ? "chips" : "bb";
  try {
    window.localStorage.setItem(key, next);
    inMemoryUnit = undefined;
  } catch {
    // Keep the control usable when the browser blocks storage.
    inMemoryUnit = next;
  }
  window.dispatchEvent(new Event(changed));
}

export function useViewerAmountUnit(): ViewerAmountUnit {
  return useSyncExternalStore<ViewerAmountUnit>(subscribe, getUnit, () => "bb");
}
