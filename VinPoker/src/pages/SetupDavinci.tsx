import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Shield } from "lucide-react";
import { toast } from "sonner";

const SUPER_EMAIL = "davinci2205@pokervn.com";

const SetupDavinci = () => {
  const nav = useNavigate();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const inFlight = useRef(false);
  const mounted = useRef(true);

  const append = (m: string) => { if (mounted.current) setLog(l => [...l, m]); };

  useEffect(() => {
    mounted.current = true;
    append("Sign in to verify existing administrator access. Account creation is a separate action.");
    return () => { mounted.current = false; };
  }, []);

  const run = async (intent: "signin" | "create") => {
    if (inFlight.current) return;
    if (password.length < 6) return toast.error("Password must be at least 6 characters");
    inFlight.current = true;
    setBusy(true); setLog([]);
    try {
      append(intent === "signin" ? "→ Trying to sign in..." : "→ Requesting account creation...");
      const { data, error } = intent === "signin"
        ? await supabase.auth.signInWithPassword({ email: SUPER_EMAIL, password })
        : await supabase.auth.signUp({
        email: SUPER_EMAIL, password,
        options: { emailRedirectTo: `${window.location.origin}/admin`, data: { display_name: "Davinci" } },
      });
      if (!mounted.current) return;
      if (error) {
        append(intent === "signin"
          ? "Unable to sign in. Check credentials or connection. No account creation was requested."
          : "Unable to confirm account creation. Try signing in before requesting creation again.");
        return;
      }
      if (intent === "create" && !data.session) {
        append("Check your email for confirmation, then sign in to verify administrator access.");
        return;
      }
      const uid = data.user?.id;
      if (!uid) { append("Unable to verify the signed-in account."); return; }
      const { data: roles, error: rolesError } = await supabase.from("user_roles").select("role").eq("user_id", uid);
      if (!mounted.current) return;
      if (rolesError || !Array.isArray(roles) || roles.some(r => !r || typeof r.role !== "string")) {
        append("Unable to verify roles. Check the connection and sign in again; access has not been confirmed.");
        return;
      }
      if (!roles.some(r => r.role === "super_admin")) {
        append("This account does not have the Super Admin role in the database. Contact a database administrator.");
        return;
      }
      append("Super Admin role verified. Redirecting...");
      nav("/admin");
    } catch {
      append("Unable to complete the request. Verify the account by signing in before retrying account creation.");
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md gradient-card border-gold p-6 shadow-gold space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="w-6 h-6 text-gold" />
          <h1 className="font-display text-xl text-gold">Bootstrap Super Admin</h1>
        </div>
        <p className="text-xs text-muted-foreground">
          Sign in as <span className="text-gold">{SUPER_EMAIL}</span> to verify administrator access. Creating an account does not confirm access.
        </p>
        <div className="space-y-1">
          <Label htmlFor="setup-admin-password" className="text-xs">Password</Label>
          <Input id="setup-admin-password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 6 characters" disabled={busy} />
        </div>
        <Button onClick={()=>void run("signin")} disabled={busy} className="w-full gradient-gold text-primary-foreground border-0">
          {busy ? <><Loader2 className="w-4 h-4 animate-spin" />Working…</> : "Sign in and verify"}
        </Button>
        <Button type="button" variant="outline" onClick={()=>void run("create")} disabled={busy} className="w-full">Create account</Button>
        {log.length > 0 && (
          <div role="status" aria-live="polite" className="text-xs space-y-0.5 bg-background/50 rounded p-2 font-mono max-h-48 overflow-auto">
            {log.map((l, i) => <div key={i} className="text-muted-foreground">{l}</div>)}
          </div>
        )}
      </Card>
    </div>
  );
};

export default SetupDavinci;
