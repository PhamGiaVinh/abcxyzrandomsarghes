# External repository registry — snapshot 2026-10-15

Audit SOURCE-ONLY. Không install, postinstall, migration, scraper, desktop app hoặc test của bên thứ ba được chạy. Clone shallow chỉ phục vụ đọc source tại `D:/external/poker-room-benchmark-20261015/`, ngoài product repository. Không sao chép code vào VinPoker.

VinPoker baseline: `af51adc256855e3319d9dc4794ead8ca74d9537d`, fetch `origin/main` đầu task. Worktree: `D:/wt/poker-room-benchmark-20261015`, branch `codex/poker-room-benchmark-20261015`. Checkout chính có thay đổi của người khác; giữ nguyên. Không bổ sung repository ngoài danh sách.

## Registry đã kiểm tra

| ID | Repository và immutable snapshot | Stack đọc từ source | License evidence | Phạm vi thực sự | Giới hạn |
|---|---|---|---|---|---|
| A | [Smarter-Poker-World-Hub](https://github.com/Smarter-Poker/Smarter-Poker-World-Hub/tree/6c6bec4e34e87d272f7e03ed6058ba6189607740) | Next.js/React JS; API handlers; Supabase; engine JS; scraper Python/JS | Không có root LICENSE/COPYING trong commit tree; license của vendored Leaflet không cấp quyền cho whole app | Hub UI, integration Commander upstream, Arena API/game engine, tournament discovery | Source lớn, audit theo call paths đã chọn; Commander upstream không nằm trong repo |
| B1 | [ArWro/PokerFloor_Manager](https://github.com/ArWro/PokerFloor_Manager/tree/89f4c051ec99f9910005abcc0aafa10a0fbcd2b1) | Java/Swing, object serialization | Không tìm thấy license file | Local tournament/registration, seating, elimination, consolidation và fixed prizes | Single-process/local file; không tìm thấy test/CI; PDF không được dùng làm bằng chứng implementation |
| B2 | [Kushallsaraf/poker-club-manager](https://github.com/Kushallsaraf/poker-club-manager/tree/dc66a6affff4be0e6c21382164525bb63d195f17) | Django/DRF, Python; templates, Django auth | LICENSE: GPL-3.0-or-later; COPYING GPLv3; GitHub metadata `NOASSERTION` không thay thế nội dung license | Event participants/guests, membership/points, blind timer | Không phải HRM/payroll/multi-club operations tương đương VinPoker |
| B3 | [davidelvar/pokerpulsepro-tauri](https://github.com/davidelvar/pokerpulsepro-tauri/tree/b8c0f0c7f81ef734ed369f2d563a05d6422ee9f2) | React/TS/Vite + Tauri/Rust, browser localStorage | Không tìm thấy license file; package không khai báo license | Local clock, players, rebuy/add-on counters, seats, payout utilities, projector | Test source có thật nhưng chưa chạy; không có shared authoritative backend |
| B4 | [lucaspaulodev/royal-club-poker-timer](https://github.com/lucaspaulodev/royal-club-poker-timer/tree/c9d6a8deb997d2079adc4bf8be3428bc51efdceb) | React/Vite/Jotai/Turborepo | Không tìm thấy license file; package không khai báo license | Browser blind clock, editing levels/break rows, cross-tab state | Không tìm thấy seats/registration/payroll/server backend hoặc tests |
| B5 | [codingstuff91/poker_tournament_manager](https://github.com/codingstuff91/poker_tournament_manager/tree/93282ac4593654a19292a64dc6cdf7fee5ef21fa) | Vue 2/Express/MongoDB | [MIT LICENSE](https://github.com/codingstuff91/poker_tournament_manager/blob/93282ac4593654a19292a64dc6cdf7fee5ef21fa/LICENSE) | Tournament metadata, registration/elimination records, HTTP routes | Auth/consistency defects; rebuy metadata không chứng minh re-entry lifecycle |
| B6 | [Smarter-Poker/club-commander-desktop](https://github.com/Smarter-Poker/club-commander-desktop/tree/d1d73b063009cf796b9f1e75a843de0c3fe386d9) | Electron, remote web content, preload bridge | package.json khai báo Proprietary; không tìm thấy separate license grant | Remote Commander desktop wrapper | Không tìm thấy local operations database/offline sync; không có source tests được xác định |

GitHub repository APIs và `git clone` đều truy cập được cả 7 URL; đều public, không archived tại lúc kiểm tra. Default branch là `main`, riêng B5 là `master`. Không suy maturity từ star/commit count. Immutable SHAs lấy từ `git rev-parse HEAD`, không dùng SHA của cached web search.

## Skill/document coverage

| Unit | Requested reference | Kết quả đọc |
|---|---|---|
| A1 | `.agent/skills/club-commander/` | Đủ 10 file: SKILL.md, BUILD_PLAN.md, COMPETITOR_ANALYSIS.md, DATABASE_SCHEMA.sql, API_REFERENCE.md, IMPLEMENTATION_PHASES.md, ENHANCEMENTS.md, DEPLOYMENT.md, EXPANSION.md, SCOPE_LOCK.md |
| A2 | `.agent/skills/tournament-source-registry/SKILL.md` | Đọc skill, registry data và consumer/schedule/test source |
| A3 | `.agent/skills/online-poker-flow/SKILL.md` | Đọc skill; trace table route, state component/engine và Realtime callback |
| A4 | `.agent/skills/poker-table-ui/SKILL.md` | Đọc skill; đối chiếu GoldenTemplateTable rule với PokerTableView implementation |
| A5 | `.agent/skills/poker-gameplay/SKILL.md` | Đọc skill; trace action API → GameController → state machine/pots → hand history |
| A6 | `SKILL_POKERATLAS_COMPETITOR.md` | Đọc như tài liệu đối thủ; các claim thương mại chưa có xác nhận độc lập |

Sáu reference units A và sáu units B tạo **12 báo cáo riêng theo section trong 03**; underlying repositories là **7**, không phải 12. Đây là audit source theo capabilities, không phải exhaustive review mọi dòng của World Hub hoặc VinPoker.

## License và commercial reuse

- `ADOPT_PATTERN`/`INSPIRED_UI`: học vấn đề và tự thiết kế từ contract VinPoker; không chép biểu đạt/code/assets. Không tuyên bố mọi ý tưởng đều tự động miễn nghĩa vụ pháp lý.
- `ADAPT_ALGORITHM`/`REUSE_WITH_LICENSE_REVIEW`: chỉ xét sau quyền phù hợp cho source cụ thể, attribution, dependency license và mô hình phân phối. Các repo thiếu license **không được mặc định là open source có quyền thương mại**.
- GPLv3 không cấm dùng thương mại, nhưng copy/distribute derivative có nghĩa vụ GPL; báo cáo này không cấp legal clearance cho VinPoker. Ưu tiên clean implementation từ domain requirement.
- B5 có MIT nhưng chất lượng không đủ để port integrity/auth paths. Giấy phép thuận lợi không biến code thành an toàn.
- B6 Proprietary: `REJECT` đối với copy code. Chỉ tham khảo nhu cầu operator desktop.

Không truy vấn dependency vulnerability database, không chạy package audit, không benchmark runtime; CVE/current dependency risk là `NOT_VERIFIABLE` trong lượt này. Manifests/lockfiles/install hooks được xem như supply-chain surfaces, không được thực thi.

## Evidence policy dùng chung

`IMPLEMENTED_AND_TESTED` chỉ dùng khi behavior implementation đã chạy test phù hợp ở đúng snapshot trong audit này. Test file tồn tại không đủ. Các status còn lại: `IMPLEMENTED_NOT_TESTED`, `PARTIALLY_IMPLEMENTED`, `DOCUMENTED_ONLY`, `MOCK_OR_STUB`, `NOT_FOUND`, `NOT_VERIFIABLE`.

`NOT_FOUND` luôn có phạm vi: không tìm được trong tracked tree/call paths khảo sát, không phải tuyên bố năng lực không tồn tại ở service riêng. `HYPOTHESIS_NEEDS_VALIDATION` là confidence của finding, không thay status capability.

Không đọc `.env`, connection strings, browser auth state, backup hoặc dữ liệu người thật. URLs trong báo cáo là source references, không phải destination được phép gửi corpus.
