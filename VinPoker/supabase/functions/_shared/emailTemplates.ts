// Shared email template builders. Dark theme inline CSS.
const APP_URL = "https://vinpoker.live";
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));

function layout(opts: { title: string; intro: string; rows: Array<[string, string]>; cta: { label: string; href: string }; nextStep?: string }) {
  const href=new URL(opts.cta.href);
  if(!['https:','http:'].includes(href.protocol))throw new Error('invalid_email_cta');
  const rowsHtml = opts.rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 0;color:#9aa3b2;font-size:13px;">${escapeHtml(k)}</td><td style="padding:6px 0;color:#fff;font-size:14px;text-align:right;font-weight:600;">${escapeHtml(v)}</td></tr>`,
    )
    .join("");
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#0b0d12;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0d12;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#11151c;border:1px solid #1f2632;border-radius:14px;overflow:hidden;">
        <tr><td style="padding:20px 24px;border-bottom:1px solid #1f2632;">
          <div style="font-size:18px;font-weight:800;color:#fff;letter-spacing:.3px;">VBacker <span style="color:#22c55e;">Staking</span></div>
        </td></tr>
        <tr><td style="padding:24px;">
          <h1 style="margin:0 0 8px;color:#fff;font-size:20px;">${escapeHtml(opts.title)}</h1>
          <p style="margin:0 0 16px;color:#c5cbd6;font-size:14px;line-height:1.55;">${opts.intro}</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0d12;border:1px solid #1f2632;border-radius:10px;padding:12px 14px;margin:8px 0 18px;">
            ${rowsHtml}
          </table>
          ${opts.nextStep ? `<p style="margin:0 0 18px;color:#9aa3b2;font-size:13px;">${escapeHtml(opts.nextStep)}</p>` : ""}
          <p style="margin:18px 0 0;text-align:center;">
            <a href="${escapeHtml(href.href)}" style="display:inline-block;background:#22c55e;color:#0b0d12;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;font-size:14px;">${escapeHtml(opts.cta.label)}</a>
          </p>
        </td></tr>
        <tr><td style="padding:16px 24px;border-top:1px solid #1f2632;color:#6b7280;font-size:11px;text-align:center;">
          Đây là email tự động, vui lòng không trả lời. © VBacker
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

const fmtVnd = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("vi-VN").format(Number(n)) + " ₫";

function emailDealFunded(opts: { label: string; deal_id: string; escrow_vnd?: number | null }) {
  return {
    subject: "Đã xác nhận hỗ trợ — Sẵn sàng tham gia tập huấn",
    html: layout({
      title: "Đã xác nhận hỗ trợ chi phí",
      intro: `Phiếu hợp tác <b>${escapeHtml(opts.label)}</b> đã được Admin xác nhận. Bạn có thể tham gia tập huấn ngay.`,
      rows: [
        ["Phiếu hợp tác", opts.label],
        ["Cam kết tạm tính", fmtVnd(opts.escrow_vnd ?? null)],
        ["Trạng thái", "ĐÃ XÁC NHẬN"],
      ],
      nextStep: "Sau khi sự kiện kết thúc, vào mục “Phiếu đăng ký của tôi” để báo cáo thành tích.",
      cta: { label: "Xem chi tiết", href: `${APP_URL}/staking/my-deals` },
    }),
  };
}

export function emailResultDisputed(opts: { label: string; deal_id: string; reason?: string | null }) {
  return {
    subject: "Thành tích cần kiểm tra — Liên hệ Admin ngay",
    html: layout({
      title: "Thành tích đang được kiểm tra",
      intro: `Admin yêu cầu kiểm tra lại thành tích phiếu hợp tác <b>${escapeHtml(opts.label)}</b>.`,
      rows: [
        ["Phiếu hợp tác", opts.label],
        ["Trạng thái", "CẦN KIỂM TRA"],
        ["Lý do", opts.reason ? opts.reason.slice(0, 120) : "—"],
      ],
      nextStep: "Vui lòng liên hệ Admin để cung cấp bằng chứng bổ sung.",
      cta: { label: "Mở phiếu hợp tác", href: `${APP_URL}/staking/my-deals` },
    }),
  };
}

export function emailPayoutExecuted(opts: { label: string; deal_id: string; amount_vnd: number; role: "player" | "backer" }) {
  const isBacker = opts.role === "backer";
  return {
    subject: "Thanh toán hợp tác hoàn tất — Phiếu đã đóng",
    html: layout({
      title: "Thanh toán hợp tác hoàn tất",
      intro: isBacker
        ? `Phần chia của bạn từ phiếu hợp tác <b>${escapeHtml(opts.label)}</b> đã được chuyển theo thỏa thuận. Vui lòng kiểm tra ngân hàng.`
        : `Phiếu hợp tác <b>${escapeHtml(opts.label)}</b> đã đóng. Khoản chia đã được chuyển theo thỏa thuận.`,
      rows: [
        ["Phiếu hợp tác", opts.label],
        ["Số tiền nhận", fmtVnd(opts.amount_vnd)],
        ["Trạng thái", "HOÀN TẤT"],
      ],
      cta: { label: "Xem chi tiết", href: `${APP_URL}/staking/portfolio` },
    }),
  };
}

export function fundingConfirmedBackerEmail(opts: {
  dealShortId: string;
  clubName?: string | null;
  tournamentName?: string | null;
  amountVnd: number;
  percent?: number | null;
  ctaUrl?: string;
}) {
  const rows: Array<[string, string]> = [
    ["Phiếu", `#${opts.dealShortId}`],
  ];
  if (opts.clubName) rows.push(["CLB", opts.clubName]);
  if (opts.tournamentName) rows.push(["Sự kiện", opts.tournamentName]);
  if (opts.percent != null) rows.push(["Tỷ lệ hỗ trợ", `${opts.percent}%`]);
  rows.push(["Số tiền đã ghi nhận", fmtVnd(opts.amountVnd)]);
  rows.push(["Trạng thái", "Đã xác nhận"]);
  return {
    subject: `Đã ghi nhận hỗ trợ chi phí — Mã phiếu #${opts.dealShortId}`,
    html: layout({
      title: "Đã ghi nhận hỗ trợ chi phí",
      intro: `CLB đã xác nhận nhận được khoản hỗ trợ chi phí của bạn cho phiếu <b>#${escapeHtml(opts.dealShortId)}</b>.`,
      rows,
      nextStep: "VBacker là phần mềm quản lý thông tin. Thanh toán do các bên tự thực hiện.",
      cta: { label: "Xem chi tiết", href: opts.ctaUrl ?? `${APP_URL}/staking/portfolio` },
    }),
  };
}

export function fundingConfirmedPlayerEmail(opts: {
  dealShortId: string;
  clubName?: string | null;
  tournamentName?: string | null;
  amountVnd: number;
  fundedPercent: number;
  soldPercent: number;
  statusLabel: string;
  ctaUrl?: string;
}) {
  const rows: Array<[string, string]> = [
    ["Phiếu", `#${opts.dealShortId}`],
  ];
  if (opts.clubName) rows.push(["CLB", opts.clubName]);
  if (opts.tournamentName) rows.push(["Sự kiện", opts.tournamentName]);
  rows.push(["Số tiền vừa ghi nhận", fmtVnd(opts.amountVnd)]);
  rows.push(["Tổng % đã xác nhận", `${opts.fundedPercent}/${opts.soldPercent}%`]);
  rows.push(["Trạng thái phiếu", opts.statusLabel]);
  return {
    subject: `Đã xác nhận hỗ trợ chi phí — Phiếu #${opts.dealShortId}`,
    html: layout({
      title: "Có cập nhật mới cho phiếu của bạn",
      intro: `Một khoản hỗ trợ chi phí cho phiếu <b>#${escapeHtml(opts.dealShortId)}</b> vừa được CLB xác nhận.`,
      rows,
      cta: { label: "Xem phiếu", href: opts.ctaUrl ?? `${APP_URL}/staking/my-deals` },
    }),
  };
}

export function emailStakingRefund(opts: { label: string; percent: number; amount_vnd: number; reason: string }) {
  return { subject: `[VBacker] Hoàn tiền deal ${opts.label}`,
    html: layout({ title: 'Hoàn tiền deal', intro: 'Khoản đầu tư đã được ghi nhận hoàn trả.',
      rows: [['Deal', opts.label], ['Phần hợp tác', `${opts.percent}%`], ['Số tiền', fmtVnd(opts.amount_vnd)], ['Lý do', opts.reason]],
      cta: { label: 'Mở VBacker', href: 'https://vinpoker.vercel.app/' } }) };
}

export async function sendEmailViaFunction(supabaseUrl: string, serviceKey: string, payload: { to: string | string[]; subject: string; html: string }) {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      await res.text().catch(() => "");
      console.error("email_function_rejected", res.status);
    } else {
      await res.text();
    }
  } catch {
    console.error("email_function_unverified");
  }
}
