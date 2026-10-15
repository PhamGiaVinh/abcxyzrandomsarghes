import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PerformanceCard } from "@/components/PerformanceCard";
import { InterestDialog } from "@/components/InterestDialog";
import { BackButton } from "@/components/BackButton";
import { Star, Flag, Phone, Calendar, MapPin, Trophy } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

const fmt = (n: number) => new Intl.NumberFormat("vi-VN").format(n);

const PlayerProfile = () => {
  const { t } = useTranslation();
  const { userId } = useParams();
  const { user, isAdmin } = useAuth() as any;

  const toggleProfileVerified = async (current: boolean) => {
    if (!userId) return;
    const { error } = await supabase.from("profiles").update({ is_verified: !current }).eq("user_id", userId);
    if (error) return toast.error(error.message);
    await supabase.from("player_stats").update({ verified: !current }).eq("player_id", userId);
    toast.success(!current ? t("playerProfile.verifiedToast") : t("playerProfile.unverifiedToast"));
    setPubProfile((p: any) => p ? { ...p, profile: { ...p.profile, is_verified: !current } } : p);
    setStats((s: any) => s ? { ...s, verified: !current } : s);
  };

  const toggleResultVerified = async (rid: string, current: boolean) => {
    const { error } = await supabase.from("player_results").update({ verified_by_admin: !current }).eq("id", rid);
    if (error) return toast.error(error.message);
    toast.success(!current ? t("playerProfile.resultVerifiedToast") : t("playerProfile.resultUnverifiedToast"));
    setResults((rs) => rs.map((r) => r.id === rid ? { ...r, verified_by_admin: !current } : r));
  };
  const [profile, setProfile] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [reviews, setReviews] = useState<any[]>([]);
  const [reviewerNames, setReviewerNames] = useState<Map<string, string>>(new Map());
  const [showInterest, setShowInterest] = useState(false);
  const [contacted, setContacted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [upcoming, setUpcoming] = useState<any[]>([]);
  const [eventProofs, setEventProofs] = useState<Map<string, any[]>>(new Map());
  const [results, setResults] = useState<any[]>([]);
  const [pubProfile, setPubProfile] = useState<any>(null);

  useEffect(() => {
    if (!userId) return;
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-public-profile?userId=${userId}`, {
      headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "" },
    })
      .then((r) => r.json())
      .then((d) => setPubProfile(d))
      .catch(() => {});
  }, [userId]);


  useEffect(() => {
    if (!userId) return;
    const load = async () => {
      const [{ data: p }, { data: s }, { data: r }, { data: ev }, { data: res }] = await Promise.all([
        supabase.from("profiles").select(user?.id
          ? "user_id,display_name,region,phone,avatar_url"
          : "user_id,display_name,region,avatar_url").eq("user_id", userId).maybeSingle(),
        supabase.from("player_stats").select("*").eq("player_id", userId).maybeSingle(),
        supabase.from("backer_reviews").select("*").eq("player_id", userId).order("created_at", { ascending: false }),
        supabase.from("player_upcoming_events").select("*").eq("player_id", userId).gte("event_date", new Date().toISOString()).order("event_date", { ascending: true }),
        supabase.from("player_results").select("*").eq("player_id", userId).order("event_date", { ascending: false }).limit(50),
      ]);
      setProfile(p);
      setStats(s);
      setReviews(r ?? []);
      setUpcoming(ev ?? []);
      setResults(res ?? []);
      const evIds = (ev ?? []).map((x: any) => x.id);
      if (evIds.length) {
        const { data: pr } = await supabase.from("event_proofs").select("*").in("event_id", evIds);
        const m = new Map<string, any[]>();
        (pr ?? []).forEach((x: any) => {
          const arr = m.get(x.event_id) ?? [];
          arr.push(x);
          m.set(x.event_id, arr);
        });
        setEventProofs(m);
      }
      const bIds = [...new Set((r ?? []).map((x: any) => x.backer_id))];
      if (bIds.length) {
        const { data: bp } = await supabase.from("profiles").select("user_id,display_name").in("user_id", bIds);
        setReviewerNames(new Map((bp ?? []).map((x: any) => [x.user_id, x.display_name])));
      }
      if (user?.id) {
        const { data: ints } = await supabase
          .from("backing_interests")
          .select("status")
          .eq("player_id", userId)
          .eq("interested_user_id", user.id)
          .eq("status", "contacted")
          .limit(1);
        setContacted((ints ?? []).length > 0);
      }
      setLoading(false);
    };
    load();
  }, [userId, user?.id]);

  const reportScam = () => {
    toast.success(t("playerProfile.reportRecorded"));
  };

  if (loading) return <div className="text-center py-12 text-muted-foreground">{t("playerProfile.loading")}</div>;
  if (!profile) return <div className="text-center py-12 text-muted-foreground">{t("playerProfile.notFound")}</div>;

  const avgRating = reviews.length ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1) : "—";

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <BackButton />
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{profile.display_name}</h1>
          <div className="text-sm text-muted-foreground mt-1">{profile.region ?? "—"}</div>
        </div>
        <Button variant="ghost" size="sm" onClick={reportScam} className="text-muted-foreground hover:text-destructive">
          <Flag className="w-4 h-4 mr-1" /> {t("playerProfile.reportScam")}
        </Button>
      </div>

      {stats ? (
        <PerformanceCard stats={stats} displayName={profile.display_name} />
      ) : (
        <Card><CardContent className="py-8 text-center text-muted-foreground">{t("playerProfile.noStats")}</CardContent></Card>
      )}

      {stats?.looking_for_backing && (
        <Card className="border-primary/40 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>{t("playerProfile.lookingForBacker")}</span>
              {stats.backing_percentage_available && (
                <Badge className="bg-primary text-primary-foreground">{t("playerProfile.available", { n: stats.backing_percentage_available })}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {stats.backing_description && (
              <p className="text-sm whitespace-pre-wrap">{stats.backing_description}</p>
            )}
            {user?.id && contacted && profile.phone ? (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-success/10 border border-success/30">
                <Phone className="w-4 h-4 text-success" />
                <span className="text-sm">{t("playerProfile.contactZalo")} <strong>{profile.phone}</strong></span>
              </div>
            ) : null}
            {user?.id !== userId && (
              <Button onClick={() => setShowInterest(true)} className="w-full">
                {t("playerProfile.interestedCta")}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {upcoming.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Calendar className="w-5 h-5 text-primary" /> {t("playerProfile.upcomingTitle", { n: upcoming.length })}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {upcoming.map((e) => {
              const proofs = eventProofs.get(e.id) ?? [];
              return (
                <div key={e.id} className="rounded-lg border border-border/40 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="font-semibold">{e.event_name}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-3 mt-0.5">
                        <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{new Date(e.event_date).toLocaleDateString()}</span>
                        {e.venue && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{e.venue}</span>}
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {e.buy_in > 0 && <Badge variant="outline" className="text-xs">{t("playerProfile.buyIn", { amount: fmt(e.buy_in) })}</Badge>}
                        <Badge className="bg-primary/20 text-primary border-primary/40 text-xs">{t("playerProfile.sellPercent", { p: e.selling_percentage, m: e.markup })}</Badge>
                      </div>
                      {e.notes && <p className="text-xs text-muted-foreground italic mt-2">"{e.notes}"</p>}
                    </div>
                    {user?.id !== userId && stats?.looking_for_backing && (
                      <Button size="sm" onClick={() => setShowInterest(true)}>{t("playerProfile.interest")}</Button>
                    )}
                  </div>
                  {proofs.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-border/30">
                      {proofs.map((p) => (
                        <a key={p.id} href={p.image_url} target="_blank" rel="noreferrer">
                          <img src={p.image_url} alt="proof" className="h-20 w-20 object-cover rounded border border-border hover:border-primary" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {results.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Trophy className="w-5 h-5 text-warning" /> {t("playerProfile.achievements", { n: results.length })}</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {results.map((r) => {
                const profit = r.prize - r.buy_in;
                return (
                  <div key={r.id} className="flex items-center justify-between gap-2 py-2 border-b border-border/30 last:border-0">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm truncate">{r.tournament_name}</span>
                        {r.verified_by_admin && <Badge className="bg-[hsl(var(--ds-active)_/_0.2)] text-[hsl(var(--ds-active))] border-[hsl(var(--ds-active)_/_0.4)] text-[10px] shrink-0">✓</Badge>}
                        {isAdmin && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-5 px-2 text-[10px] border-[hsl(var(--ds-active)_/_0.4)] text-[hsl(var(--ds-active))] shrink-0"
                            onClick={() => toggleResultVerified(r.id, !!r.verified_by_admin)}
                          >
                            {r.verified_by_admin ? t("playerProfile.unverifyBtn") : t("playerProfile.verifyBtn")}
                          </Button>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(r.event_date).toLocaleDateString()}
                        {r.position && ` • ${t("playerProfile.rank")} ${r.position}${r.total_entries ? `/${r.total_entries}` : ""}`}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`text-sm font-bold ${profit >= 0 ? "text-success" : "text-destructive"}`}>
                        {profit >= 0 ? "+" : ""}{fmt(profit)}
                      </div>
                      <div className="text-[10px] text-muted-foreground">{fmt(r.prize)}đ</div>
                    </div>
                    {false && r.proof_url && (
                      <a href={r.proof_url} target="_blank" rel="noreferrer" className="shrink-0">
                        <img src={r.proof_url} alt="" className="h-10 w-10 object-cover rounded border border-border" />
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {pubProfile && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2 flex-wrap">
              <span>{t("playerProfile.stakingActivity")}</span>
              <div className="flex items-center gap-2">
                {pubProfile.profile?.is_verified && (
                  <Badge className="bg-[hsl(var(--ds-active)_/_0.2)] text-[hsl(var(--ds-active))] border-[hsl(var(--ds-active)_/_0.4)]">{t("playerProfile.verifiedBadge")}</Badge>
                )}
                {isAdmin && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs border-[hsl(var(--ds-active)_/_0.4)] text-[hsl(var(--ds-active))]"
                    onClick={() => toggleProfileVerified(!!pubProfile.profile?.is_verified)}
                  >
                    {pubProfile.profile?.is_verified ? t("playerProfile.unverifyPlayer") : t("playerProfile.verifyPlayer")}
                  </Button>
                )}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">{t("playerProfile.asPlayer")}</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MiniStat label={t("playerProfile.dealsCreated")} value={String(pubProfile.player?.dealsCreated ?? 0)} />
                <MiniStat label={t("playerProfile.dealsCompleted")} value={String(pubProfile.player?.dealsCompleted ?? 0)} />
                <MiniStat label={t("playerProfile.itm")} value={String(pubProfile.player?.itmCount ?? 0)} />
                <MiniStat
                  label={t("playerProfile.avgRoi")}
                  value={`${(pubProfile.player?.avgRoi ?? 0).toFixed(1)}%`}
                  tone={(pubProfile.player?.avgRoi ?? 0) >= 0 ? "success" : "destructive"}
                />
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">{t("playerProfile.asBacker")}</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MiniStat label={t("playerProfile.totalStaked")} value={fmt(pubProfile.backer?.totalStaked ?? 0)} />
                <MiniStat label={t("playerProfile.totalReturned")} value={fmt(pubProfile.backer?.totalReturned ?? 0)} />
                <MiniStat
                  label={t("playerProfile.netPnl")}
                  value={`${(pubProfile.backer?.netPnl ?? 0) >= 0 ? "+" : ""}${fmt(pubProfile.backer?.netPnl ?? 0)}`}
                  tone={(pubProfile.backer?.netPnl ?? 0) >= 0 ? "success" : "destructive"}
                />
                <MiniStat label={t("playerProfile.activeStakes")} value={String(pubProfile.backer?.activeCount ?? 0)} />
              </div>
            </div>
            {pubProfile.ratings?.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    {t("playerProfile.dealRatings", { n: pubProfile.ratings.length })}
                  </div>
                  <span className="flex items-center gap-1 text-warning text-sm">
                    <Star className="w-4 h-4 fill-current" />
                    {Number(pubProfile.profile?.rating_avg ?? 0).toFixed(1)}/5
                  </span>
                </div>
                <div className="space-y-2">
                  {pubProfile.ratings.slice(0, 10).map((r: any) => (
                    <div key={r.id} className="border-l-2 border-primary/40 pl-3 py-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">
                          {r.rater?.display_name ?? t("playerProfile.anonymous")}
                          <span className="ml-1.5 text-[10px] text-muted-foreground">({r.role === "player" ? t("playerProfile.rolePlayer") : t("playerProfile.roleBacker")})</span>
                        </span>
                        <div className="flex items-center gap-0.5 text-warning">
                          {Array.from({ length: r.rating }).map((_, i) => <Star key={i} className="w-3 h-3 fill-current" />)}
                        </div>
                      </div>
                      {r.comment && <p className="text-sm text-muted-foreground mt-1">{r.comment}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>{t("playerProfile.trust")}</span>
            <span className="flex items-center gap-1 text-warning">
              <Star className="w-4 h-4 fill-current" /> {avgRating}/5 ({t("playerProfile.reviewCount", { n: reviews.length })})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {reviews.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("playerProfile.noReviews")}</p>
          ) : (
            <div className="space-y-3">
              {reviews.map((r) => (
                <div key={r.id} className="border-l-2 border-primary/40 pl-3 py-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{reviewerNames.get(r.backer_id) ?? t("playerProfile.backer")}</span>
                    <div className="flex items-center gap-0.5 text-warning">
                      {Array.from({ length: r.rating }).map((_, i) => <Star key={i} className="w-3 h-3 fill-current" />)}
                    </div>
                  </div>
                  {r.comment && <p className="text-sm text-muted-foreground mt-1">{r.comment}</p>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground text-center border-t border-border/40 pt-4">
        {t("playerProfile.disclaimer")}
      </div>

      <InterestDialog
        open={showInterest}
        onOpenChange={setShowInterest}
        playerId={userId!}
        playerName={profile.display_name}
      />
    </div>
  );
};

const MiniStat = ({ label, value, tone }: { label: string; value: string; tone?: "success" | "destructive" }) => {
  const colorClass = tone === "success" ? "text-success" : tone === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <div className="rounded-lg border border-border/40 bg-card/30 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-bold text-sm mt-1 ${colorClass}`}>{value}</div>
    </div>
  );
};

export default PlayerProfile;
