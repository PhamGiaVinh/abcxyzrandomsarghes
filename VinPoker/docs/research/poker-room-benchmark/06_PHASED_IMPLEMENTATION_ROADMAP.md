# Phased implementation roadmap — owner review packet

Đây là kế hoạch sau audit, **chưa triển khai**. Source baseline `af51adc256855e3319d9dc4794ead8ca74d9537d`; findings [05](05_GAP_AND_RISK_REGISTER.md), evidence [02](02_VINPOKER_CAPABILITY_INVENTORY.md)/[03](03_SKILL_BY_SKILL_CODE_AUDIT.md). Trước mỗi task implementation phải refresh baseline và kiểm tra handoff/writer. Không replay migration archive hoặc copy third-party code.

**Tracker/Dealer Swing:** `IN_PROGRESS_OTHER_SESSION`. Runtime forecast-close repair/migration 81 do session `Respond to greeting` sở hữu. Không giao writer khác sửa song song. Roadmap chỉ tiếp nhận receipt của họ và tránh trùng phần họ đã hoàn thành. Không áp dụng các đề xuất dưới đây như lệnh production.

## Thứ tự và readiness

| Phase | PR/candidate | Dependency | Acceptance exit | Readiness |
|---|---|---|---|---|
| 0 — Authority/source foundation | R00 per-function source/live contract reconciliation; tiếp nhận ongoing session receipt | Metadata/current schema được phép đọc | Body/ACL/consumer/provenance được xác định; findings confirmed/dismissed/blocked rõ | READY for scoped research; live probe requires defined access |
| 1 — Small proven fixes | R01 retired runtime cleanup; R03 finance unavailable-vs-zero boundary | R00 for finance contract; App ownership clear for R01 | Focused behavior tests/build/UI scope pass; no unrelated change | CONDITIONAL; critical scope gate where affected |
| 2 — Reliable tournament setup | R02A atomic standard draft+levels; R02B table-link intent | R00 + ongoing floor/dealer handoff | All-or-none draft/link writes; stale/live/foreign scope refused | CONDITIONAL / CRITICAL |
| 3 — Read models and measured operations | R04 Employee read contract; R06 one performance slice; R08 payout apply qualification | R00; relevant writers free | Identity/privacy gates, reproducible measurements or NOT_MEASURED, payout authority mapped | CONDITIONAL; no feature inflation |
| 4 — Customer/source trust | R05 editorial provenance; R07 waitlist contract-only then optional slice | R00; existing series contract; owner cash-vs-tournament choice | Source revision/review and queue lifecycle defined; no auto-operation | CONDITIONAL |
| 5 — Existing automation completion | R09 digest readiness/cutover work | R00 + source health; license/budget decision if commercial | Canonical snapshot/outbox/persistence/delivery ownership verified with approved tests | NOT_READY for real dispatch/production |

Không đặt deadline toàn platform. Ước tính bên dưới là **engineering person-days** (1 ngày≈6 giờ tập trung) cho người biết repo, không gồm thời gian chờ access/UAT/license hoặc sửa schema drift lớn. Không cộng thành lời hứa delivery; các task có thể bị stop/dismiss khi current main đã sửa hoặc contract gate fail.

## Business prioritization

1 thấp, 5 cao. Value = potential reduction of error/time/onboarding effort; effort = scope/unknowns; risk = operational/privacy/write impact; maintenance = continuing ownership burden. Đây là expert hypotheses từ source, chưa có staff-hours/ROI/client telemetry để xác nhận. Higher value không tự vượt safety gate.

| Candidate | Value | Effort | Risk | Maintenance | Cơ sở và giả định |
|---|---:|---:|---:|---:|---|
| R00 | 5 | 2 | 1 | 1 | Tránh duplicate unsafe rewrites/releases; read-only verification, cần metadata access |
| R01 | 3 | 2 | 2 | 1 | Owner đã retire GTO; source boot còn code; chưa đo savings |
| R02 | 5 | 4 | 5 | 3 | Separate writes có thể làm config/bàn lệch; assumes operator uses affected path |
| R03 | 4 | 2 | 3 | 1 | Ngăn owner thấy false zero khi malformed success; tiền chỉ hiển thị, không tính mới |
| R04 | 4 | 2 | 2 | 2 | Truy nguồn nhân viên/lương dễ hơn; value cần phỏng vấn owner, prototype gated |
| R05 | 3 | 3 | 2 | 2 | Lịch nguồn rõ/fresh; assumes editorial schedule là nhu cầu thật |
| R06 | 3 | 2 | 2 | 1 | Tìm một bottleneck thật; có thể không tìm thấy và stop |
| R07 | 3 | 4 | 4 | 3 | Customer queue thuận tiện; demand/cash-vs-tournament chưa quyết định |
| R08 | 5 | 3 | 1 | 2 | Xác minh payout apply/chốt, tests isolated; any repair production remains critical |
| R09 | 4 | 3 | 3 | 2 | Reuse digest foundation; giả định có operator cần report và license phù hợp |

**Ưu tiên thương mại:** reliability/setup/source-of-data giúp onboarding CLB và giảm support trước tính năng AI/desktop. Cloud costs/legal compliance/nhân sự tiết kiệm chưa đo; không bịa monetary ROI hoặc định giá SaaS từ competitor documents.

## R00 — Function authority and deployment provenance map

1. **Feature ID / priority:** R00, P0 verification priority; HIGH VALUE / foundation.
2. **Business problem:** khó biết body/ACL nào thật đang phục vụ staff/cashier/payroll; có nguy cơ sửa/cài lại contract sai.
3. **Current behavior:** G03/G04/G06; legacy active-source bodies và hardening archive không chứng minh live state. Newer secure mutation contracts phải giữ.
4. **Reference:** A1 upstream-versus-local evidence distinction; B2 auth granularity; VinPoker migration-control là pattern chính.
5. **Proposed architecture:** documentation-only object map cho 6–8 functions scoped (cashier scope, payroll read, staff check-in/out, digest read/scope, payout prepare/apply if present). Body hash + owner + search_path + grants + callers + artifact/version provenance; không tạo registry runtime mới.
6. **Likely files:** docs/research evidence; read `useDealerPayroll.ts`, `CashierDashboard.tsx`, staff/digest adapters, migration-control/archive; future fixes own branch separately.
7. **DB/RPC/Edge impact:** read-only approved catalog metadata; không bulk backup/private rows; zero DDL. If live unavailable, explicit NOT_VERIFIABLE.
8. **Security/privacy:** inspect no player/payroll rows/secrets; check function privileges/actor-object club and current grants. Resolve P1 hypotheses before release recommendations.
9. **Dependency:** access to exact target metadata/approved schema; ongoing session final receipt.
10. **Steps:** reserve function scope → map source/callers → obtain sanitized definition/ACL → compare supersessions → mark confirmed/dismissed → prepare one narrow forward fix only if actual gap.
11. **Tests:** static link/hash consistency, later disposable role tests for confirmed mismatch; no adversarial production mutation.
12. **Acceptance:** each scoped function mapped to latest body/ACL/consumer, every unknown explicit; no historical body falsely called live.
13. **Rollback:** revert docs only; no data to restore. Any later guard repair has its own rollback preserving audit/history.
14. **Effort:** 1–3 days if catalog access available; else 0.5–1 day source map with live blocker.
15. **PR:** docs-only R00; do not mix actual auth guard repair into it.
16. **Owner approval:** no new source research approval; explicit scope/access for live read if needed; confirmed auth/payroll implementation and release are separate CRITICAL decisions under this research plan.

## R01 — Remove confirmed retired GTO startup surface

1. **ID/priority:** R01, P2 QUICK WIN; ownership gate first.
2. **Problem:** retired feature still initiates ordinary app work.
3. **Current:** G07/V28; boot initRemoteRanges and editor route remain at baseline.
4. **Reference:** no external engine to adopt; dead-feature hygiene reinforced by A4 documentation/code mismatch.
5. **Architecture:** delete dead entry/import/routes/obsolete tests; retain shared math/types and historical DB; no framework.
6. **Files:** App.tsx, GTO-only components/hooks/precomputed consumers after full caller trace; docs for retained shared references.
7. **DB/RPC/Edge:** no migration/drop/functions deploy; runtime calls only removed for dead feature.
8. **Security:** preserve auth/navigation/server game and card logic; no bulk deletion by `gto` grep.
9. **Dependencies:** current main search; App/Tracker session releases writer ownership; retirement decision already owner-confirmed.
10. **Steps:** footprint classification → shared caller review → smallest dead-path removal → second search → verify affected startup/navigation.
11. **Tests:** focused startup/Tournament/Dealer/Floor/Cashier/LiveTracker smoke, build/typecheck by actual config; no test preserves retired editor.
12. **Acceptance:** ordinary startup has no retired GTO fetch/subscription; remaining references classified; compare requests/bytes only on same fixture if measured.
13. **Rollback:** revert app-only PR; historical DB unchanged.
14. **Effort:** 0.5–2 days, depending shared consumers/current cleanup status.
15. **PR:** one dead-runtime cleanup; no redesign/performance refactor.
16. **Approval:** no implementation beyond current research; future task impact classification governs release, server/game changes excluded.

## R02 — Canonical tournament setup, split into two PRs

1. **ID/priority:** R02A draft+levels, R02B draft/table links; P1 HIGH VALUE / HIGH RISK.
2. **Problem:** partial creates/config links increase operator recovery and can affect current table lifecycle.
3. **Current:** G01/G02; standard separate inserts and legacy link deletes; multiday RPC already exists.
4. **Reference:** B1 setup validation, B3 deterministic utility test scenarios; primary canonical patterns are VinPoker V05/V08/V10.
5. **Architecture:** reuse/extend exact canonical setup RPC if existing contract allows. R02A commit draft/levels as one transaction. R02B bind selected physical asset/link/session intent and refuse live reassignment. Actor/club/current revision/request hash receipt server-side; no client authority.
6. **Files:** TournamentManagerShared.tsx, useTournaments.ts, TournamentConfigPage.tsx; a new migration only if no suitable existing RPC; existing tests/ops setup harness.
7. **DB/RPC/Edge:** likely new/extended RPC; no blanket schema rewrite; new migration/version reservation/catalog precheck, isolated DB validation. Edge only if current owner path requires it.
8. **Security:** derive club from objects; validate fee/price snapshot without changing amounts; no movement/chip result writes as side effect. Keep table_session identity distinct from link.
9. **Dependencies:** R00 + Floor/Dealer ongoing receipt; owner decision recoverable draft vs atomic draft; map compatibility before changing API.
10. **Steps:** create fault test on present flow → define exact intent → server transaction/receipt → wire one consumer → verify rollback/retry → second link PR separately.
11. **Tests:** failure after write/link, same key same/different payload, concurrent asset claim, stale revision, foreign club, invalid levels, no transfer of occupied/live tables; money fields unchanged.
12. **Acceptance:** all-or-none in intended scope; retry returns same draft/outcome; no orphan links or duplicate drafts from acknowledged retry; safe rollback on stale state.
13. **Rollback:** disable new consumer, restore reviewed safe path/draft mode; retain receipts/audit, no deletion of created business records. If old path unsafe, keep write disabled rather than restore known flaw.
14. **Effort:** R02A 2–4 days; R02B 3–6 days after identity contract clear; schema drift/access/UAT extra.
15. **PRs:** A and B separate, source/test migration together per narrow contract; no combined payroll/dealer repair.
16. **Approval:** CRITICAL owner implementation scope and exact release SHA/migration/flag per separate approved task; current audit does not grant these actions.

## R03 — Finance response integrity: confirmed zero versus unavailable

1. **ID/priority:** R03, P2 QUICK WIN.
2. **Problem:** malformed successful RPC can display false financial zero.
3. **Current:** G05, missing fields → Number(...??0); RPC errors already thrown.
4. **Reference:** VinPoker strict digest/source-health parsers, A2 ambiguous-empty ingestion rejection.
5. **Architecture:** one boundary parser matching existing finance RPC shape; mark malformed/partial unavailable, no client recalculation. Contract actual numeric types must be verified.
6. **Files:** useFinanceSummaryRpcOnly.ts, existing accountant report error state; focused tests.
7. **DB/RPC/Edge:** none if current response contract sufficient; do not widen grants or expose new private data.
8. **Security:** maintain scoped reads; verify no hidden totals/private payroll shown by error details.
9. **Dependency:** R00 finance response contract/current consumer inventory.
10. **Steps:** define failure fixture → reuse parse convention → map UI reason → validate valid zero and compatibility.
11. **Tests:** null/missing/partial/NaN/invalid integer; valid zeros; denied/network reads; role/club-switch state correctness if touched.
12. **Acceptance:** no unavailable data labeled zero; existing valid totals byte-for-byte equivalent.
13. **Rollback:** revert parser/UI only if prior malformed-zero behavior is acceptable; otherwise retain explicit unavailable. No data rollback.
14. **Effort:** 0.5–1.5 days after shape confirmed.
15. **PR:** one adapter/report-boundary fix; no finance formulas or broad dashboard redesign.
16. **Approval:** source prep in separate task; finance/privacy impact assessed before release, CRITICAL if authorization/financial semantics change.

## R04 — Employee contract map, gated read-only projection

1. **ID/priority:** R04, P2 HIGH VALUE contingent on demand.
2. **Problem:** owner cannot readily trace one staff identity to approved attendance/work/payroll statement.
3. **Current:** G06/G12, multiple legitimate identity domains and archive-backed consumers; no demonstrated duplicate records.
4. **Reference:** B2 explicit event/participant entities; not an HRM backend template. VinPoker existing staff/dealer contracts dominate.
5. **Architecture:** map identity→employment→attendance→approved work→locked payroll→statement. Projection only after identity, club scope, payroll privacy, and no invented schema all PASS. Any gate fails: deliver contract only.
6. **Files:** staff/dealer hooks, accountant staff directory, existing payroll/statement sources; optional new read-only view component after gates.
7. **DB/RPC/Edge:** default none; if read RPC needed it becomes separately reviewed critical change, no employee schema invention.
8. **Security:** owner/accountant role matrix; dealer own statement versus other's private salary; current membership check and club scope.
9. **Dependencies:** R00; workforce session handoff; explicit canonical mapping.
10. **Steps:** field/source table → identity/privacy proof → optional read-only prototype → show source/date/status for key amounts.
11. **Tests:** Owner A cannot see B; dealer A cannot see another's payroll; revoked membership; missing/unlinked source explicit.
12. **Acceptance:** source-traceable values, no salary/attendance edits; STOP_AT_CONTRACT is valid outcome if gates fail.
13. **Rollback:** remove/hide projection only; no canonical tables mutated.
14. **Effort:** contract 1–2 days; UI 1–3 extra if gates PASS.
15. **PRs:** contract evidence first; projection separately; no full HRM build.
16. **Approval:** research already authorized; later private-data UI/read RPC needs approved scope/role UAT, no automatic production access expansion.

## R05 — Editorial event provenance using existing Series Market

1. **ID/priority:** R05, P2 QUICK WIN first display / LONG TERM import.
2. **Problem:** editorial schedule lacks selected revision/freshness evidence context.
3. **Current:** G09; InternationalEvents website URL and edits differ from existing rich Series Market sources.
4. **Reference:** A2 source-handoff/challenge/redirect tests; unverified competitor claims excluded.
5. **Architecture:** reuse SourceDocument/SourceRevision/SourceClaim; associate curated editorial fact with reviewed source reference. Start display-only link/as-of/review state; no unattended scraper.
6. **Files:** InternationalEvents.tsx, existing series-market contracts/evidence sheet/adapters; minimal association migration only if current storage cannot represent link.
7. **DB/RPC/Edge:** initial none; later reviewed editorial association/import requires scoped migration, not operational tournament creation.
8. **Security/privacy:** public schedule only; source terms/rights review before collection; no player PII or arbitrary URLs as execution targets.
9. **Dependencies:** existing provenance schema/consumer map; editor ownership and source allowlist.
10. **Steps:** field-to-claim mapping → read projection → manual source revision review → optional sanitized import dry run.
11. **Tests:** changed venue/date/redirect, challenge body, ambiguous empty, duplicate import identity, conflicting evidence, stale source.
12. **Acceptance:** facts show auditable source/date/review, conflicts explicit; no operational write from external data.
13. **Rollback:** remove display link/import consumer, keep reviewed source history; no deletion of corrections.
14. **Effort:** display/contract 1–2 days; optional import 3–5 days with rights/access resolved.
15. **PRs:** display/association then offline import scenarios separately.
16. **Approval:** no external scraping/install authorized now; rights/data acquisition and new DB/write scope approved separately.

## R06 — One measurable client operations slice

1. **ID/priority:** R06, P2, conditional QUICK WIN.
2. **Problem:** potential broad refetch/history query cost, no present measurements.
3. **Current:** G10; query filters/fences/cleanup exist. No proof of client latency/backend bottleneck.
4. **Reference:** Pulse projector split and imported-function tests; no external perf claim.
5. **Architecture:** same controlled fixture/device/revision/tasks baseline; record request count/bytes/subscriptions/render/latency/errors; fix only reproduced root cause through existing query/coalescing pattern.
6. **Files:** exact single hook/view identified after baseline, likely useTournaments/useTournamentTvDataCore or viewer; no broad refactor.
7. **DB/RPC/Edge:** default none. Query/index/realtime contract change requires separate critical scope if evidence supports it.
8. **Security:** actor+club cache scope, stale snapshot fences, private/public data distinction retained.
9. **Dependencies:** Tracker writer handoff; ability to reproduce same fixture/browser.
10. **Steps:** baseline → repro → smallest fix → same after measurement → correctness regression check.
11. **Tests:** 375/430/desktop, navigation/back/refresh/reconnect/error; server tests separately if contract touched.
12. **Acceptance:** reproducible measured gain with conditions; else NOT_MEASURED/no speculative code. Backend/concurrent viewer capacity remains NOT_MEASURED.
13. **Rollback:** revert isolated change; preserve gates/fences.
14. **Effort:** 0.5–2 days measurement; 0–2 extra only for measured fix.
15. **PR:** evidence first; one concrete fix if justified. No test of 2.000 production viewers.
16. **Approval:** current audit no runtime QA; future task scoped appropriately; no real chip/seat/financial actions to benchmark.

## R07 — Explicit waitlist/CRM contract before customer feature

1. **ID/priority:** R07, P2 HIGH VALUE hypothesis / HIGH RISK if seating/send activated.
2. **Problem:** dedicated waitlist control is stub; unclear cash queue versus tournament entry waiting versus seat-change intent.
3. **Current:** G08/G12; existing registration queue and canonical entries remain authoritative.
4. **Reference:** A1 join/position/arrive/leave UI; reject Arena count+1 join authority and B2 inverse-remove bug.
5. **Architecture:** contract-only first: opaque ticket, object-derived club/queue type, waiting→notified→arrived→cancelled/expired lifecycle, consent/minimal contact retention. Server claim/receipt if later commit; queue position advisory, no implied payment/seat guarantee.
6. **Files:** PlayerActionSheet, current registration queue/member identity adapters; optional queue tables/RPC only after proven gap and business choice.
7. **DB/RPC/Edge:** contract none; later queue writes likely new scoped RPC, send through existing approved notification owner, seat transition canonical.
8. **Security:** tenant + owner/self policies, revoked membership, PII retention, channel consent; QR/deep link carries no permission.
9. **Dependencies:** R00 identities/authority; owner chooses one queue type; existing writer handoff.
10. **Steps:** customer/staff task map → canonical data/privacy map → one queue contract → optional one club/test slice.
11. **Tests:** concurrent join/cancel/claim, duplicate key, expiry/timezone, role/club mismatch, stale seat availability, opt-out; no auto-payment.
12. **Acceptance:** only approved queue purpose implemented, no conflating entry/ticket/seat, same retry same outcome, privacy matrix PASS.
13. **Rollback:** disable new UI/send, preserve ticket audit and accepted existing registrations; no delete financial records.
14. **Effort:** contract 1–2 days; selected queue slice 4–7 days after approval, provider/seat UAT extra.
15. **PRs:** contract then queue source/test then UI; don't bundle CRM segmentation/rewards/marketing campaign.
16. **Approval:** business queue choice and CRITICAL implementation/release scope required; current research grants neither send nor seat mutation.

## R08 — Payout and table-plan qualification, preserve existing algorithms

1. **ID/priority:** R08, P1 HIGH VALUE qualification, no runtime feature yet.
2. **Problem:** calculator tests/types don't prove current server payout application; external shortcuts can regress conservation/fairness.
3. **Current:** V23 real-import payout tests; expected main payout migration missing; V08 already balanced break planner + hash/revision fences.
4. **Reference:** B1 multiplier failure, Pulse rounding/residue and helper-local tests, B5 repeat elimination.
5. **Architecture:** trace canonical payout prepare/apply RPC/current body and entry model; reuse imported calculator tests as oracle where authorized; compare approved table-plan invariants, no algorithm replacement.
6. **Files:** payoutEngine/tests, actual payout RPC source discovered by R00, floor plan tests; no shared rewrite.
7. **DB/RPC/Edge:** isolated qualification reads/tests; any confirmed fix becomes separate new migration, never replay dryrun SQL against live.
8. **Security:** money conservation, actor/club/locked state, immutable paid results; correct entry ID, not name/count.
9. **Dependencies:** R00 + session handoff and sanitized current-schema fixture.
10. **Steps:** map authority → import real functions → isolated double-click/concurrent/rounding cases → register confirmed gap or PASS contract.
11. **Tests:** Σ payouts = approved pool, monotone/min cash, exact rounding residual, duplicate/same request, locked state, foreign club; seat lock/current hand constraints for balance.
12. **Acceptance:** clear prepare/apply provenance and runtime results on isolated fixture; no conclusion from helper-local tests/types alone.
13. **Rollback:** tests/docs revert only; any fix has own audit-preserving forward rollback, no recalculation of paid results.
14. **Effort:** 2–4 days with current schema; gaps/access can stop at contract.
15. **PRs:** payout qualification separate from floor-plan explanation/tests and any money fix.
16. **Approval:** scoped isolated tests in a future task; actual money-path change/apply/release separately CRITICAL.

## R09 — Complete existing digest automation readiness

1. **ID/priority:** R09, P2 LONG TERM until core/reliability receipts clear.
2. **Problem:** owner needs trustworthy daily overview, but existing source foundation ≠ working production delivery.
3. **Current:** V19/V26 existing digest/snapshot/event contracts, HMAC, Gateway, ownership registry, mock/test-shadow code; do not build duplicate n8n platform.
4. **Reference:** A2 freshness/handoff negative scenarios; no external deployment spec as runtime authority.
5. **Architecture:** existing canonical snapshot/outbox → scoped Gateway → internal orchestrator → durable enqueue → server delivery owner. Existing native P0 remains independent.
6. **Files:** automation-platform existing contracts/gateway/digest/store/workflow tests, owner digest read sources; authoritative source objects mapped by R00.
7. **DB/RPC/Edge:** no new layer by default; readiness fixes scoped to actual mismatch; production scheduler/provider credentials/server apply require separate release approval.
8. **Security/privacy:** sanitized aggregates, no per-person salary/contact/bank details in worker execution; tenant/consent/kill switches; unknown provider reconcile before retry.
9. **Dependencies:** R00, canonical snapshot proof, license confirmation for commercial model, explicit cost budget/test recipients.
10. **Steps:** inspect existing checkpoint → isolated local/runtime restore test → shadow parity → defined canary request → only approved cutover.
11. **Tests:** server schedule while worker off, rollback/outbox, crash before/after enqueue, stale lease, tenant fairness, HMAC replay/rotation, restore+encryption key, deterministic fallback.
12. **Acceptance:** accurate aggregate matches canonical snapshot, no duplicate durable enqueue, P0 independent, real dispatch only approved scope; source-only isn't delivery.
13. **Rollback:** disable orchestration/sends by server gate, retain snapshots/outbox/ledger; preserve existing notification owner until cutover exit.
14. **Effort:** readiness gap audit 1–2 days; qualifying one digest runtime 3–6 days depending environment; commercial/legal/uptime gate external.
15. **PRs:** repair one existing readiness blocker; don't add full Automation Center/AI/marketing/payroll mutations.
16. **Approval:** runtime, real recipients, cost/license and exact production release scope approved independently; NOT_READY now.

## Suggested independent PR order

R00 docs/evidence → confirmed auth gap repair only if live/test proof requires it → R01 after App handoff → R03 → R02A → R02B → R04 contract → R06 measurement → R05 display contract → R08 qualification → R07 contract (if demand) → R09 existing readiness.

No PR is mandatory just to satisfy the roadmap. Dismiss already-fixed/unsupported findings, preserve session ownership. Full CRM/loyalty, self-running AI, cash online poker, desktop/offline writes and a new HRM/telemetry platform are NOT_RECOMMENDED in this cycle.

## Outcomes to measure using existing sources

Record only if query/source exists and scope authorized: created tournaments, partial setup failures, denied scoped mutations, registration retries/dedupes, staff approved shifts/payroll statement count, owner report availability. UX baseline: completed task/time/error on fixed fixture. Business savings/support burden/cloud cost remain NOT_MEASURED until observed. This is not a telemetry-platform build request.

Final release acceptance for future tasks uses current AGENTS.md/SHIP_AND_TEST, but this research task explicitly prohibits any deploy/merge/apply/flag/send. A roadmap estimate or owner preference is not a release receipt.
