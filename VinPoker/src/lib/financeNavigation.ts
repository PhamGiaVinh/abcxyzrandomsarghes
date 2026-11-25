/** Carry report scope between work areas without copying action IDs or tab names. */
export function financeDestination(destination: string, currentSearch: string): string {
  const target = new URL(destination, "https://finance.invalid");
  const current = new URLSearchParams(currentSearch);
  for (const key of ["club", "from", "to"]) {
    const value = current.get(key);
    if (value !== null) target.searchParams.set(key, value);
  }
  return target.pathname + target.search;
}
