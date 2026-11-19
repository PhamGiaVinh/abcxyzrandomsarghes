import { useState, type Dispatch, type HTMLInputTypeAttribute, type SetStateAction } from "react";
import { useNavigate, Navigate, Link, useSearchParams } from "react-router-dom";
import { useTranslation, Trans } from "react-i18next";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";
import appLogo from "@/assets/app-logo.png";
import { toast } from "sonner";
import TosAgreementModal from "@/components/TosAgreementModal";
import { BackButton } from "@/components/BackButton";
import { playSuccess, playError } from "@/lib/sound";
import { DocumentRedirect } from "@/components/DocumentRedirect";
import { safeOpsDocumentTarget } from "@/ops/auth/opsSharedSessionNavigation";
import { safeSatelliteReturnTarget } from "@/lib/onlineSatelliteRoute";

const Auth = () => {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, loading } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [email, setEmail] = useState(""); const [password, setPassword] = useState (""); const [displayName, setDisplayName] = useState("");
  const [agreeTos, setAgreeTos] = useState(false);
  const [tosOpen, setTosOpen] = useState(false);

  const schema = z.object({
    email: z.string().trim().email(t("auth.invalidEmail")).max(255),
    password: z.string().min(6, t("auth.passwordMin")).max(72),
    displayName: z.string().trim().min(1).max(60).optional(),
  });

  const next = searchParams.get("next");
  const returnTarget = safeOpsDocumentTarget(next) ?? safeSatelliteReturnTarget(next);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  if (user) {
    return returnTarget ? <DocumentRedirect to={returnTarget} /> : <Navigate to="/account" replace />;
  }

  const signIn = async () => {
    const r = schema.safeParse({ email, password });
    if (!r.success) return toast.error(r.error.errors[0].message);
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (error) {
      playError();
      toast.error(error.message);
      return;
    }
    playSuccess();
    toast.success(t("auth.signedInOk"));
    if (returnTarget) {
      window.location.assign(returnTarget);
      return;
    }
    nav("/");
  };

  const signUp = async () => {
    if (!agreeTos) return toast.error(t("auth.tosRequired"));
    const r = schema.safeParse({ email, password, displayName });
    if (!r.success) return toast.error(r.error.errors[0].message);
    const dn = (displayName || "").trim();
    if (dn.length < 2) return toast.error(t("auth.displayNameMin"));
    setSubmitting(true);
    const { data: dup } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("display_name_lower", dn.toLowerCase())
      .maybeSingle();
    if (dup) {
      setSubmitting(false);
      return toast.error(t("auth.duplicateName", { name: dn }));
    }
    const { error } = await supabase.auth.signUp({
      email, password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback`, data: { display_name: dn } },
    });
    setSubmitting(false);
    if (error) return toast.error(error.message);
    toast.success(t("auth.verifyEmailSent"));
    nav("/verify-email");
  };

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center px-4 py-10">
      <BackButton to="/" label={t("common.home")} className="absolute top-4 left-4" />
      <div className="flex items-center gap-3 mb-8">
        <img src={appLogo} alt="VBacker" className="w-12 h-12 rounded-xl object-cover shadow-gold" />
        <div>
          <div className="font-display text-2xl text-gold">VBacker</div>
          <div className="text-xs text-muted-foreground">{t("auth.brandTagline")}</div>
        </div>
      </div>

      <Card className="w-full max-w-md gradient-card border-gold p-6 shadow-gold">
        <Tabs defaultValue="signin">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="signin">{t("auth.signIn")}</TabsTrigger>
            <TabsTrigger value="signup">{t("auth.signUp")}</TabsTrigger>
          </TabsList>
          <TabsContent value="signin" className="space-y-3 mt-4">
            <Field label={t("auth.email")} v={email} set={setEmail} type="email" />
            <Field label={t("auth.password")} v={password} set={setPassword} type="password" />
            <div className="text-right">
              <Link to="/forgot-password" className="text-xs text-primary hover:underline">{t("authPage.forgotPassword")}</Link>
            </div>
            <Button onClick={signIn} disabled={submitting} className="w-full gradient-gold text-primary-foreground border-0">
              {submitting ? t("auth.processing") : t("auth.signIn")}
            </Button>
          </TabsContent>
          <TabsContent value="signup" className="space-y-3 mt-4">
            <Field label={t("auth.displayName")} v={displayName} set={setDisplayName} />
            <Field label={t("auth.email")} v={email} set={setEmail} type="email" />
            <Field label={t("auth.password")} v={password} set={setPassword} type="password" />

            <div className="flex items-center gap-2 pt-1 rounded-md border border-border/60 bg-background/40 p-3">
              <Checkbox
                id="agree-tos"
                checked={agreeTos}
                onCheckedChange={(v) => {
                  if (v === true && !agreeTos) {
                    setTosOpen(true);
                  } else {
                    setAgreeTos(v === true);
                  }
                }}
              />
              <label htmlFor="agree-tos" className="text-xs leading-relaxed text-muted-foreground cursor-pointer select-none">
                <Trans
                  i18nKey="authPage.tosAgree"
                  components={{
                    tos: (
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); setTosOpen(true); }}
                        className="text-primary underline underline-offset-2"
                      />
                    ),
                  }}
                />
              </label>
            </div>

            <Button
              onClick={signUp}
              disabled={submitting || !agreeTos}
              className="w-full gradient-gold text-primary-foreground border-0 disabled:opacity-50"
            >
              {submitting ? t("auth.processing") : t("auth.createAccount")}
            </Button>
          </TabsContent>
        </Tabs>
      </Card>
      <button onClick={() => nav("/")} className="mt-4 text-xs text-muted-foreground hover:text-foreground">{t("auth.backHome")}</button>
      <TosAgreementModal open={tosOpen} onOpenChange={setTosOpen} onAgree={() => setAgreeTos(true)} />
    </div>
  );
};

type FieldProps = {
  label: string;
  v: string;
  set: Dispatch<SetStateAction<string>>;
  type?: HTMLInputTypeAttribute;
};

const Field = ({ label, v, set, type = "text" }: FieldProps) => (
  <div className="space-y-1">
    <Label className="text-xs">{label}</Label>
    <Input value={v} onChange={(e) => set(e.target.value)} type={type} />
  </div>
);

export default Auth;
