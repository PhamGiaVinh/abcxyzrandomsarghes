import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Mail, ArrowLeft } from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { toast } from "sonner";
import { useTranslation, Trans } from "react-i18next";

const ForgotPassword = () => {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [sentEmail,setSentEmail]=useState('');
  const sending=useRef(false);

  const submit = async () => {
    if(sending.current)return;
    const r = z.string().trim().email(t("forgotPassword.invalidEmail")).max(255).safeParse(email);
    if (!r.success) return toast.error(r.error.errors[0].message);
    sending.current=true;setBusy(true);
    try{
      const { error } = await supabase.auth.resetPasswordForEmail(r.data, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) return toast.error(error.message);
      setSentEmail(r.data);setSent(true);
      toast.success(t("forgotPassword.resetEmailSent"));
    }catch{
      toast.error(t('forgotPassword.requestUnavailable',{defaultValue:'Chưa xác minh được yêu cầu gửi email. Hãy kiểm tra hộp thư trước khi thử lại.'}));
    }finally{sending.current=false;setBusy(false);}
  };

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center px-4 py-10">
      <BackButton to="/" label={t("common.home")} className="absolute top-4 left-4" />
      <Card className="w-full max-w-md gradient-card border-gold p-6 shadow-gold space-y-4">
        <div className="flex items-center gap-2">
          <Mail className="w-5 h-5 text-primary" />
          <h1 className="font-display text-xl">{t("forgotPassword.title")}</h1>
        </div>
        {sent ? (
          <div className="text-sm text-muted-foreground space-y-3">
            <p>
              <Trans i18nKey="forgotPassword.sentTo" values={{ email:sentEmail }}>
                Đã gửi liên kết đặt lại mật khẩu tới <b className="text-foreground">{sentEmail}</b>.
              </Trans>
            </p>
            <p>{t("forgotPassword.checkSpamHint")}</p>
            <Button variant="outline" className="w-full" onClick={() => nav("/auth")}>
              <ArrowLeft className="w-4 h-4 mr-2" /> {t("forgotPassword.backToLogin")}
            </Button>
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">{t("forgotPassword.prompt")}</p>
            <div className="space-y-1">
              <Label htmlFor="reset-email" className="text-xs">{t("forgotPassword.emailLabel")}</Label>
              <Input id="reset-email" type="email" disabled={busy} value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("forgotPassword.emailPlaceholder")} />
            </div>
            <Button onClick={submit} disabled={busy} className="w-full gradient-gold text-primary-foreground border-0">
              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              {t("forgotPassword.sendResetLink")}
            </Button>
            <Link to="/auth" className="block text-xs text-center text-muted-foreground hover:text-foreground">
              ← {t("forgotPassword.backToLogin")}
            </Link>
          </>
        )}
      </Card>
    </div>
  );
};

export default ForgotPassword;
