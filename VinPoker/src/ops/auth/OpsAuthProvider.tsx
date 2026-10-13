import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { SupabaseClientProvider } from "@/integrations/supabase/SupabaseClientContext";
import { opsClient } from "@/integrations/supabase/opsClient";
import { loadVerifiedOpsSession } from "@/ops/auth/opsSessionValidation";

type OpsAuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  verificationRevision: number;
  signOutCurrentSession: () => Promise<string | null>;
};

const OpsAuthContext = createContext<OpsAuthContextValue | null>(null);

export function OpsAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [verificationRevision, setVerificationRevision] = useState(0);

  useEffect(() => {
    let active = true;
    let validationRevision = 0;
    let verifiedSession: Session | null = null;

    const validateCurrentSession = (incoming?: Session, repeatedSignIn = false) => {
      const revision = ++validationRevision;
      const retained = repeatedSignIn && verifiedSession && incoming
        && incoming.user.id === verifiedSession.user.id
        && incoming.access_token === verifiedSession.access_token
        ? verifiedSession : null;
      // Refocusing may emit SIGNED_IN again for the already verified token.
      // Recheck the Auth server, but do not dismantle an in-flight UI gesture.
      // Initial acceptance, changed tokens/users and explicit updates still gate.
      if (!retained) {
        verifiedSession = null;
        setLoading(true);
      }
      void loadVerifiedOpsSession(opsClient).then((nextSession) => {
        if (!active || revision !== validationRevision) return;
        verifiedSession = retained && nextSession
          && nextSession.user.id === retained.user.id
          && nextSession.access_token === retained.access_token
          ? retained : nextSession;
        setSession(verifiedSession);
        setVerificationRevision(revision);
        setLoading(false);
      });
    };

    validateCurrentSession();

    const {
      data: { subscription },
    } = opsClient.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      // The initial callback mirrors browser storage. The bootstrap above is
      // the only path that may accept it, after an Auth server check.
      if (event === "INITIAL_SESSION") return;
      if (nextSession) {
        validateCurrentSession(nextSession, event === "SIGNED_IN");
        return;
      }
      validationRevision += 1;
      verifiedSession = null;
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const signOutCurrentSession = useCallback(async () => {
    try {
      const { error } = await opsClient.auth.signOut({ scope: "local" });
      if (error) return "Không thể đăng xuất phiên hiện tại. Vui lòng thử lại.";
      setSession(null);
      return null;
    } catch {
      return "Không thể đăng xuất phiên hiện tại. Vui lòng thử lại.";
    }
  }, []);

  const value = useMemo<OpsAuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      verificationRevision,
      signOutCurrentSession,
    }),
    [loading, session, signOutCurrentSession, verificationRevision],
  );

  return (
    <SupabaseClientProvider client={opsClient}>
      <OpsAuthContext.Provider value={value}>{children}</OpsAuthContext.Provider>
    </SupabaseClientProvider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useOpsAuth(): OpsAuthContextValue {
  const value = useContext(OpsAuthContext);
  if (!value) throw new Error("useOpsAuth must be used inside OpsAuthProvider.");
  return value;
}
