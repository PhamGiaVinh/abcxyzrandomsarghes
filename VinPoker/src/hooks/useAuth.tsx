import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { linkUser, logoutUser } from "@/lib/onesignal";
import { deriveIsChipMaster } from "@/lib/chipMaster";
import { deriveIsMarketing } from "@/lib/marketer";
import { deriveIsFnb } from "@/lib/fnbStaff";
import { deriveIsAccountant } from "@/lib/accountant";

// HMR safety: AuthContext identity must stay stable across hot updates.
// If this module (or any of its imports) is hot-reloaded, force a full
// page reload so the AuthProvider and all consumers share one context.
if (import.meta.hot) {
  import.meta.hot.accept(() => import.meta.hot!.invalidate());
}

type AppRole = "player" | "club_admin" | "super_admin" | "cashier" | "club_cashier" | "media" | "tracker" | "floor" | "marketing" | "fnb_cashier" | "fnb_server" | "fnb_kitchen";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  roles: AppRole[];
  loading: boolean;
  authError: string | null;
  rolesLoading: boolean;
  rolesError: string | null;
  signOut: () => Promise<void>;
  isAdmin: boolean;
  isClubAdmin: boolean;
  isClubOwner: boolean; // owns >=1 club (clubs.owner_id) — independent of the club_admin role
  isCashier: boolean;
  isStaffOps: boolean; // super_admin OR cashier — can access staking ops
  isMedia: boolean; // media role
  isMediaOrAdmin: boolean; // can manage CMS / support
  isTracker: boolean; // tracker role — can access live tracker
  isFloor: boolean; // floor role — NAV/affordance only; data access is gated server-side by is_club_floor / floor_club_ids
  isDealer: boolean; // linked to a dealers row (dealers.user_id = auth.uid())
  isChipMaster: boolean; // Chip-Master of >=1 club (club_chip_masters) — flag-gated + guarded
  isMarketing: boolean; // marketing role or member of >=1 club (club_marketers) — flag-gated + guarded; NAV AFFORDANCE ONLY (data authority = marketer_club_ids RLS)
  isFnb: boolean; // F&B staff (any facet) / super_admin / member of >=1 club (club_fnb_staff) — flag-gated + guarded; NAV AFFORDANCE ONLY (data authority = fnb_club_ids / is_club_fnb_kind RLS)
  isFnbCashier: boolean; // F&B cashier facet (takes money at the counter) — NAV AFFORDANCE ONLY
  isFnbServer: boolean; // F&B server facet (marks SHIPPED) — NAV AFFORDANCE ONLY
  isFnbKitchen: boolean; // F&B kitchen facet (kitchen display) — NAV AFFORDANCE ONLY
  isAccountant: boolean; // club_accountants member of >=1 club (salary chốt/duyệt) OR super_admin — NAV AFFORDANCE ONLY
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Bound each base-role read independently so a hung metadata request does not
// discard a role already confirmed by the server. Abort + observation deadline:
// even a transport that ignores abort cannot publish late privileges.
async function readBaseRole<T>(query: PromiseLike<T>, controller: AbortController) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([Promise.resolve(query), new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error('role_read_aborted'));
      if (controller.signal.aborted) { onAbort(); return; }
      controller.signal.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => controller.abort(), 10000);
    })]);
  } catch {
    return { data: [], error: new Error('role_read_unavailable') };
  } finally {
    clearTimeout(timer);
    if (onAbort) controller.signal.removeEventListener('abort', onAbort);
  }
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [isClubOwner, setIsClubOwner] = useState(false);
  const [isDealer, setIsDealer] = useState(false);
  const [isChipMaster, setIsChipMaster] = useState(false);
  const [isMarketingMember, setIsMarketingMember] = useState(false);
  const [isFnbMember, setIsFnbMember] = useState(false);
  const [isAccountantMember, setIsAccountantMember] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const roleGeneration = useRef(0);
  const activeUserId = useRef<string | null | undefined>(undefined);
  const activeToken = useRef<string | undefined>(undefined);
  const roleReadState = useRef<"idle" | "loading" | "ready" | "error">("idle");
  const roleRequests = useRef<AbortController[]>([]);
  const cancelRoleReads = useCallback(() => {
    const pending = roleRequests.current;
    roleRequests.current = [];
    pending.forEach(controller => controller.abort());
  }, []);

  const clearRoles = useCallback(() => {
    setRoles([]);
    setIsClubOwner(false);
    setIsDealer(false);
    setIsChipMaster(false);
    setIsMarketingMember(false);
    setIsFnbMember(false);
    setIsAccountantMember(false);
    setRolesError(null);
  }, []);

  const fetchRoles = useCallback(async (userId: string, generation: number) => {
    const controllers = [new AbortController(), new AbortController(), new AbortController()];
    roleRequests.current = controllers;
    const isCurrentRequest = () => roleGeneration.current === generation;
    setRolesLoading(true);
    roleReadState.current = "loading";
    setRolesError(null);
    try {
      const [roleResult, ownerResult, dealerResult] = await Promise.all([
        readBaseRole(supabase.from("user_roles").select("role").eq("user_id", userId).abortSignal(controllers[0].signal), controllers[0]),
        readBaseRole(supabase.from("clubs").select("id").eq("owner_id", userId).limit(1).abortSignal(controllers[1].signal), controllers[1]),
        // A user "is a dealer" if linked to a dealers row. Self-read is permitted by
        // the dealers_select_control policy (USING ... OR auth.uid() = user_id).
        readBaseRole(supabase.from("dealers").select("id").eq("user_id", userId).is("deleted_at", null).limit(1).abortSignal(controllers[2].signal), controllers[2]),
      ]);
      if (!isCurrentRequest()) return;
      if (roleResult.error) throw roleResult.error;

      setRoles((roleResult.data ?? []).map((row) => row.role as AppRole));
      setIsClubOwner(!ownerResult.error && (ownerResult.data ?? []).length > 0);
      setIsDealer(!dealerResult.error && (dealerResult.data ?? []).length > 0);
      if (ownerResult.error || dealerResult.error) {
        setRolesError("Chưa xác minh được đầy đủ quyền CLB. Hãy thử tải lại khi kết nối ổn định.");
      }
      roleReadState.current = ownerResult.error || dealerResult.error ? "error" : "ready";
      setRolesLoading(false);

      // Membership-based navigation affordances are additive and remain fail-closed.
      deriveIsChipMaster(userId).then((value) => { if (isCurrentRequest()) setIsChipMaster(value); }).catch(() => {
        if (isCurrentRequest()) setIsChipMaster(false);
      });
      deriveIsMarketing(userId).then((value) => { if (isCurrentRequest()) setIsMarketingMember(value); }).catch(() => {
        if (isCurrentRequest()) setIsMarketingMember(false);
      });
      deriveIsFnb(userId).then((value) => { if (isCurrentRequest()) setIsFnbMember(value); }).catch(() => {
        if (isCurrentRequest()) setIsFnbMember(false);
      });
      deriveIsAccountant(userId).then((value) => { if (isCurrentRequest()) setIsAccountantMember(value); }).catch(() => {
        if (isCurrentRequest()) setIsAccountantMember(false);
      });
    } catch {
      if (!isCurrentRequest()) return;
      clearRoles();
      roleReadState.current = "error";
      setRolesError("Không tải được quyền tài khoản. Hãy thử lại khi kết nối ổn định.");
      setRolesLoading(false);
    } finally {
      if (roleRequests.current === controllers) roleRequests.current = [];
    }
  }, [clearRoles]);

  useEffect(() => {
    let authEventCount = 0;
    let disposed = false;

    const applySession = (sess: Session | null, event?: string) => {
      if (disposed) return;
      setSession(sess);
      setUser(sess?.user ?? null);
      setLoading(false);
      setAuthError(null);
      const nextUserId = sess?.user.id ?? null;
      const sameUser = activeUserId.current === nextUserId;
      const tokenChanged = activeToken.current !== sess?.access_token;
      const canRetry = event === "SIGNED_IN" || event === "TOKEN_REFRESHED";
      if (sameUser && !(nextUserId && canRetry && (
        roleReadState.current === "error" || (roleReadState.current === "loading" && tokenChanged)
      ))) return;

      activeUserId.current = nextUserId;
      activeToken.current = sess?.access_token;
      const generation = ++roleGeneration.current;
      cancelRoleReads();
      clearRoles();
      if (nextUserId) {
        setRolesLoading(true);
        void fetchRoles(nextUserId, generation);
        if (sameUser) return; // Role recovery must not repeat push/profile side effects.
        setTimeout(() => {
          if (disposed || roleGeneration.current !== generation) return;
          void linkUser(nextUserId);
          // Persist OneSignal external_id mapping (idempotent)
          supabase
            .from("profiles")
            .update({ onesignal_external_user_id: nextUserId })
            .eq("user_id", nextUserId)
            .then(() => {});
        }, 0);
      } else {
        roleReadState.current = "idle";
        setRolesLoading(false);
        setTimeout(() => {
          if (!disposed && roleGeneration.current === generation) void logoutUser();
        }, 0);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, sess) => {
      authEventCount += 1;
      applySession(sess, event);
    });

    supabase.auth.getSession().then(({ data: { session: sess }, error }) => {
      if (disposed) return;
      if (error && authEventCount === 0) {
        setAuthError("Không xác minh được phiên đăng nhập. Kiểm tra kết nối rồi thử lại.");
        setRolesLoading(false);
        setLoading(false);
        return;
      }
      if (authEventCount === 0) applySession(sess);
      else setLoading(false);
    }).catch(() => {
      if (!disposed) {
        if (authEventCount === 0) {
          setAuthError("Không xác minh được phiên đăng nhập. Kiểm tra kết nối rồi thử lại.");
          setRolesLoading(false);
        }
        setLoading(false);
      }
    });

    return () => {
      disposed = true;
      roleGeneration.current += 1;
      cancelRoleReads();
      activeUserId.current = undefined;
      activeToken.current = undefined;
      roleReadState.current = "idle";
      subscription.unsubscribe();
    };
  }, [clearRoles, fetchRoles, cancelRoleReads]);

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    roleGeneration.current += 1;
    cancelRoleReads();
    activeUserId.current = null;
    activeToken.current = undefined;
    roleReadState.current = "idle";
    setSession(null);
    setUser(null);
    setAuthError(null);
    clearRoles();
    setRolesLoading(false);
  };

  return (
    <AuthContext.Provider value={{
      session, user, roles, loading, authError, rolesLoading, rolesError, signOut,
      isAdmin: roles.includes("super_admin"),
      isClubAdmin: roles.includes("club_admin") || roles.includes("super_admin"),
      isClubOwner,
      isCashier: roles.includes("cashier") || roles.includes("club_cashier"),
      isStaffOps: roles.includes("super_admin") || roles.includes("cashier") || roles.includes("club_cashier"),
      isMedia: roles.includes("media"),
      isMediaOrAdmin: roles.includes("super_admin") || roles.includes("media"),
      isTracker: roles.includes("tracker"),
      isFloor: roles.includes("floor"),
      isDealer,
      isChipMaster,
      // Role OR super_admin OR club membership — NAV AFFORDANCE ONLY. Every marketing data read
      // is still filtered by marketer_club_ids()/RLS, so a global 'marketing' role is never a
      // read-all-clubs grant.
      isMarketing: roles.includes("marketing") || roles.includes("super_admin") || isMarketingMember,
      // F&B — NAV AFFORDANCE ONLY. Every F&B data read/write is still gated server-side by
      // fnb_club_ids()/is_club_fnb_kind RLS + the SECURITY DEFINER RPCs, so a role/membership here
      // is never a data grant. Additive + default-false-safe for every non-F&B user.
      isFnb: roles.includes("fnb_cashier") || roles.includes("fnb_server") || roles.includes("fnb_kitchen") || roles.includes("super_admin") || isFnbMember,
      isFnbCashier: roles.includes("fnb_cashier") || roles.includes("super_admin"),
      isFnbServer: roles.includes("fnb_server") || roles.includes("super_admin"),
      isFnbKitchen: roles.includes("fnb_kitchen") || roles.includes("super_admin"),
      isAccountant: roles.includes("super_admin") || isAccountantMember,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
