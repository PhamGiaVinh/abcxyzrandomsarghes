import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadVerifiedOpsSession,
  type OpsSessionReader,
} from "@/ops/auth/opsSessionValidation";

type TestSession = { user: { id: string }; access_token: string };

const owner = { id: "10000000-0000-4000-8000-000000000001" };
const firstSession: TestSession = { user: owner, access_token: "stale-token" };
const refreshedSession: TestSession = { user: owner, access_token: "fresh-token" };

function clientWith(input: {
  sessions: Array<{ session: TestSession | null; error?: unknown }>;
  user?: { id: string } | null;
  userError?: unknown;
}) {
  const getSession = vi.fn();
  for (const result of input.sessions) {
    getSession.mockResolvedValueOnce({
      data: { session: result.session },
      error: result.error ?? null,
    });
  }
  const getUser = vi.fn().mockResolvedValue({
    data: { user: input.user ?? owner },
    error: input.userError ?? null,
  });
  return {
    client: { auth: { getSession, getUser } } as OpsSessionReader<TestSession>,
    getSession,
    getUser,
  };
}

describe("Ops shared-session validation", () => {
  afterEach(()=>vi.useRealTimers());
  it.each(['initial storage','Auth server','post-verification storage'])('bounds a hung %s read without accepting a late session',async(stage)=>{
    vi.useFakeTimers();
    let release!:(value:unknown)=>void;
    const held=new Promise(resolve=>{release=resolve;});
    const getSession=vi.fn().mockResolvedValue({data:{session:firstSession},error:null});
    const getUser=vi.fn().mockResolvedValue({data:{user:owner},error:null});
    if(stage==='initial storage')getSession.mockReturnValueOnce(held);
    else if(stage==='Auth server')getUser.mockReturnValueOnce(held);
    else getSession.mockResolvedValueOnce({data:{session:firstSession},error:null}).mockReturnValueOnce(held);
    const client={auth:{getSession,getUser}} as OpsSessionReader<TestSession>;
    const observed=vi.fn();
    const result=loadVerifiedOpsSession(client).then(observed);
    await vi.advanceTimersByTimeAsync(10001);
    expect(observed).toHaveBeenCalledExactlyOnceWith(null);
    release(stage==='Auth server'?{data:{user:owner},error:null}:{data:{session:firstSession},error:null});
    await vi.advanceTimersByTimeAsync(0);
    await result;
    expect(observed).toHaveBeenCalledTimes(1);
  });
  it("accepts the server-confirmed session after a token refresh", async () => {
    const { client, getSession, getUser } = clientWith({
      sessions: [{ session: firstSession }, { session: refreshedSession }],
    });

    await expect(loadVerifiedOpsSession(client)).resolves.toBe(refreshedSession);
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it("does not call the Auth server when browser storage has no session", async () => {
    const { client, getSession, getUser } = clientWith({ sessions: [{ session: null }] });

    await expect(loadVerifiedOpsSession(client)).resolves.toBeNull();
    expect(getUser).not.toHaveBeenCalled();
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the Auth server rejects the stored session", async () => {
    const { client, getSession, getUser } = clientWith({
      sessions: [{ session: firstSession }],
      userError: new Error("expired"),
    });

    await expect(loadVerifiedOpsSession(client)).resolves.toBeNull();
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the session reader rejects unexpectedly", async () => {
    const getSession = vi.fn().mockRejectedValue(new Error("network failure"));
    const getUser = vi.fn();
    const client = { auth: { getSession, getUser } } as unknown as OpsSessionReader<TestSession>;

    await expect(loadVerifiedOpsSession(client)).resolves.toBeNull();
    expect(getUser).not.toHaveBeenCalled();
  });

  it("fails closed when the verified identity differs from browser storage", async () => {
    const { client, getSession, getUser } = clientWith({
      sessions: [{ session: firstSession }],
      user: { id: "20000000-0000-4000-8000-000000000002" },
    });

    await expect(loadVerifiedOpsSession(client)).resolves.toBeNull();
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the post-verification session is absent or changed", async () => {
    const { client, getSession } = clientWith({
      sessions: [{ session: firstSession }, { session: null }],
    });

    await expect(loadVerifiedOpsSession(client)).resolves.toBeNull();
    expect(getSession).toHaveBeenCalledTimes(2);
  });
});
