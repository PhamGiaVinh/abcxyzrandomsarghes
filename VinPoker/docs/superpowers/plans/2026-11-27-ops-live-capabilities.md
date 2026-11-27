# Ops — refresh permissions in an already-open workspace

Mode: CRITICAL, read-path authorization lifecycle. Base `23617d3ead5651c823b14db26226b54077da44be`. R01 invitation patch remains separate at `321ce16e79c8224c473c498a39c18e4a25379d2a` / Draft PR1819. No ownership-policy, migration, Edge, writer or flag change is included here.

## Observed failure

On an isolated real Auth/Deno/PostgREST/PostgreSQL stack, the receiver had Cashier A and Floor B. Owner B revoked Floor B through the real browser form and handler. The receiver's JWT capability RPC returned only Cashier A, but the already-open module selection page still displayed Floor after eight seconds. Original receipt and driver: `D:/Quy-trinh-hud-scale-evidence/ops-live-capability-20261127/failed-1718-open-receiver.json` and `runtime-1718.cjs`. The failed fixture is retained; do not replay its constructor.

The provider only refreshed on login/refocus/manual revision. Add periodic canonical verification without requiring those events. Keep an unchanged scope reference and its workspace draft. On revocation remove the invalid module/club through existing consumers; keep access valid elsewhere. Unknown authorization must close controls and allow recovery after a later authoritative read.

## Implementation and verification

- Poll every five seconds with a single active observation. A ten-second observation deadline is independent of interval ticks. Abort the real Supabase RPC/metadata request on completion/disposal and ignore old actor/effect results.
- Preserve existing verified-refocus behavior and actor ownership of scope. Canonical ordering and reference retention avoid unnecessary scope replacement. Retain metadata while its club ID set is unchanged; remove out-of-scope names immediately.
- Existing provider, loader and module-registry checks are retained. New component regressions cover autonomous revocation, stable drafts, hung observations/late results, unmount, Floor B withdrawal preserving Cashier A, and failed-read recovery. Mocked loader tests are not proof of network cancellation.
- Original-source RED regeneration uses a Promise-compatible abortSignal mock, then restores candidate bytes in finally. The first mock-incompatible attempt is preserved separately and does not count as a product failure. Current actual source RED has five failing new cases and six passing cases.
- Run full typecheck/build serially and actual real-Auth server/browser receiver journey on a fresh fixture. Save current source hashes, raw observations, independent review, screenshots, receiver JWT scope and mutation/event counts. No replay of old constructors.

## Limits and release

This affects the Ops capability provider and its existing consumers. It does not repair the separate legacy root Cashier membership cache, nor prove every module's export/Realtime delivery gate or full E05/E07 workload. Functional five-second checks do not establish p95 performance or load capacity. The poll adds canonical read traffic; qualify the required workload before claiming performance completion.

Keep a Draft PR until required checks and controlled critical-release approval identify the exact SHA. No DB/Edge apply or critical flag is required by this patch. A frontend rollback restores the previous stale-permission UI behavior; server authorization remains authoritative. Do not replay grant/revoke mutations as a rollback check. Production metadata and deployment connections remain separate release gates.
