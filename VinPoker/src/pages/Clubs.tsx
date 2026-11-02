import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {observeTrackerContextRead} from "@/lib/tournament/observeTrackerContextRead";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { MapPin, Star, Loader2, Spade } from "lucide-react";
import royalPokerLogo from "@/assets/royal-poker-logo.jpg";
import { useTranslation } from "react-i18next";

type ClubListRow={id:string;name:string;address?:string|null;region?:string|null;cover_url?:string|null;rating?:number|string|null;schedule_sort_order?:number|null};
const isClubRow=(value:unknown):value is ClubListRow=>{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const row=value as Record<string,unknown>;
 return typeof row.id==='string'&&!!row.id.trim()&&typeof row.name==='string'
  && ['address','region','cover_url'].every(key=>row[key]==null||typeof row[key]==='string')
  && (row.schedule_sort_order==null||typeof row.schedule_sort_order==='number'&&Number.isFinite(row.schedule_sort_order))
  && (row.rating==null||(typeof row.rating==='number'||typeof row.rating==='string'&&row.rating.trim()!=='')&&Number.isFinite(Number(row.rating)));
};
const REGIONS = ["All", "TP.HCM", "Hanoi", "Da Nang"];

const Clubs = () => {
  const { t } = useTranslation();
  const [clubs, setClubs] = useState<ClubListRow[]>([]);
  const [region, setRegion] = useState("All");
  const [sort, setSort] = useState("curated");
  const [loading, setLoading] = useState(true);

  const [readError,setReadError]=useState(false),[attempt,setAttempt]=useState(0);

  useEffect(() => {
    let active=true;const controller=new AbortController();setLoading(true);setReadError(false);setClubs([]);
    void (async()=>{
      try {
        const {data,error}=await observeTrackerContextRead(supabase.from('clubs').select('*').eq('status','approved').order('schedule_sort_order',{ascending:true}).order('name').abortSignal(controller.signal));
        if(!active)return;
        if(error||!Array.isArray(data)||!data.every(isClubRow)||new Set(data.map(row=>row.id)).size!==data.length)throw new Error('clubs_unavailable');
        setClubs(data);
      }catch{controller.abort();if(active)setReadError(true);}
      finally{if(active)setLoading(false);}
    })();
    return()=>{active=false;controller.abort();};
  }, [attempt]);

  const filtered = useMemo(() => {
    const r = clubs.filter(c => region === "All" || c.region === region);
    r.sort((a, b) => {
      if (sort === "rating") return Number(b.rating) - Number(a.rating);
      if (sort === "name") return a.name.localeCompare(b.name);
      // curated: schedule_sort_order asc, then name
      const oa = a.schedule_sort_order ?? 0;
      const ob = b.schedule_sort_order ?? 0;
      if (oa !== ob) return oa - ob;
      return a.name.localeCompare(b.name);
    });
    return r;
  }, [clubs, region, sort]);

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-card via-card to-background px-6 py-12 md:px-10 md:py-16">
        {/* Decorative glow effects */}
        <div className="pointer-events-none absolute -top-20 -right-20 w-72 h-72 rounded-full bg-primary/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-16 w-80 h-80 rounded-full bg-primary/10 blur-[120px]" />

        {/* Content */}
        <div className="relative z-10 space-y-4">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 backdrop-blur-sm w-fit">
            <span className="text-[10px] font-bold tracking-[0.28em] uppercase text-primary">CLB</span>
          </div>

          {/* Title */}
          <h1 className="font-display text-3xl md:text-5xl lg:text-6xl tracking-[0.04em] text-primary leading-[0.9] drop-shadow-[0_0_24px_hsl(var(--primary)/0.35)]">
            {t("clubsPage.title")}
          </h1>

          {/* Subtitle */}
          <p className="text-sm md:text-base text-muted-foreground leading-relaxed max-w-2xl">
            {t("clubsPage.subtitle")}
          </p>

          {/* Chronograph divider */}
          <div className="flex items-center gap-2 pt-2 max-w-md">
            <div className="flex-1 h-[1px] bg-primary/60" />
            <div className="w-2 h-2 bg-primary rotate-45 shrink-0 shadow-[0_0_8px_hsl(var(--primary))]" />
            <div className="flex-1 h-[1px] bg-primary/30" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Select value={region} onValueChange={setRegion}>
          <SelectTrigger className="bg-card/50 border-border/40"><SelectValue /></SelectTrigger>
          <SelectContent>{REGIONS.map(r => <SelectItem key={r} value={r}>{r === "All" ? t("clubsPage.allRegions") : r}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="bg-card/50 border-border/40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="curated">{t("clubsPage.sortCurated")}</SelectItem>
            <SelectItem value="rating">{t("clubsPage.sortRating")}</SelectItem>
            <SelectItem value="name">{t("clubsPage.sortName")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div role="status" aria-label="Đang tải CLB" className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : readError ? (
        <div role="alert" className="space-y-3 py-8 text-center"><p>Không tải được danh sách CLB. Vui lòng thử lại.</p><Button variant="outline" onClick={()=>setAttempt(value=>value+1)}>Thử lại</Button></div>
      ) : filtered.length===0 ? (
        <p role="status" className="py-8 text-center text-muted-foreground">Không có CLB phù hợp với bộ lọc.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filtered.map(c => (
            <Link key={c.id} to={`/club/${c.id}`}>
              <Card className="bg-gradient-to-br from-card/60 to-card/40 border-border/40 hover:border-gold/40 transition-all p-5 backdrop-blur-sm">
                <div className="flex gap-3">
                  <div className="w-16 h-16 rounded-xl overflow-hidden flex items-center justify-center shrink-0 shadow-gold bg-background">
                    {c.cover_url ? (
                      <img src={c.cover_url} alt={c.name} className="w-full h-full object-cover" />
                    ) : /royal\s*poker/i.test(c.name) ? (
                      <img src={royalPokerLogo} alt={c.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full gradient-gold flex items-center justify-center">
                        <Spade className="w-8 h-8 text-primary-foreground" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-display font-semibold text-base truncate">{c.name}</h3>
                      <Badge variant="outline" className="border-success/40 text-success shrink-0">{t("clubsPage.open")}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                      <MapPin className="w-3 h-3" /> {c.address}
                    </p>
                    <div className="flex items-center gap-2 mt-2 text-xs">
                      <span className="flex items-center gap-0.5 text-gold font-semibold">
                        <Star className="w-3.5 h-3.5 fill-current" /> {c.rating == null ? "—" : Number(c.rating).toFixed(1)}
                      </span>
                      <span className="text-muted-foreground">· {c.region}</span>
                    </div>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};

export default Clubs;
