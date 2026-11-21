export function epochMicroseconds(value: string | null | undefined): bigint | null {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const milliseconds = Date.parse(match[1] + match[3]);
  if (!Number.isFinite(milliseconds)) return null;
  return BigInt(milliseconds) * 1_000n + BigInt((match[2] ?? "").padEnd(6, "0"));
}
