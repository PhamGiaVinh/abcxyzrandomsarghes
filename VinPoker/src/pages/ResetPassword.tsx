import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, KeyRound } from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { toast } from "sonner";

const ResetPassword = () => {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active=true,generation=0;
    // Supabase auto-creates a recovery session when redirected with the token in URL hash.
    const { data: sub } = supabase.auth.onAuthStateChange((event,session) => {
      generation++;
      if(!active)return;
      if(event==='SIGNED_OUT'||event==='SIGNED_IN'||event==='PASSWORD_RECOVERY'){
        setPw('');setPw2('');
        setReady(event!=='SIGNED_OUT'&&!!session);
      }
    });
    const readGeneration=generation;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if(active&&generation===readGeneration)setReady(!!session);
    }).catch(()=>{if(active&&generation===readGeneration)setReady(false);});
    return () => {active=false;sub.subscription.unsubscribe();};
  }, []);

  const submit = async () => {
    if(!ready)return;
    if (pw.length < 8) return toast.error(t("resetPassword.passwordMin"));
    if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return toast.error(t("resetPassword.passwordLettersAndNumbers"));
    if (pw !== pw2) return toast.error(t("resetPassword.passwordsDoNotMatch"));
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(t("resetPassword.resetSuccess"));
    await supabase.auth.signOut();
    nav("/auth");
  };

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center px-4 py-10">
      <BackButton to="/" label={t("common.home")} className="absolute top-4 left-4" />
      <Card className="w-full max-w-md gradient-card border-gold p-6 shadow-gold space-y-4">
        <div className="flex items-center gap-2">
          <KeyRound className="w-5 h-5 text-primary" />
          <h1 className="font-display text-xl">{t("resetPassword.title")}</h1>
        </div>
        {!ready ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> {t("resetPassword.verifyingLink")}
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <Label className="text-xs">{t("resetPassword.newPasswordLabel")}</Label>
              <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("resetPassword.confirmPasswordLabel")}</Label>
              <Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
            </div>
            <Button onClick={submit} disabled={busy} className="w-full gradient-gold text-primary-foreground border-0">
              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              {t("resetPassword.submitButton")}
            </Button>
          </>
        )}
      </Card>
    </div>
  );
};

export default ResetPassword;
