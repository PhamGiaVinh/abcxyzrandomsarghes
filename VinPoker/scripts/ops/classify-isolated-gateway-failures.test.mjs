import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const classifier = fileURLToPath(new URL("./classify-isolated-gateway-failures.mjs", import.meta.url));
const gatewayEvent = '2026-11-21T12:05:41.380123456Z [error] Connection reset by peer, upstream: "http://172.18.0.4:3000/private?token=FAKE_SECRET"';

function classify(lines) {
  return JSON.parse(execFileSync(process.execPath, [classifier], { input: lines.join("\n") }));
}

test("matches gateway timestamps to HTTP failures without exporting upstream addresses or request data", () => {
  const report = classify([gatewayEvent, "no live upstreams", "normal request"]);
  assert.deepEqual(report.events, [
    { at: Date.parse("2026-11-21T12:05:41.380Z"), markers: ["Connection reset by peer"], upstreamPort: 3000 },
    { at: null, markers: ["no live upstreams"], upstreamPort: null },
  ]);
  assert.doesNotMatch(JSON.stringify(report), /172\.18|FAKE_SECRET|\/private/);
});

test("reports omitted timestamps while counting every matching log line", () => {
  const report = classify(Array(107).fill(gatewayEvent));
  assert.equal(report.events.length, 100);
  assert.equal(report.omittedEvents, 7);
  assert.equal(report.markers["Connection reset by peer"], 107);
});
