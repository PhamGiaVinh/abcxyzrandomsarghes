# Skill-by-skill / repository-by-repository code audit

Baseline và license policy: [01](01_EXTERNAL_REPOSITORY_REGISTRY.md). VinPoker evidence IDs V01–V28: [02](02_VINPOKER_CAPABILITY_INVENTORY.md). Audit source, không chạy runtime/tests bên ngoài. Các status trong matrix là cho capability cụ thể, không chứng nhận whole repository.

## Unified external evidence matrix

| ID | Unit | Capability | Status | Evidence/call path và gap với VinPoker |
|---|---|---|---|---|
| E01 | A1 | Commander join/leave/arrive UI | IMPLEMENTED_NOT_TESTED | `pages/hub/commander/waitlist/[venueId].js` 45–152, 179–310; connected HTTP handlers phía client; V18 chỉ có disabled waitlist affordance |
| E02 | A1 | Commander waitlist server/storage | NOT_VERIFIABLE | `vercel.json` 800–801 rewrite upstream; không có local waitlist server route tương ứng; không đánh đồng Arena API |
| E03 | A1 | Toàn bộ workforce/finance scope trong plan | DOCUMENTED_ONLY | 10 A1 docs không chứng minh feature parity; VinPoker V10/V12–V16 có callers/contracts thực |
| E04 | A1 | Proposed DATABASE_SCHEMA/API_REFERENCE | DOCUMENTED_ONLY | Schema/API prose trong skill folder không phải executed handler/migration proof |
| E05 | A1 | Tournament API integration proxy | IMPLEMENTED_NOT_TESTED | `pages/api/commander/tournaments/[[...path]].js` 46–135; local input/rate/timeout controls, downstream authority chưa khảo sát |
| E06 | A2 | Tour source registry | PARTIALLY_IMPLEMENTED | JSON có nguồn/metadata, consumers có thật; static update metadata khác cadence được mô tả |
| E07 | A2 | Registry-driven tour refresh | IMPLEMENTED_NOT_TESTED | `scripts/tour-refresh-checker.js` 56–57, 122–182, 424–451; source/scrape URL writes; scheduled caller riêng chưa thấy |
| E08 | A2 | Discovery provenance handoff | IMPLEMENTED_NOT_TESTED | `scrape_poker_series_discovery.py` + imported offline/atomic ingest test sources; V20 đã có revision/claim contract |
| E09 | A2 | Actual refresh every 3 days/fresh DB data | NOT_VERIFIABLE | Không chạy jobs/query DB; registry last_updated 2026-04-07; không suy freshness từ daily workflow |
| E10 | A3 | Online table route/game wiring | PARTIALLY_IMPLEMENTED | `pages/hub/poker/table/[tableId].js`, game component/engine tồn tại; route không chứng minh full current-state/replay flow |
| E11 | A3 | Route Realtime update consumer | MOCK_OR_STUB | Inspected callback chỉ log; không thấy refresh/state application ở callback đó |
| E12 | A3 | Full replay correctness | NOT_VERIFIABLE | Layout skill + route không đủ chứng minh canonical replay; VinPoker V22 có replay modules/test seams |
| E13 | A4 | PokerTableView seats/actions rendering | IMPLEMENTED_NOT_TESTED | `src/components/club-arena/game/PokerTableView.jsx` 28–91,124–250; static layout/controls có code thật |
| E14 | A4 | Sole GoldenTemplateTable enforcement | PARTIALLY_IMPLEMENTED | Skill chỉ định singleton nhưng source có independent table layouts; compliance chưa đồng nhất |
| E15 | A5 | Authenticated player action | IMPLEMENTED_NOT_TESTED | `pages/api/poker/engine/action.js` 44–80,138–177 → controller → betting; optional idempotency không tương đương receipt transaction |
| E16 | A5 | Betting/side pots/showdown | IMPLEMENTED_NOT_TESTED | `GameStateMachine.processAction` 289–299, `_handlePayout` 1868–1955; `PotCalculator.calculatePots/distribute` 153/247 |
| E17 | A5 | Hand-history persistence | IMPLEMENTED_NOT_TESTED | `HandHistoryRecorder.completeHand`, `HandHistory.js` 226–296; history persistence khác balance ledger settlement |
| E18 | A5 | Atomic action + durable money ledger/concurrency | NOT_VERIFIABLE | In-memory action path `GameController.js` 1158–1186; no end-to-end DB transaction proof in inspected path |
| E19 | A6 | Competitor feature descriptions | DOCUMENTED_ONLY | `SKILL_POKERATLAS_COMPETITOR.md`; commercial fact không được xác thực bằng implementation của repo |
| E20 | A6 | Adoption/pricing/business superiority claims | NOT_VERIFIABLE | Không có independent source verification; không đưa con số vào business forecast |
| E21 | B1 | Tournament start/draw | IMPLEMENTED_NOT_TESTED | `Tournament.start` 84–141; shuffle + round-robin, capacity assumptions |
| E22 | B1 | Eliminate/rank/winner | IMPLEMENTED_NOT_TESTED | `LiveTournamentController.eliminatePlayer` 14–51; sequential in-memory active count |
| E23 | B1 | Manual consolidation/duplicate seats | IMPLEMENTED_NOT_TESTED | `validateConsolidation`/`applyConsolidationAndCleanup` 55–134; no transactional stale-plan fence |
| E24 | B1 | Fixed prize calculation | IMPLEMENTED_NOT_TESTED | `calculateAndAssignWinnings` 143–170; type multiplier can break conservation |
| E25 | B1 | Local persistence | IMPLEMENTED_NOT_TESTED | `ObjectPlus` 26–35 + `AppController` 12–44; binary object graph |
| E26 | B1 | Shared user/tenant authorization | NOT_FOUND | Không tìm thấy server/auth boundary trong Java local app surveyed tree |
| E27 | B2 | User participants/check-in/membership | IMPLEMENTED_NOT_TESTED | `events/models.py` 165–205 + API view; useful domain objects, single-event permission model |
| E28 | B2 | Remove participant endpoint | PARTIALLY_IMPLEMENTED | `events/api/views.py` 68–88 calls check_in_user, inverse intent mismatch |
| E29 | B2 | Guest check-in API | PARTIALLY_IMPLEMENTED | API 108–123 call incompatible model signature 189; UI/model present, handler not correct |
| E30 | B2 | Blind timer pages | IMPLEMENTED_NOT_TESTED | `timers/views.py` 7–21 + URLs; unguarded template routes, no live data inspected |
| E31 | B2 | Staff payroll/attendance/Cashier | NOT_FOUND | Membership/points không thay HRM; không có corresponding workflow trong surveyed tree |
| E32 | B3 | Tick/advance/break pause | IMPLEMENTED_NOT_TESTED | `App.tsx` 335–391; interval decrement, no server anchor |
| E33 | B3 | Device persistence | IMPLEMENTED_NOT_TESTED | `App.tsx` 54–78,226–247 localStorage; not cloud recovery |
| E34 | B3 | Occupancy rebalance/free-seat | IMPLEMENTED_NOT_TESTED | `utils.ts` 451–498; largest→smallest/highest seat, no live-hand/lock constraints |
| E35 | B3 | Prize/rebuy/add-on utilities | IMPLEMENTED_NOT_TESTED | `utils.ts` 13–83; real imports in `src/test/utils.test.ts`; no runtime executed |
| E36 | B3 | Distinct re-entry lifecycle | PARTIALLY_IMPLEMENTED | Rebuy/add-on counters & Players UI; separate entry identity/rules not evidenced |
| E37 | B4 | Timer atom tick/state | IMPLEMENTED_NOT_TESTED | `apps/web/src/lib/atoms.ts` 6–30,52–90; browser authority only |
| E38 | B4 | Explicit break-row editing | IMPLEMENTED_NOT_TESTED | `useAddTournamentLevel.tsx` 7–26; 15-minute break row |
| E39 | B4 | Cross-tab broadcast | IMPLEMENTED_NOT_TESTED | atoms/broadcast implementation; not durable multi-device sync |
| E40 | B4 | Registration/seating/prizes backend | NOT_FOUND | Surveyed timer app has no corresponding operations backend |
| E41 | B5 | Tournament records/registration API | IMPLEMENTED_NOT_TESTED | `src/models/Tournament.js` 23–117,157–217 and routes; single Mongo updates |
| E42 | B5 | Elimination/ranking integrity | PARTIALLY_IMPLEMENTED | `eliminatePlayer` 218–254 builds removal but only applies append; duplicate/state concerns |
| E43 | B5 | Edit tournament handler | MOCK_OR_STUB | `src/routers/tournamentRouter.js` edit placeholder; route presence is not implemented editor |
| E44 | B5 | Rebuy operational lifecycle | PARTIALLY_IMPLEMENTED | Rebuy metadata in model; no entries/seat/payment transition evidenced |
| E45 | B5 | Auth coverage for tournament writes | PARTIALLY_IMPLEMENTED | JWT middleware exists, create/register/eliminate routes lack it; scoped authorization not established |
| E46 | B6 | Remote operator desktop window | IMPLEMENTED_NOT_TESTED | `main.js` 10–47; secure Electron prefs but permissive hostname matching |
| E47 | B6 | Preload window/update/print controls | PARTIALLY_IMPLEMENTED | `preload.js` 4–23 sends channels; no matching main-process listeners found |
| E48 | B6 | Offline state/persistence/sync | NOT_FOUND | Thin remote wrapper, no local operations store in surveyed tree |

Count only E01–E48 for external capability statistics. No `IMPLEMENTED_AND_TESTED` entry: audit did not run external tests. Partial means code exists in some path, not complete correctness.

## A1 — Club Commander

**Documents:** all ten required docs read. SKILL/SCOPE_LOCK define product scope; BUILD_PLAN/IMPLEMENTATION_PHASES/API_REFERENCE/DATABASE_SCHEMA describe proposed layers/contracts; COMPETITOR_ANALYSIS/ENHANCEMENTS/EXPANSION describe aspirations; DEPLOYMENT is deployment guidance, not a deploy receipt. No external instructions were executed.

**Trace:** [waitlist page](https://github.com/Smarter-Poker/Smarter-Poker-World-Hub/blob/6c6bec4e34e87d272f7e03ed6058ba6189607740/pages/hub/commander/waitlist/%5BvenueId%5D.js#L45-L152) loads/polls/subscribes; join/leave/arrive calls at 179–310 target `/api/commander/waitlist`. [Rewrite](https://github.com/Smarter-Poker/Smarter-Poker-World-Hub/blob/6c6bec4e34e87d272f7e03ed6058ba6189607740/vercel.json#L800-L801) delegates to a separate application. Local tournament [proxy](https://github.com/Smarter-Poker/Smarter-Poker-World-Hub/blob/6c6bec4e34e87d272f7e03ed6058ba6189607740/pages/api/commander/tournaments/%5B%5B...path%5D%5D.js#L46-L135) adds path/method/rate/timeout controls. Upstream storage/RLS/transaction semantics cannot be inferred from these clients.

**Distinct Arena path:** [Arena waitlist handler](https://github.com/Smarter-Poker/Smarter-Poker-World-Hub/blob/6c6bec4e34e87d272f7e03ed6058ba6189607740/pages/api/club-arena/waitlist.js#L30-L89) verifies user and idempotency helper, then SELECT duplicate → COUNT position → INSERT. Concurrent position/duplicate race is a hypothesis unless constraints/transaction prevent it. Do not attribute this handler to the Commander page.

**Comparison:** external provides a concrete customer flow worth studying: join → position → arrival → leave. VinPoker already has registration queue, entry identity, seat control and cash authority; it does not need a copied Commander architecture. No faster-click claim without task timing. `INSPIRED_UI` for waitlist states, `ADOPT_PATTERN` for explicit upstream boundary, `REJECT` for copying docs as finished product or introducing count+1 queue authority.

## A2 — Tournament Source Registry

[Registry metadata](https://github.com/Smarter-Poker/Smarter-Poker-World-Hub/blob/6c6bec4e34e87d272f7e03ed6058ba6189607740/data/tour-source-registry.json#L1-L14) says last_updated 2026-04-07 and refresh_interval_days 3. At audit date that file's metadata is old; this is not proof DB records are stale. [tour-refresh-checker](https://github.com/Smarter-Poker/Smarter-Poker-World-Hub/blob/6c6bec4e34e87d272f7e03ed6058ba6189607740/scripts/tour-refresh-checker.js#L424-L451) writes source/scrape addresses; `scrape-missing-tour-events.js` consumes registry, but no workflow/package scheduled caller for those two scripts was established.

A different daily pipeline exists in `.github/workflows/poker-series-auto-pilot.yml`; [source-handoff CI](https://github.com/Smarter-Poker/Smarter-Poker-World-Hub/blob/6c6bec4e34e87d272f7e03ed6058ba6189607740/.github/workflows/series-discovery-contracts.yml#L10-L37) runs offline tests. `test_series_discovery_handoff.py` blocks network and tests stable IDs/source provenance/suppression. `test_pokeratlas_discovery_ingest.py` covers 200 challenge pages, ambiguous empty response and redirect identity; `test_pokeratlas_atomic_ingest.py` includes DB-backed replay/concurrent identity cases. Useful **test scenario references**, not proof jobs ran at this SHA.

VinPoker V20 is already richer than a URL registry: document→revision→claim→release, timestamps, hashes, correction lineage and confidence. Opportunity is applying that existing contract to editorial InternationalEvents. `ADOPT_PATTERN`: challenge detection, explicit freshness and no silent empty-ingest. `REUSE_WITH_LICENSE_REVIEW`: only after rights and source terms are resolved. Do not schedule arbitrary scraping, import public schedules into operational tournaments automatically or create a second authoritative dataset.

## A3 — Online Poker Flow

Skill defines layout/interaction aspirations. `pages/hub/poker/table/[tableId].js` and game components exist, but inspected Realtime callback logs updates rather than applying a refreshed snapshot. Engine source elsewhere does not prove route-to-engine end-to-end behavior. Replay/animation correctness remains `NOT_VERIFIABLE`.

VinPoker V21/V22 already separates public view, legal action menu, private hole cards and historical replay. Preserve server-returned view/version ordering. `INSPIRED_UI` only for action/state vocabulary after browser QA; no import of animation layouts or claim that external flow is faster/smoother.

## A4 — Poker Table UI

Skill mandates GoldenTemplateTable as sole implementation, but [PokerTableView](https://github.com/Smarter-Poker/Smarter-Poker-World-Hub/blob/6c6bec4e34e87d272f7e03ed6058ba6189607740/src/components/club-arena/game/PokerTableView.jsx#L28-L91) defines independent seat layouts and [renders controls](https://github.com/Smarter-Poker/Smarter-Poker-World-Hub/blob/6c6bec4e34e87d272f7e03ed6058ba6189607740/src/components/club-arena/game/PokerTableView.jsx#L124-L250). The rule is documentation; enforcement across consumers is partial.

VinPoker has distinct operator/spectator/replay/practice contexts, so a forced singleton may conflate different permission/data contracts. Evaluate seat readability/BB units/action focus by 375/430/desktop tasks in later UI work. `INSPIRED_UI`, not source-project mandatory design laws; `REJECT` forced architecture/UI rewrite.

## A5 — Poker Gameplay

[Action API](https://github.com/Smarter-Poker/Smarter-Poker-World-Hub/blob/6c6bec4e34e87d272f7e03ed6058ba6189607740/pages/api/poker/engine/action.js#L44-L80) derives player from authenticated identity. Optional idempotency insertion rejects 23505 but other lock errors are not fail-closed in that block. [Controller](https://github.com/Smarter-Poker/Smarter-Poker-World-Hub/blob/6c6bec4e34e87d272f7e03ed6058ba6189607740/src/lib/poker-engine/GameController.js#L1158-L1186) cancels a timer and calls in-memory processAction; no atomic action+balance ledger boundary was established for this inspected path. This is a concurrency/idempotency concern, not demonstrated live exploit.

[State machine payout](https://github.com/Smarter-Poker/Smarter-Poker-World-Hub/blob/6c6bec4e34e87d272f7e03ed6058ba6189607740/src/lib/poker-engine/GameStateMachine.js#L1868-L1955) invokes pot distribution, updates stacks and emits completion. [History persistence](https://github.com/Smarter-Poker/Smarter-Poker-World-Hub/blob/6c6bec4e34e87d272f7e03ed6058ba6189607740/src/lib/poker-engine/HandHistory.js#L226-L296) writes histories, which is distinct from durable financial settlement. Many engine test scripts exist; no current test run or exhaustive action/payout coverage proof.

VinPoker should preserve canonical server write paths, user-bound RPCs, exact context/version/intent receipts and its practice-versus-money separation. `ADOPT_PATTERN` for isolated engine seams/event vocabulary and selected scenario tests. `REJECT` porting in-memory financial authority, optional replay fences or third-party game engine wholesale. No benchmark performance superiority measured.

## A6 — PokerAtlas Competitor Knowledge

[Document](https://github.com/Smarter-Poker/Smarter-Poker-World-Hub/blob/6c6bec4e34e87d272f7e03ed6058ba6189607740/SKILL_POKERATLAS_COMPETITOR.md) is competitor knowledge, not implementation. Venue counts, adoption/pricing/history and feature superiority remain unverified; audit does not reuse those figures.

It provides useful questions—customer waitlist, schedule discoverability, operator workflow, onboarding—already mapped to VinPoker capabilities. `ADOPT_PATTERN` for discovery checklist only; `REJECT` using its commercial assertions to price VinPoker or assert gaps. Business value scores in 06 are hypotheses, not market facts.

## B1 — PokerFloor Manager

[Tournament.start](https://github.com/ArWro/PokerFloor_Manager/blob/89f4c051ec99f9910005abcc0aafa10a0fbcd2b1/src/Model/Tournament.java#L84-L141) validates a small field per table, shuffles registrations and round-robins across tables. [Eliminate/consolidate](https://github.com/ArWro/PokerFloor_Manager/blob/89f4c051ec99f9910005abcc0aafa10a0fbcd2b1/src/Controller/LiveTournamentController.java#L14-L134) updates placement and validates duplicate seat pairs; consolidation itself is manual. Useful explainable validation, but no stale plan/version/server transaction.

[Prize function](https://github.com/ArWro/PokerFloor_Manager/blob/89f4c051ec99f9910005abcc0aafa10a0fbcd2b1/src/Controller/LiveTournamentController.java#L143-L170) applies player-type multiplier after top-1/2/3 splits. Those multipliers can make sum exceed pool; scenario needs runtime test to quantify. Persistence serializes a whole object graph (`ObjectPlus` 26–35, `AppController` 12–44); no multi-user auth or recoverable transaction.

VinPoker V08 has locked/versioned plan/commit and deferred Tracker boundaries; keep those. `ADOPT_PATTERN` for clear duplicate-seat validation in preview explanations, not replace planner. `REJECT` prize multipliers/local file as club source of truth. Code reuse blocked by missing license. No tests/CI found, no execution.

## B2 — Poker Club Manager

Django/DRF has actual event/member/guest/point objects and permission machinery. [API](https://github.com/Kushallsaraf/poker-club-manager/blob/dc66a6affff4be0e6c21382164525bb63d195f17/poker_club_manager/events/api/views.py#L18-L123) has two concrete contract mismatches: remove-participant calls check_in_user; guest handler passes extra positional request.user to [model signature](https://github.com/Kushallsaraf/poker-club-manager/blob/dc66a6affff4be0e6c21382164525bb63d195f17/poker_club_manager/events/models.py#L165-L205). Source directly implies the inverse action and Python argument collision; not runtime reproduced here.

`get_permissions` treats only RSVP as self-authenticated; check-in requires global manage-event permission. This may be intentional; do not label an exploit. [Timer templates](https://github.com/Kushallsaraf/poker-club-manager/blob/dc66a6affff4be0e6c21382164525bb63d195f17/poker_club_manager/timers/views.py#L7-L21) are wired by timers URLs/config URLs without login decorators; DRF defaults do not protect plain Django views. Anonymous route reachability is a source fact, data sensitivity/live impact not tested.

Tests/pytest configuration exist, no run. GPL text permits later versions; manifests call GPLv3. VinPoker has more operational domains and object-derived club authority in newer RPCs. `ADOPT_PATTERN`: explicit participant entities and public API behavior tests. `REJECT`: global permission as tenant scope, broken remove/guest handlers. No HRM/payroll/CRM migration from this project.

## B3 — PokerPulsePro

[App clock](https://github.com/davidelvar/pokerpulsepro-tauri/blob/b8c0f0c7f81ef734ed369f2d563a05d6422ee9f2/src/App.tsx#L335-L391) decrements a second per interval, advances levels and supports pause on breaks. LocalStorage persists state. Browser throttle/suspend drift risk is mechanistic, not measured; VinPoker V05/V06 already uses server timestamp/monotonic anchor and explicit sync.

[Balance/move utilities](https://github.com/davidelvar/pokerpulsepro-tauri/blob/b8c0f0c7f81ef734ed369f2d563a05d6422ee9f2/src/utils.ts#L451-L498) move highest-seat player largest→smallest until gap≤1. Direct move utility lacks validation. VinPoker already has balanced break plan (migration 40); this is **not a missing algorithm**. Use fairness examples for tests and plan explanations, preserving seat locks, active hands and current-session fencing.

[Real utility tests](https://github.com/davidelvar/pokerpulsepro-tauri/blob/b8c0f0c7f81ef734ed369f2d563a05d6422ee9f2/src/test/utils.test.ts#L71-L230) import prize/rebuy/add-on functions. In contrast `src/test/tournament.test.ts` defines helpers locally, so passing those tests would not prove app utilities. Timer component tests cover display/callbacks, not App interval lifecycle. Rebuy counters do not establish re-entry identities. Fixed payout flooring/residue deserves tests; do not replace VinPoker payout calculator. `INSPIRED_UI` for operator/projector split; `ADOPT_PATTERN` for real-function tests; code reuse blocked by license.

## B4 — Royal Club Poker Timer

[Atoms](https://github.com/lucaspaulodev/royal-club-poker-timer/blob/c9d6a8deb997d2079adc4bf8be3428bc51efdceb/apps/web/src/lib/atoms.ts#L6-L90) implement play/level/time/tick/broadcast. [Break insert](https://github.com/lucaspaulodev/royal-club-poker-timer/blob/c9d6a8deb997d2079adc4bf8be3428bc51efdceb/apps/web/src/hooks/useAddTournamentLevel.tsx#L7-L26) creates an explicit 15-minute row. Compact display-state code is helpful; browser clock authority/cross-tab broadcast do not establish durable multi-device clock.

No seats/player lifecycle/backend/auth/tests identified. VinPoker already has explicit break levels and authenticated server clock. `INSPIRED_UI` for concise editor states only; `NOT_APPLICABLE` as core operations backend, `REJECT` replacing canonical clock. License absent.

## B5 — Poker Tournament Manager

[Model](https://github.com/codingstuff91/poker_tournament_manager/blob/93282ac4593654a19292a64dc6cdf7fee5ef21fa/src/models/Tournament.js#L23-L117) stores tournament metadata and participants. [Eliminate](https://github.com/codingstuff91/poker_tournament_manager/blob/93282ac4593654a19292a64dc6cdf7fee5ef21fa/src/models/Tournament.js#L218-L254) builds removal object but Mongo update only appends rank, leaving active list inconsistent. Repeated calls/ranks have no demonstrated idempotency fence.

[Routes](https://github.com/codingstuff91/poker_tournament_manager/blob/93282ac4593654a19292a64dc6cdf7fee5ef21fa/src/routers/tournamentRouter.js#L13-L177) leave create/register/unregister/eliminate unauthenticated in inspected router; auth is attached only to selected operations. The separate [JWT middleware](https://github.com/codingstuff91/poker_tournament_manager/blob/93282ac4593654a19292a64dc6cdf7fee5ef21fa/src/middlewares/auth.js#L15-L33) is not whole-router authorization. No tenant/creator validation proof, transaction/retry key or implemented edit handler. `dotenv: latest` in manifest is an unbounded dependency declaration, not a confirmed CVE.

MIT license allows review for reuse with notices, but `REJECT` all critical write/auth patterns. VinPoker V07/V10/V11 already models entry identity and durable request contracts more carefully. Small participant CRUD is not commercial benchmark superiority. One validator test file found, no test/CI execution.

## B6 — Club Commander Desktop

[BrowserWindow](https://github.com/Smarter-Poker/club-commander-desktop/blob/d1d73b063009cf796b9f1e75a843de0c3fe386d9/main.js#L10-L47) loads remote Commander login, disables Node integration, enables context isolation/web security. Good baseline prefs. [Navigation handler](https://github.com/Smarter-Poker/club-commander-desktop/blob/d1d73b063009cf796b9f1e75a843de0c3fe386d9/main.js#L222-L232) uses hostname substring matching; exact origin/redirect allowlist would be safer. No exploit was attempted.

[Preload](https://github.com/Smarter-Poker/club-commander-desktop/blob/d1d73b063009cf796b9f1e75a843de0c3fe386d9/preload.js#L4-L23) exposes small IPC/notification API; corresponding main-process listeners were not found. No local operations DB/offline queue found. Electron shell is not offline resilience. Proprietary declaration blocks copying. `NOT_APPLICABLE` for present launch; VinPoker web/PWA is less operational packaging to maintain. Revisit only for measured kiosk/printing/device requirements.

## Overall comparison decision

Không repo nào chứng minh thay thế được VinPoker's payroll/cashier/dealer/seat/ledger architecture. Đáng học nhất: source-ingest negative scenarios, waitlist vocabulary, explainable balancing, tests import actual implementation. Đáng giữ: server authority, entry/session identity, explicit unavailable data, immutable audit, receipt/version fencing. Performance superiority, cloud cost, working deployment and commercial adoption đều chưa đo/verify.
