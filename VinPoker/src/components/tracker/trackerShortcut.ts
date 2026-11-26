/** Dealer shortcuts only own focus on the page background or inside their dock. */
export function acceptsTrackerShortcut(event: KeyboardEvent, dock: HTMLElement | null) {
  if (!dock || event.defaultPrevented || event.isComposing || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return false;
  const target = event.target;
  if (!(target instanceof Element) || target === document.body || target === document.documentElement) return true;
  return dock.contains(target) && !target.closest('input,select,textarea,[contenteditable],[role="textbox"],[role="dialog"]');
}
