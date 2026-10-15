import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { MapPin, Star, Calendar, Loader2, Spade } from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { formatDateTime, formatVND } from "@/lib/format";
import { FomoPrice } from "@/components/FomoPrice";
import royalPokerLogo from "@/assets/royal-poker-logo.jpg";
import { useTranslation } from "react-i18next";
import { FEATURES } from "@/lib/featureFlags";
import { ImageCarousel } from "@/components/ImageCarousel";
import { LegacyScheduleEvidenceNote } from "@/components/LegacyScheduleEvidenceNote";

const ClubDetail = () => {
  const { t } = useTranslation();
  const { id } = useParams();
  const nav = useNavigate();
  const [club, setClub] = useState<any>(null);
  const [tours, setTours] = useState<any[]>([]);
  const [seriesImgs, setSeriesImgs] = useState<{ image_url: string; caption: string | null }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [{ data: c }, { data: t }] = await Promise.all([
        supabase.from("clubs").select("*").eq("id", id!).maybeSingle(),
        supabase.from("tournaments").select("*").eq("club_id", id!).gte("start_time", new Date(Date.now() - 24*60*60*1000).toISOString()).order("start_time"),
      ]);
      setClub(c); setTours(t ?? []); setLoading(false);
      // Club "Lịch series" gallery (gated): swipeable carousel below the day/week images.
      if (FEATURES.clubSeriesSchedule && id) {
        const { data: imgs } = await (supabase as any)
          .from("club_series_images")
          .select("image_url, caption, position")
          .eq("club_id", id)
          .order("position");
        setSeriesImgs(((imgs ?? []) as any[]).map((r) => ({ image_url: r.image_url, caption: r.caption ?? null })));
      }
    })();
  }, [id]);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  if (!club) return <p className="text-center py-20 text-muted-foreground">{t("clubsPage.clubNotFound")}</p>;

  return (
    <div className="space-y-4">
      <BackButton label={t("clubsPage.back")} />

      <Card className="gradient-card border-gold p-5 shadow-gold">
        <div className="flex items-start gap-3">
          <div className="w-16 h-16 rounded-xl overflow-hidden flex items-center justify-center shadow-gold bg-background">
            {club.cover_url ? (
              <img src={club.cover_url} alt={club.name} className="w-full h-full object-cover" />
            ) : /royal\s*poker/i.test(club.name) ? (
              <img src={royalPokerLogo} alt={club.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full gradient-gold flex items-center justify-center">
                <Spade className="w-8 h-8 text-primary-foreground" />
              </div>
            )}
          </div>
          <div className="flex-1">
            <h1 className="font-display text-2xl">{club.name}</h1>
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1"><MapPin className="w-3 h-3" />{club.address}</p>
            <div className="flex items-center gap-1 text-gold font-semibold mt-2">
              <Star className="w-4 h-4 fill-current" /> {(/quads\s*poker/i.test(club.name) ? 5.0 : 4.8).toFixed(1)} · {club.region}
            </div>
          </div>
        </div>
        {club.description && <p className="text-sm text-muted-foreground mt-3">{club.description}</p>}
        {club.schedule && (
          <div className="mt-3 flex items-center gap-2 text-sm">
            <Calendar className="w-4 h-4 text-gold" /><span>{club.schedule}</span>
          </div>
        )}
      </Card>

      {(club.daily_schedule_image_url || club.weekly_schedule_image_url) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {club.daily_schedule_image_url && (
            <Card className="p-2 overflow-hidden">
              <div className="text-xs font-semibold text-gold mb-2 px-1">{t('clubDetail.dailySchedule')}</div>
              <img src={club.daily_schedule_image_url} alt="Daily schedule" className="w-full h-auto object-contain rounded-md" />
              <LegacyScheduleEvidenceNote />
            </Card>
          )}
          {club.weekly_schedule_image_url && (
            <Card className="p-2 overflow-hidden">
              <div className="text-xs font-semibold text-gold mb-2 px-1">{t('clubDetail.weeklySchedule')}</div>
              <img src={club.weekly_schedule_image_url} alt="Weekly schedule" className="w-full h-auto object-contain rounded-md" />
              <LegacyScheduleEvidenceNote />
            </Card>
          )}
        </div>
      )}

      {FEATURES.clubSeriesSchedule && seriesImgs.length > 0 && (
        <div>
          <h2 className="font-display text-lg text-gold mb-2">Lịch series</h2>
          <ImageCarousel images={seriesImgs} />
        </div>
      )}

      <div>
        <h2 className="font-display text-lg text-gold mb-2">{t("clubsPage.upcomingTournaments")}</h2>
        {tours.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("clubsPage.noTournaments")}</p>
        ) : (
          <div className="space-y-2">
            {tours.map(t => (
              <Link key={t.id} to={`/tournament/${t.id}`}>
                <Card className="p-3 hover:border-gold transition-colors">
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="font-semibold">{t.name}</div>
                      <div className="text-xs text-muted-foreground">{formatDateTime(t.start_time)}</div>
                    </div>
                    <FomoPrice tournament={t} />
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ClubDetail;
