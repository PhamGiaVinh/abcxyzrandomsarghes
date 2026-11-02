import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";

export type OpsSessionIdentity = {
  user: {
    id: string;
  };
};

export type OpsSessionReader<TSession extends OpsSessionIdentity> = {
  auth: {
    getSession: () => Promise<{
      data: { session: TSession | null };
      error: unknown | null;
    }>;
    getUser: () => Promise<{
      data: { user: { id: string } | null };
      error: unknown | null;
    }>;
  };
};

/**
 * Accept an Ops session only after the Auth server confirms the same user.
 * A second read captures a token refresh performed during that confirmation.
 */
export async function loadVerifiedOpsSession<TSession extends OpsSessionIdentity>(
  client: OpsSessionReader<TSession>,
): Promise<TSession | null> {
  try {
    return await observeTrackerContextRead((async () => {
      const initial = await client.auth.getSession();
      const initialSession = initial.error ? null : initial.data.session;
      if (!initialSession) return null;

      const verified = await client.auth.getUser();
      const verifiedUser = verified.error ? null : verified.data.user;
      if (!verifiedUser || verifiedUser.id !== initialSession.user.id) return null;

      const current = await client.auth.getSession();
      const currentSession = current.error ? null : current.data.session;
      if (!currentSession || currentSession.user.id !== verifiedUser.id) return null;

      return currentSession;
    })());
  } catch {
    return null;
  }
}
