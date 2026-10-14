# VinPoker Poker Room Benchmark — kết quả nghiên cứu

**AUDIT_COMPLETE_SOURCE_ONLY — đủ để ưu tiên task kế tiếp, chưa chứng minh trạng thái production.**

Baseline `origin/main`: `af51adc256855e3319d9dc4794ead8ca74d9537d`. Khảo sát 7 repository, 6 nhóm skill/tài liệu của World Hub, tương ứng 12 audit units. 48 capability observations trong evidence matrix: **24 có đường implementation được trace**, **10 partial**, **3 documented-only**, **2 mock/stub**, **4 not found trong phạm vi khảo sát**, **5 not verifiable**. **0 IMPLEMENTED_AND_TESTED**: không chạy code/tests bên thứ ba. Không coi test file hoặc schema là runtime proof.

Kết luận chính: **giữ kiến trúc canonical của VinPoker; ưu tiên xác minh quyền và làm chắc đường setup hiện hữu.** Repo tham khảo hữu ích về waitlist, scenario test cho nguồn lịch giải, cách giải thích balance và UX projector. Không có bằng chứng để thay Dealer Swing/Payroll/Cashier hoặc port toàn bộ engine/HRM/desktop stack.

## Session đang sửa Tracker/Dealer Swing

Owner xác nhận một session đang sửa các phần này. Task đang active **Respond to greeting**, worktree `D:/wt/vinpoker-swing-manual-next-intent`, đã báo runtime repro forecast slot hợp lệ chặn đóng bàn và đang chuẩn bị forward migration **81**. Không sửa migration **79**. Các claims live là session-reported, không được benchmark kiểm tra độc lập.

Benchmark đánh dấu **IN_PROGRESS_OTHER_SESSION**, không giao writer khác sửa Tracker/Dealer Swing. Bản audit cố định main đầu task; sửa chưa commit hoặc sau baseline không bị coi là đã audit. Chi tiết: [02](02_VINPOKER_CAPABILITY_INVENTORY.md).

## Top 10 findings

| # | Finding và evidence | Ý nghĩa/ưu tiên |
|---|---|---|
| 1 | Legacy `calculate_club_payroll` active-source body SECURITY DEFINER chưa thể hiện actor/club check; hardening nằm trong archive (G03) | Kiểm tra latest live body/ACL trước; **chưa kết luận lộ lương live** |
| 2 | `cashier_club_ids(_user_id)` tin identity argument; UI truyền own user nhưng function không tự bind (G04) | Xác minh grants/caller và tenant scope; không suy quyền giao dịch từ lookup |
| 3 | Standard tournament draft + levels và legacy table-link config là separate writes (G01/G02) | Có partial-state path; chia atomic draft và safe link intent thành PR riêng |
| 4 | Finance RPC error được throw, nhưng malformed success có thể thành zero (G05) | Dùng boundary parser, phân biệt unavailable và confirmed zero |
| 5 | Staff/payroll/digest/operator callers/flags và archive migration không đủ suy live state (G06) | Source provenance map trước feature mới; không replay archive/db push |
| 6 | Retired GTO vẫn khởi tạo request/subscription trên ordinary startup tại baseline (G07) | Cleanup sau App/Tracker handoff; savings **NOT_MEASURED** |
| 7 | VinPoker đã có balanced Floor planner/session identity/receipt fences (V07/V08/V11) | **Giữ nguyên**; Pulse balance heuristic không phải missing feature |
| 8 | Commander waitlist UI có flow thật nhưng backend được rewrite sang service khác (E01/E02) | Học states/UX; không gọi upstream transactions là đã audit |
| 9 | B2 remove/guest handlers và B5 auth/elimination có mismatch source cụ thể (E28/E29/E42/E45) | Repo bên ngoài không mặc định tốt hơn; reject critical paths dù MIT/GPL |
| 10 | License reuse của 5 repo chưa có permissive grant (World Hub/B1/B3/B4 thiếu root license; B6 Proprietary), B2 GPL-3.0-or-later, B5 MIT | Clean implementation từ pattern; không copy code/assets; rights gate riêng |

Cả positive và negative source evidence có permalink cố định SHA trong [03](03_SKILL_BY_SKILL_CODE_AUDIT.md). Không có confirmed live security exploit, production incident hay performance gain được đo trong task này.

## VinPoker versus external projects

| Module | VinPoker hiện có ở source | External reference hữu ích | Verdict |
|---|---|---|---|
| Club/cashier authority | Multi-role surfaces, newer object-derived club RPCs | B2 event permission granularity; A1 upstream boundary | Verify legacy scope/read ACL; giữ newer authority |
| Dealer/attendance/payroll | Scheduling/attendance/secure mutations/statement contracts | Không có benchmark tương đương đầy đủ | Giữ; đang có writer khác; map archive/current provenance |
| Tournament setup/clock | Standard/multiday setup, server atomic clock start, TV anchor | B1 validation, Pulse/Royal break UX | Fix setup only if current gap remains; clock architecture giữ |
| Floor/chips | Entry/session distinction, balanced plan+commit, receipts | B1 duplicate-seat validation, Pulse occupancy examples | Qualification/explanation tests; không thay server planner |
| Finance/payout | Ledger/report boundaries, conservation calculator tests | External rounding/elimination failure cases | Verify server apply + strict read payload; không copy payout rules |
| Player CRM/waitlist | Profiles/entries/registration queue; selected waitlist stub | Commander join/arrive/leave | Contract-only first; cash queue != tournament waiting entry |
| Source/Owner intelligence | Existing claim lineage/source health/digest/automation | Registry/source-handoff/ambiguous-page tests | Reuse foundation; no second registry/automation platform |
| Online/replay/desktop | Practice server engine, Tracker projection/replay, web/PWA | Engine seams, table state vocabulary, Electron prefs | No port; desktop/automatic gameplay rewrite not justified |

## Top improvement opportunities

1. **R00 HIGH VALUE:** verify scoped function bodies/grants/source receipts (1–3 person-days).
2. **R01 QUICK WIN:** remove confirmed retired startup code after writer handoff (0.5–2 days).
3. **R02 HIGH VALUE/HIGH RISK:** separate atomic draft+levels (2–4 days) and safe table-link intent (3–6 days).
4. **R03 QUICK WIN:** finance response parser/error state (0.5–1.5 days).
5. **R04 HIGH VALUE, GATED:** employee identity/privacy contract (1–2 days), read projection only after four gates PASS.
6. **R05 QUICK WIN first / LONG TERM import:** editorial source/as-of/review display using Series Market (1–2 days first slice).
7. **R06 CONDITIONAL QUICK WIN:** one reproducible client measurement; no fix if no repro (0.5–2 days measurement).
8. **R07 CONTRACT FIRST:** choose one waitlist meaning before queue implementation (1–2 days contract).
9. **R08 HIGH VALUE:** qualify payout server apply/real-function conservation (2–4 days with current-schema fixture).
10. **R09 LONG TERM:** complete existing digest runtime readiness, not build new automation (readiness 1–2 days; runtime 3–6 days if gates clear).

Effort ranges assume experienced repo engineer and available sanitized contracts; exclude access/license/UAT wait. Business value/risk/maintenance scores are qualitative hypotheses, not measured ROI. **NOT RECOMMENDED:** full rewrite, new HRM schema, copied game/payment engine, desktop/offline authority, blind source scraping, self-running AI money/chip/seat mutation.

## Phased order / next concrete action

Phase 0: R00 + ongoing session receipt. Phase 1: R01/R03. Phase 2: R02A then R02B. Phase 3: R04 contract/R06 measurement/R08 qualification. Phase 4: R05 and optional R07 contract. Phase 5: R09 existing readiness after reliability/license/budget gates.

**Đề xuất tiếp theo:** giữ writer Tracker/Dealer Swing hiện tại; mở một task đọc-chỉ xác minh payroll/cashier scope contracts, rồi quyết định trên current evidence. Không mở thêm writer vào các domain đang sửa. Mọi PR/acceptance/dependency/rollback/owner gates chi tiết trong [06_PHASED_IMPLEMENTATION_ROADMAP.md](06_PHASED_IMPLEMENTATION_ROADMAP.md).

## Owner decisions (tối đa 5)

1. Đồng ý thứ tự R00/current-session receipt → confirmed small fixes → setup reliability, tránh triển khai feature mới trước scope proof.
2. Chọn setup **atomic commit** hay **recoverable draft**; đề xuất atomic draft+levels nhưng không tự chuyển bàn đang chạy.
3. Waitlist ưu tiên cash queue, tournament waiting-to-seat hay seat-change request? Đề xuất chỉ contract trước, chọn đúng một mục khi có demand.
4. Employee 360 chỉ read-only sau identity/club/payroll privacy/no invented schema PASS; gate fail thì giữ contract-only.
5. External event collection/manual source association: đề xuất curated provenance trước, không auto-scrape/auto-publish; commercial license/provider spend xét ở task riêng.

## Limits and mutation receipt

- Static source audit theo capabilities, không exhaustive security review mọi function/Edge/module; findings chưa repro ghi đúng hypothesis.
- Không xác minh DB live/Edge/frontend/flags, không UAT/test runtime/CI executions/dependency CVE; production/scalability/capacity/cost/ROI **NOT_MEASURED**.
- Competitor commercial claims chưa kiểm chứng độc lập, không dùng làm pricing/market-size fact.
- Production mutations **0**; DB mutations **0**; money-path changes **0**; external notifications **0**; third-party code execution/install **0**.
- Chỉ 8 tài liệu trong worktree research; không merge/deploy/apply/flag. Không có Draft PR ở lượt này.

Deliverables: [01 registry](01_EXTERNAL_REPOSITORY_REGISTRY.md), [02 capability inventory](02_VINPOKER_CAPABILITY_INVENTORY.md), [03 code audit/evidence matrix](03_SKILL_BY_SKILL_CODE_AUDIT.md), [04 architecture](04_ARCHITECTURE_COMPARISON.md), [05 gaps/risks](05_GAP_AND_RISK_REGISTER.md), [06 roadmap](06_PHASED_IMPLEMENTATION_ROADMAP.md), [07 owner packet](07_OWNER_DECISION_PACKET.md).

## Document verification receipt

8 documents; 70 unique immutable source permalinks checked against fetched Git objects (repo/path/SHA and referenced line ranges); 0 invalid source/internal links. Matrix counts checked programmatically: 48 unique E observations, status breakdown above. All 10 candidates R00–R09 have fields 1–16. Independent `gpt-6-luna` read-only review of 00/05/06: PASS for source/live uncertainty, writer ownership, archive/paid-history protection and roadmap completeness. Credential-literal pattern scan found no matching token/connection-string literals; this is a limited pattern scan, not an exhaustive secret audit. Product tests/build/typecheck not run because only research Markdown changed; no runtime PASS inferred.
