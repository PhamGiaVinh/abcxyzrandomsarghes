# Gap & risk register

Không có confirmed live security exploit trong task này. `SOURCE_FACT` mô tả code; `HYPOTHESIS_NEEDS_VALIDATION` mô tả kịch bản chưa chạy. Priority P1/P2 là **triage dự kiến**, không khẳng định incident production. Historical migration có thiếu guard không tự chứng minh latest deployed body thiếu guard. External risks nằm trong 03; register này tập trung VinPoker.

## G01 — Legacy tournament/table assignment không có shared transaction

- Severity/module: P1 nếu thao tác này được dùng cho bàn đang chạy; TournamentConfig/physical table links. Confidence HIGH source structure; runtime failure chưa tái hiện.
- Evidence: V03 `useCreateTournament` 102–145 và `useUpdateTournament` 168–217, caller `TournamentConfigPage.handleSubmit` 322–359. Separate tournament insert/update, link deletes và link inserts. Delete errors không được kiểm tra trong các await đó.
- Scenario: tournament write thành công, insert link thất bại; hoặc delete link thành công rồi request sau fail. Retry create có thể tạo thêm giải vì không có shared request receipt ở hook. `HYPOTHESIS_NEEDS_VALIDATION` cho dữ liệu live/duplicate outcomes.
- Club impact: cấu hình lệch, bàn mất liên kết, thao tác recovery thủ công; mức thực tế phụ thuộc current constraints/route usage.
- Safeguards: club-scoped reads, select available tables UI, DB constraints/RLS, safe delete RPC cho delete tournament. Những thứ này không biến nhiều HTTP request thành cùng transaction.
- Fix: xác minh canonical setup RPC sẵn có, rồi một intent transaction cho exact draft/table context; reject occupied/live sessions, actor-derived club; không tự transfer live table.
- Regression risk: CRITICAL seating/lifecycle compatibility. Tests: fail after each step, concurrent link contention, same request retry, foreign-club actor/table; commit all-or-none. Roadmap R02; kiểm tra overlap trước giao writer.

## G02 — Standard tournament draft/blind levels partial commit

- Severity/module: P2 setup reliability, escalates CRITICAL if fee/price write contract changes.
- Evidence: [TournamentManagerShared.submit](https://github.com/PhamGiaVinh/-vinpoker-/blob/af51adc256855e3319d9dc4794ead8ca74d9537d/VinPoker/src/components/floor/TournamentManagerShared.tsx#L392-L431) inserts tournament then levels. Multiday path uses `create_tournament_event_with_flights` instead.
- Scenario/impact: failed levels save leaves created tournament without intended structure. Source explicitly reports this to operator; partial state is intentional recovery behavior, not silent success.
- Safeguards: draft validation, busy flag, specific partial-save toast, clock start checks configured levels. Confidence HIGH SOURCE_FACT; failure path not executed.
- Fix: first decide acceptable recoverable draft versus atomic create; if atomic desired, reuse canonical setup transaction rather than client compensation deletes. R02 PR-A separate from table-link PR-B.
- Tests/risk: rollback on invalid level/save error, replay creation receipt, prices unchanged, no duplicate drafts; tenant tests. Draft semantics must be preserved explicitly.

## G03 — Legacy payroll read authority needs current-body/ACL verification

- Severity/module: P1 privacy triage, Dealer payroll read; **not confirmed live leak**.
- Evidence: [calculate_club_payroll body](https://github.com/PhamGiaVinh/-vinpoker-/blob/af51adc256855e3319d9dc4794ead8ca74d9537d/VinPoker/supabase/migrations/20260724000001_dealer_payroll_soft_delete.sql#L137-L232) is SECURITY DEFINER, takes p_club_id, reads payroll and has no actor/club predicate in that body; [caller](https://github.com/PhamGiaVinh/-vinpoker-/blob/af51adc256855e3319d9dc4794ead8ca74d9537d/VinPoker/src/hooks/useDealerPayroll.ts#L107-L124). Hardening source exists under `migration-archive/superseded/replaced/20261236000000_accountant_authz.sql`, not active chain proof.
- Scenario: if effective EXECUTE grants permit unscoped actor and deployed body matches this legacy body, another club's salary data could be read. **HYPOTHESIS_NEEDS_VALIDATION**; ACL/global revokes/latest live definition unknown.
- Safeguards: newer secure save/transition/pay functions in `20261235000000_dealer_payroll_actor_binding.sql` bind auth.uid/club/CAS/ACL; their protection cannot be inferred for this separate read function.
- Fix: R00 current object-definition/ACL reconciliation read-only first; only if confirmed, new scoped read/guard migration in separate approved task, preserving saved payroll values. Do not replay archived file blindly.
- Tests/risk: anon/club A/club B/dealer-self/owner/accountant/read-of-locked-period on disposable current-schema DB. Risk of denying legitimate accountant consumers; no salary recalculation or recovery mutation.

## G04 — Legacy cashier scope lookup accepts client-selected identity

- Severity/module: P2 enumeration/authorization-contract triage, cashier scope.
- Evidence: [cashier_club_ids](https://github.com/PhamGiaVinh/-vinpoker-/blob/af51adc256855e3319d9dc4794ead8ca74d9537d/VinPoker/supabase/migrations/20260512214452_e9eae15b-1c3a-4d35-84b6-c0f5ad8348fe.sql#L1-L20) SECURITY DEFINER uses `_user_id`; [consumer](https://github.com/PhamGiaVinh/-vinpoker-/blob/af51adc256855e3319d9dc4794ead8ca74d9537d/VinPoker/src/pages/CashierDashboard.tsx#L66-L106) passes own user ID, but function itself does not bind it.
- Scenario: caller supplies different user's ID if effective grants allow. It returns club IDs, not proof ability to transact; **HYPOTHESIS_NEEDS_VALIDATION** for exposure.
- Safeguards: later money mutations derive actor/object club; RLS on underlying objects. Confidence HIGH body/caller facts, MEDIUM effective risk until ACL inspection.
- Fix/test/risk: R00 check latest body/grants/callers; prefer no-argument current-user scope RPC if legitimate consumers permit; spoofed identity + tenant + role-revocation tests. Preserve trusted admin lookup separately only if real consumer requires it.

## G05 — Finance success payload can collapse malformed response into zeros

- Severity/module: P2 report integrity (read-only UI affecting financial decisions).
- Evidence: [useFinanceSummaryRpcOnly](https://github.com/PhamGiaVinh/-vinpoker-/blob/af51adc256855e3319d9dc4794ead8ca74d9537d/VinPoker/src/hooks/accountant/useFinanceSummaryRpcOnly.ts#L44-L67) throws RPC error, but missing revenue/cost/net fields become `0`; numeric strings accepted by Number.
- Scenario: RPC responds success with null/malformed/partial shape; UI can display apparent zeros. This conversion is SOURCE_FACT; actual malformed server response is **HYPOTHESIS_NEEDS_VALIDATION**.
- Safeguards: no client-side broad-table fallback; RPC authority preserved. Contrast strict digest/source-health parsers V19.
- Fix: schema-validate success response using existing repo parser conventions; separate confirmed zero from unavailable. R03, no new finance calculation.
- Test/risk: zero valid, missing/null/NaN/partial/mismatched scope rejected, old legitimate response compatibility. Confidence HIGH conversion, unknown production occurrence.

## G06 — Source/archive/flag provenance insufficient for runtime claims

- Severity/module: P1 release-verification debt, payroll/staff/operator/CRM/digest.
- Evidence: callers V09/V13/V14/V19, `useOperatorClubs`, `useFtPayrollStatements`, `MarketingStaffManager`; matching staff/identity/digest/function definitions found in historical-never-replay/superseded/never-apply archive. `featureFlags.ts` declares staffApp ON while archived file headers say source-only/not applied. Generated types are separate artifacts.
- Scenario/impact: agent/release assumes migration missing = feature missing and reimplements, or assumes flag ON = body deployed and exposes broken UI. Source status conflict is confirmed; current production failure not established.
- Safeguards: migration-control manifests, source hashes and protected apply workflows V27; existing error adapters fail unavailable for selected RPCs.
- Fix: R00 per-function object/ACL/version map from approved current catalog/metadata; keep archive immutable; document rather than replay. No full `db push`.
- Test/risk/confidence: inventory consistency/static assertions + isolated exact current-schema smoke if later authorized; HIGH provenance gap. Replaying archive would be HIGH risk; benchmark does not do it.

## G07 — Retired GTO still has baseline startup/route surface

- Severity/module: P2 startup/dead feature debt, App boundary.
- Evidence: V28 App 10–26 imports/calls initRemoteRanges on ordinary routes; `precomputed.ts` 64–98 fetches `gto_spot_ranges` and subscribes; `/admin/gto-ranges` remains at App 426. Owner previously confirmed feature retired.
- Scenario/impact: ordinary boot requests/subscription for retired feature. Source call is proven; number of requests/bytes/time added is **NOT_MEASURED**.
- Safeguards: selected dev routes skip initialization; lazy editor import. Shared poker utilities must be traced, not deleted by keyword.
- Fix: R01 confirm retirement against current session/main, remove only dead runtime/UI/tests; retain historical DB/shared dependencies. Do not protect retired editor behavior with new regression tests.
- Test/risk/confidence: navigation/startup/Tracker/Tournament smoke, precise caller search/build/focused tests; HIGH footprint, current post-baseline removal unknown. Wait for App/Tracker ownership handoff.

## G08 — Waitlist feature slice is a stub, not whole queue missing

- Severity/module: P2 product gap; customer seating workflow.
- Evidence: V18 disabled “Đổi ghế trống” says needs backend; mock waitlist exists. V07 waiting entries and registration queue are real source capabilities.
- Scenario/impact: dedicated ticket/arrival/expiry workflow not implemented by that control; demand/steps-saved unknown. No inference that all registration/seating is absent.
- Safeguards: disabled action cannot create unauthorized moves.
- Fix: R07 first distinguish cash waitlist, tournament waiting-to-seat and seat-change request; owner product decision before one narrow contract. No implicit payment/seat guarantee.
- Tests/risk/confidence: expiry/race/tenant/cancel/duplicate/arrival/role tests; CRITICAL on commit/notification path, source-gap confidence HIGH, commercial value assumed.

## G09 — Editorial InternationalEvents lacks selected provenance contract

- Severity/module: P2 data-quality/product trust.
- Evidence: V20 Evt/save payload has website_url but no source revision/hash/review/freshness contract on that interface; existing Series Market contract already models those concepts.
- Scenario: manually edited external schedule appears current without linked evidence/version. Interface gap SOURCE_FACT; actual wrong event/demand unknown.
- Safeguards: is_active/media admin editing, separate research provenance system.
- Fix: R05 add read-only source/freshness association first, reuse Series Market; manual-reviewed import only if later chosen. Do not auto-create live tournament or arbitrary scraper.
- Test/risk/confidence: source ambiguity, stale data, redirect identity, challenge/empty page scenarios; HIGH local interface gap, unknown broader pipeline existence.

## G10 — Unbounded tournament reads / broad viewer reload need measurement

- Severity/module: P2 potential latency/cloud cost; **HYPOTHESIS_NEEDS_VALIDATION**.
- Evidence: V02 all tournaments query has no limit; V06 loadAll refetches multiple resources and has realtime/safety/zero polling; V22 viewer uses multiple triggers/refetches.
- Scenario: large histories/rapid invalidations cause extra work; no measured request/cpu/transfer/latency baseline. No claim of slow/scalability defect.
- Safeguards: query stale time, request sequence/scope fencing, channel cleanup/coalescing paths; keep correctness guards.
- Fix/test/risk: R06 record same fixture/revision/device baseline then one measured fix only. Do not cache sensitive snapshots broadly or refactor subscriptions speculatively. Capacity separate NOT_MEASURED.

## G11 — Runtime forecast-close defect already owned elsewhere

- Severity/module: P1 operational close/lifecycle; **IN_PROGRESS_OTHER_SESSION**.
- Evidence: active task receipt described in 02; migration 79 source distinguishes rotation slots and raises closed_session_rotation_scope_invalid. Session has actual runtime repro and is preparing migration 81.
- Scenario/impact: valid planned slot can block closing; not independently reproduced in this research. Safeguards: wrong-current-session slot rejection and transaction rollback are intentional.
- Fix/test/rollback: existing writer owns forward repair + current-schema tests/rollout gate; benchmark records status and waits for final handoff. No new PR. Confidence HIGH session evidence, live deployment unknown.

## G12 — Payroll/CRM/employee identity readiness is unproven, not duplicate data proof

- Severity/module: P2 architecture/feature readiness.
- Evidence: dealer/staff/profile/club membership have distinct source contracts; canonical player resolver found in archive `20261208000000_player_identity_canonical.sql`; linked-staff user/club uniqueness in archived directory. No actual duplicate employee records inspected.
- Scenario: a new “Employee 360” or CRM joins same display names and exposes another person's salary or mixes clubs. **HYPOTHESIS_NEEDS_VALIDATION** for proposed design, no current leak demonstrated.
- Safeguards: per-club auth-user identity/first-link rules and newer RPC scope; private payroll separated.
- Fix: R04/R07 contract-only audit; prototype gate identity + club + privacy + no invented schema. Stop at contract on any fail.
- Test/risk/confidence: cross-club/membership revoke/unlinked-person/statement visibility matrix; HIGH need for explicit mapping, no claim current records duplicate.

## External reject examples / regression lessons

- B1 multiplied payouts, B5 unauthenticated/inconsistent writes: reject copying (E24/E42/E45).
- Arena optional/check-then-insert ordering, in-memory settlement: no evidence it improves VinPoker concurrency (E15/E18).
- Pulse helper-local tests can pass while app implementation changes; test imported behavior (E35).
- Electron hostname substrings and missing listeners: no proof of offline recovery (E46–E48).

No urgent destructive repair, historical payroll recomputation, source-copy, DB migration or production send is authorized by this register. Readiness proposals and scope are in 06.
