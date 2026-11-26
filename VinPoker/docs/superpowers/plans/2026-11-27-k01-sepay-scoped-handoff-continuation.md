# K01 — Giữ đúng CLB và giao dịch khi mở đối soát

Mode: CRITICAL. Tiếp tục Draft PR #1687, không tạo writer đối soát mới.

Kế toán/thu ngân đang phục vụ giải B mở đối soát của B; khi chọn một khoản chuyển,
màn nhận và RPC phải giữ đúng CLB + ID khoản chuyển. Server vẫn quyết định quyền và
kết quả xác nhận. Liên kết và reader không ghi nhận thu, không đổi lương hay sao kê.

## Phạm vi

- Dùng lại candidate `sepay_cashier_settlement_scope_v1` và cờ mặc định tắt từ #1687.
- Giữ query `club`/`bank` qua TourCashierWorkbench → CashierDashboard → SePay tab.
- Với cờ mới bật, mở đối soát không kèm CLB phải chọn CLB hoặc chủ động chọn
  `scope=all`; chưa chọn thì không đọc danh sách chung. Link mâu thuẫn all + club/bank
  bị từ chối. Cờ tắt vẫn giữ đường vào cũ, không tự kích hoạt backend mới.
- Reader tự kiểm quyền, xác minh CLB theo tài khoản ngân hàng và tenant ghi trên khoản
  chuyển; lọc trước LIMIT. Đọc chính xác khoản đã xử lý không phụ thuộc bucket hiện tại.
  Giao dịch `matched`/`ignored` chỉ đọc, không hiện nút xác nhận hoặc bỏ qua.
- Không gửi recovery/retry của journal A trên màn B hoặc khi A không còn trong quyền
  hiện tại. Giữ journal; chỉ cho link trở về A khi danh sách quyền còn chứa A.
- Khi trang theo CLB đang mở, đọc lại server mỗi 5 giây, không chồng request hoặc kéo
  dài hạn chờ của request đang treo. Khi quyền bị từ chối, gỡ dữ liệu, dialog và hành
  động pending. Không xoá chứng từ hoặc journal.

## Kiểm chứng

1. Regression RED → GREEN cho pending A trên B, journal A đã mất quyền trên trang
   không kèm link, và server thu hồi quyền khi dữ liệu/dialog đang mở.
2. Giữ toàn bộ các test đọc/receipt/response-loss hiện có; test đường ra từ quầy.
3. Typecheck, build, credential/migration control/catalog và review chỉ đọc.
4. Runtime tách biệt dùng actual main + ops-main, Auth thật, Supabase client thật,
   PostgREST và PostgreSQL. Hai CLB/giải/tài khoản ngân hàng TEST; một người có quyền
   A và B. Đi qua link thật, đọc exact matched transfer, kiểm outsider/cross-club,
   pending journal và thu hồi B trên màn đang mở; A vẫn dùng được.
5. So fingerprint khoản chuyển/settlement trước và sau; không gửi money writer.
   Journal được cài trong ca runtime chỉ là trạng thái pending TEST, không phải bằng
   chứng một payment producer đã chạy. Realtime/SW/hosted production không được chấm
   từ harness này. Thử năm kích thước 320/375/414/768/1280.

## Rollback và phát hành

Tắt `VITE_SEPAY_SCOPED_HANDOFF_V1` để giữ hành vi cũ. Không xoá journal hoặc đổi receipt.
Rollback reader chỉ sau khi frontend không còn gọi nó; giữ đường xử lý chứng từ cũ.
Candidate migration có DROP FUNCTION rollback ghi ở đầu file; không sửa migration cũ.
Chưa merge/apply/deploy/bật cờ production. Gói phát hành phải có SHA/migration/flag,
checks và smoke đúng quyền trước khi xin một lần duyệt cuối. CI capture hết hạn phải
được khôi phục theo quy trình đã duyệt, không thay bằng schema dễ hơn.
