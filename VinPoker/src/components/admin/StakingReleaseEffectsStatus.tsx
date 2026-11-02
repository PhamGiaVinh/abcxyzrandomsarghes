import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { parseStakingReleaseDelivery, type StakingReleaseDelivery } from '@/lib/stakingReleaseDelivery';

type Props = { requestId: string; dealId: string };
export function StakingReleaseEffectsStatus(props: Props) {
  const { user, loading } = useAuth();
  if (loading || !user) return <p role="status">Đang xác minh phiên đăng nhập…</p>;
  return <StatusScope key={`${user.id}:${props.requestId}:${props.dealId}`} {...props} />;
}
function StatusScope({ requestId, dealId }: Props) {
  const active = useRef(true), busy = useRef(false);
  const [processing, setProcessing] = useState(false);
  useEffect(() => { active.current = true;return () => { active.current = false; }; }, []);
  const [status, setStatus] = useState<StakingReleaseDelivery | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(false), [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;setLoading(true);setError(false);
    const rpc = supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
    void (async () => {
      try {
        const result = await rpc.call(supabase, 'get_staking_release_effect_status_v1', { p_request: requestId });
        if (!active) return;
        const parsed = parseStakingReleaseDelivery(result.data, requestId, dealId);
        if (result.error || !parsed) throw new Error('status_unavailable');
        setStatus(parsed);
      } catch { if (active) setError(true); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [requestId, dealId, revision]);
  const continuePending = async () => {
    if (busy.current || loading || error || !status || status.pending < 1) return;
    busy.current = true;setProcessing(true);
    try {
      const result = await supabase.functions.invoke('staking-process-release-effects', { body: { release_request_id: requestId } });
      if (!active.current) return;
      const parsed = parseStakingReleaseDelivery(result.data?.delivery, requestId, dealId);
      if (result.error || result.data?.ok !== true || result.data?.release_request_id !== requestId || !parsed) throw new Error('continuation_unverified');
      setStatus(parsed);
    } catch { if (active.current) setError(true); }
    finally { busy.current = false;if (active.current) setProcessing(false); }
  };
  return <section className="space-y-3 text-sm" aria-busy={loading || processing}>
    {loading ? <p role="status">Đang đọc trạng thái hậu xử lý…</p>
      : error || !status ? <p role="alert">Không xác minh được trạng thái thông báo/kết quả. Không coi là đã xử lý xong.</p>
      : <>
        <p role="status">{status.state === 'all_delivered' ? 'Đã ghi sổ cái và xử lý xong thông báo/kết quả.'
          : status.state === 'needs_attention' ? 'Đã ghi sổ cái. Có thông báo/kết quả cần kiểm tra; không tự gửi lại.'
          : 'Đã ghi sổ cái. Thông báo/kết quả còn chờ xử lý.'}</p>
        <p>Đã xử lý: {status.delivered}/{status.total} · Chờ: {status.pending} · Đang xử lý: {status.processing} · Cần kiểm tra: {status.needs_attention}</p>
        {status.evidence_missing && <p role="alert">Chưa có bằng chứng tạo hàng đợi cho yêu cầu này.</p>}
      </>}
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={loading || processing} onClick={() => setRevision(value => value + 1)}>Tải lại trạng thái hậu xử lý</Button>
      {!loading && !error && !!status && status.pending > 0 && <Button disabled={processing} onClick={() => void continuePending()}>Xử lý phần còn chờ</Button>}
    </div>
  </section>;
}
