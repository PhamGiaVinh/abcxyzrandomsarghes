import { readFileSync } from "node:fs";

const markers = [
  "upstream timed out",
  "connect() failed",
  "no live upstreams",
  "could not be resolved",
  "failed to get a peer",
  "upstream prematurely closed connection",
  "Connection reset by peer",
  "too many open files",
  "Too many open files",
  "worker process exited",
  "worker_connections are not enough",
  "accept4() failed",
  "socket() failed",
  "upstream sent too big header",
];

const counts = Object.fromEntries(markers.map((marker) => [marker, 0]));
const events = [];
for (const line of readFileSync(0, "utf8").split("\n")) {
  const matched = markers.filter((marker) => line.includes(marker));
  if (!matched.length) continue;
  for (const marker of matched) counts[marker]++;
  const timestamp = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s/)?.[1];
  const at = Date.parse(timestamp);
  const upstreamPort = line.match(/\bupstream: "https?:\/\/(?:\[[\da-f:]+\]|[\w.-]+):(\d{1,5})\//i)?.[1];
  events.push({ at: Number.isFinite(at) ? at : null, markers: matched, upstreamPort: upstreamPort ? Number(upstreamPort) : null });
}

process.stdout.write(JSON.stringify({
  kind: "SANITIZED_ISOLATED_GATEWAY_FAILURE_CLASSIFICATIONS",
  qualification: false,
  markers: counts,
  events: events.slice(-100),
  omittedEvents: Math.max(0, events.length - 100),
  limitations: "Bounded Docker log timestamps and upstream ports support correlation, without identifying individual requests.",
}));
