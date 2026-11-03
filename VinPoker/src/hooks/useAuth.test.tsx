import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type QueryResponse = { data: unknown[]; error: { message: string } | null };
type QueryBuilder = {
  select: () => QueryBuilder;
  update: () => QueryBuilder;
  eq: () => QueryBuilder;
  limit: () => QueryBuilder;
  is: () => QueryBuilder;
  in: () => QueryBuilder;
  abortSignal: (signal:AbortSignal) => QueryBuilder;
  then: <TResult1 = QueryResponse, TResult2 = never>(
    onfulfilled?: ((value: QueryResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) => PromiseLike<TResult1 | TResult2>;
};

const auth = vi.hoisted(() => ({
  listener: null as ((event: string, session: { user: { id: string }; access_token?: string } | null) => void) | null,
  getSession: vi.fn(),
  queryReads: [] as Array<{ table: string; userId: string }>,
  resolveQuery: null as ((table: string, userId: string) => Promise<QueryResponse>) | null,
  synchronousInitialSession: null as { user: { id: string } } | null,
  signals:[] as AbortSignal[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name:string) => {
      const result=Promise.resolve({data:name==='get_my_floor_operator_scope'
        ?[{club_id:'row',can_owner:true,can_cashier:true,can_floor:true}]:['row'],error:null});
      return Object.assign(result,{abortSignal:()=>result});
    },
    auth: {
      getSession: auth.getSession,
      signOut: vi.fn().mockResolvedValue({ error: null }),
      onAuthStateChange: (listener: typeof auth.listener) => {
        auth.listener = listener;
        if (auth.synchronousInitialSession) listener?.("INITIAL_SESSION", auth.synchronousInitialSession);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
    from: (table: string) => {
      let userId = "";
      const query = {} as QueryBuilder;
      query.select = () => query;
      query.update = () => query;
      query.eq = (_column?: string, value?: string) => {
        if (value) userId = value;
        return query;
      };
      query.limit = () => query;
      query.is = () => query;
      query.in = () => query;
      query.abortSignal = signal => {auth.signals.push(signal);return query;};
      query.then = (onfulfilled, onrejected) => {
        if (table !== "profiles") auth.queryReads.push({ table, userId });
        const result = auth.resolveQuery
          ? auth.resolveQuery(table, userId)
          : Promise.resolve({
            data: table === "user_roles" ? [{ role: "cashier" }] : [{ id: "row" }],
            error: null,
          });
        return result.then(onfulfilled, onrejected);
      };
      return { select: () => query, update: () => query };
    },
  },
}));

vi.mock("@/lib/onesignal", () => ({ linkUser: vi.fn(), logoutUser: vi.fn() }));
vi.mock("@/lib/chipMaster", () => ({ deriveIsChipMaster: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/marketer", () => ({ deriveIsMarketing: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/fnbStaff", () => ({ deriveIsFnb: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/accountant", () => ({ deriveIsAccountant: vi.fn().mockResolvedValue(false) }));

import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { useOperatorClubs } from './useOperatorClubs';

// Exercise the real caller-bound scope hook that Dealer Swing uses to mount
// its dialogs. Reverification replaces the workspace while scope is unknown.
function OperatorDraft() {
  const { scopeVerified } = useOperatorClubs();
  return scopeVerified ? <input aria-label="Check-in selection draft" defaultValue="" /> : <p>Verifying operator scope</p>;
}

function Probe() {
  const { user, loading, rolesLoading, rolesError, isCashier, isAdmin } = useAuth();
  const authState = loading ? "auth-loading" : user?.id ?? "anonymous";
  const roleState = rolesLoading ? "roles-loading" : rolesError ?? (isAdmin ? "admin" : isCashier ? "cashier" : "no-role");
  return <p>{`${authState}|${roleState}`}</p>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

function renderAuth() {
  return render(<AuthProvider><Probe /></AuthProvider>);
}

describe("AuthProvider role loading", () => {
  afterEach(()=>vi.useRealTimers());
  beforeEach(() => {
    auth.listener = null;
    auth.queryReads = [];
    auth.resolveQuery = null;
    auth.synchronousInitialSession = null;
    auth.getSession.mockReset();
    auth.signals=[];
  });

  it('keeps an operator draft on a repeated SIGNED_IN for the exact same credential',async()=>{
    const session={user:{id:'same-operator'},access_token:'LOCAL_SAME_SESSION'};
    auth.getSession.mockResolvedValue({data:{session},error:null});
    render(<AuthProvider><Probe/><OperatorDraft/></AuthProvider>);
    await screen.findByText('same-operator|cashier');
    await screen.findByLabelText('Check-in selection draft');
    fireEvent.change(screen.getByLabelText('Check-in selection draft'),{target:{value:'TEST dealer selection'}});
    act(()=>auth.listener?.('SIGNED_IN',{...session,user:{...session.user}}));
    expect(screen.getByLabelText('Check-in selection draft')).toHaveValue('TEST dealer selection');
  });

  it.each(['SIGNED_IN','TOKEN_REFRESHED'])('discards the old operator draft when %s brings a different credential',async event=>{
    const session={user:{id:'same-operator'},access_token:'LOCAL_OLD_SESSION'};
    auth.getSession.mockResolvedValue({data:{session},error:null});
    render(<AuthProvider><Probe/><OperatorDraft/></AuthProvider>);
    await screen.findByText('same-operator|cashier');
    await screen.findByLabelText('Check-in selection draft');
    fireEvent.change(screen.getByLabelText('Check-in selection draft'),{target:{value:'old dealer selection'}});
    act(()=>auth.listener?.(event,{...session,access_token:'LOCAL_NEW_SESSION'}));
    expect(screen.queryByLabelText('Check-in selection draft')).not.toBeInTheDocument();
    expect(await screen.findByLabelText('Check-in selection draft')).toHaveValue('');
  });

  it('clears the operator draft on sign-out and on a different actor even if token bytes match',async()=>{
    const session={user:{id:'same-operator'},access_token:'LOCAL_SESSION'};
    auth.getSession.mockResolvedValue({data:{session},error:null});
    render(<AuthProvider><Probe/><OperatorDraft/></AuthProvider>);
    fireEvent.change(await screen.findByLabelText('Check-in selection draft'),{target:{value:'private selection'}});
    act(()=>auth.listener?.('SIGNED_IN',{...session,user:{id:'other-operator'}}));
    expect(screen.queryByLabelText('Check-in selection draft')).not.toBeInTheDocument();
    expect(await screen.findByLabelText('Check-in selection draft')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Check-in selection draft'),{target:{value:'second selection'}});
    act(()=>auth.listener?.('SIGNED_OUT',null));
    expect(screen.queryByLabelText('Check-in selection draft')).not.toBeInTheDocument();
  });

  it('bounds a hanging role read, ignores its late privileges, and recovers after same-account sign-in',async()=>{
    vi.useFakeTimers();const pending=deferred<QueryResponse>();let hanging=true;
    auth.resolveQuery=table=>table==='user_roles'&&hanging?pending.promise:Promise.resolve({data:table==='user_roles'?[{role:'cashier'}]:[],error:null});
    auth.getSession.mockResolvedValue({data:{session:{user:{id:'owner-timeout'},access_token:'first'}},error:null});
    renderAuth();await act(async()=>{});
    expect(screen.getByText('owner-timeout|roles-loading')).toBeInTheDocument();
    await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
    expect(screen.getByText(/owner-timeout\|Không tải được quyền/)).toBeInTheDocument();
    await act(async()=>pending.resolve({data:[{role:'super_admin'}],error:null}));
    expect(screen.queryByText('owner-timeout|admin')).not.toBeInTheDocument();
    hanging=false;
    await act(async()=>auth.listener?.('SIGNED_IN',{user:{id:'owner-timeout'},access_token:'second'}));
    expect(screen.getByText('owner-timeout|cashier')).toBeInTheDocument();
  });
  it('retains a confirmed cashier role while timing out incomplete dealer metadata',async()=>{
    vi.useFakeTimers();const pending=deferred<QueryResponse>();
    auth.resolveQuery=table=>table==='dealers'?pending.promise:Promise.resolve({data:table==='user_roles'?[{role:'cashier'}]:[],error:null});
    auth.getSession.mockResolvedValue({data:{session:{user:{id:'cashier-timeout'} }},error:null});
    function PartialProbe(){const {isCashier,rolesLoading,rolesError}=useAuth();return <p>{`${isCashier}|${rolesLoading}|${rolesError??'ready'}`}</p>;}
    render(<AuthProvider><PartialProbe/></AuthProvider>);await act(async()=>{});
    await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
    expect(screen.getByText(/true\|false\|Chưa xác minh/)).toBeInTheDocument();
    await act(async()=>pending.resolve({data:[{id:'late-dealer'}],error:null}));
    expect(screen.getByText(/true\|false\|Chưa xác minh/)).toBeInTheDocument();
  });
  it('aborts pending role requests and clears their deadlines on unmount',async()=>{
    vi.useFakeTimers();const pending=deferred<QueryResponse>();
    auth.resolveQuery=()=>pending.promise;
    auth.getSession.mockResolvedValue({data:{session:{user:{id:'leaving-owner'}}},error:null});
    const view=renderAuth();await act(async()=>{});
    expect(auth.signals).toHaveLength(3);
    view.unmount();await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
    expect(auth.signals.every(signal=>signal.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await act(async()=>pending.resolve({data:[{role:'super_admin'}],error:null}));
  });

  it("loads base roles only once when the initial auth event and getSession return the same user", async () => {
    const session = { user: { id: "owner-a" } };
    auth.getSession.mockResolvedValue({ data: { session }, error: null });

    renderAuth();
    expect(await screen.findByText("owner-a|cashier")).toBeInTheDocument();

    act(() => { auth.listener?.("INITIAL_SESSION", session); });

    await waitFor(() => {
      expect(auth.queryReads.filter((query) => query.table === "user_roles" && query.userId === "owner-a")).toHaveLength(1);
    });
  });
  it('retries failed roles after valid sign-in of the same user',async()=>{
    let failed=true;
    auth.resolveQuery=table=>Promise.resolve(table==='user_roles'&&failed
      ?{data:[],error:{message:'old TEST session rejected'}}
      :{data:table==='user_roles'?[{role:'cashier'}]:[],error:null});
    auth.getSession.mockResolvedValue({data:{session:{user:{id:'same-owner'},access_token:'old-test'}},error:null});
    renderAuth();await screen.findByText(/same-owner\|Không tải được quyền/);failed=false;
    act(()=>auth.listener?.('SIGNED_IN',{user:{id:'same-owner'},access_token:'new-test'}));
    expect(await screen.findByText('same-owner|cashier')).toBeInTheDocument();
    expect(auth.queryReads.filter(r=>r.table==='user_roles')).toHaveLength(2);
  });
  it("does not refetch healthy roles for repeated sign-in or token refresh", async () => {
    const session = { user: { id: "healthy-owner" }, access_token: "first-test" };
    auth.getSession.mockResolvedValue({ data: { session }, error: null });
    renderAuth();
    await screen.findByText("healthy-owner|cashier");
    act(() => {
      auth.listener?.("SIGNED_IN", session);
      auth.listener?.("TOKEN_REFRESHED", { ...session, access_token: "next-test" });
    });
    expect(auth.queryReads.filter((read) => read.table === "user_roles")).toHaveLength(1);
    expect(screen.getByText("healthy-owner|cashier")).toBeInTheDocument();
  });
  it('clears partial metadata error on same-user refreshed session',async()=>{
    let failed=true;
    auth.resolveQuery=table=>Promise.resolve(table==='dealers'&&failed
      ?{data:[],error:{message:'503'}}:{data:table==='user_roles'?[{role:'cashier'}]:[],error:null});
    auth.getSession.mockResolvedValue({data:{session:{user:{id:'same-owner'},access_token:'old-test'}},error:null});
    renderAuth();await screen.findByText(/same-owner\|Chưa xác minh/);failed=false;
    act(()=>auth.listener?.('TOKEN_REFRESHED',{user:{id:'same-owner'},access_token:'new-test'}));
    expect(await screen.findByText('same-owner|cashier')).toBeInTheDocument();
  });
  it('fences an in-flight old-token role read when the same user obtains a new session',async()=>{
    const old=deferred<QueryResponse>();let first=true;
    auth.resolveQuery=table=>{
      if(table==='user_roles'&&first){first=false;return old.promise;}
      return Promise.resolve({data:table==='user_roles'?[{role:'cashier'}]:[],error:null});
    };
    auth.getSession.mockResolvedValue({data:{session:{user:{id:'same-owner'},access_token:'old-test'}},error:null});
    renderAuth();await screen.findByText('same-owner|roles-loading');
    act(()=>auth.listener?.('SIGNED_IN',{user:{id:'same-owner'},access_token:'new-test'}));
    await screen.findByText('same-owner|cashier');
    await act(async()=>{old.resolve({data:[{role:'super_admin'}],error:null});await old.promise;});
    expect(screen.getByText('same-owner|cashier')).toBeInTheDocument();
  });

  it("ignores an older account's role response after sign-out", async () => {
    const oldRoleRead = deferred<QueryResponse>();
    auth.resolveQuery = (table, userId) => table === "user_roles" && userId === "owner-old"
      ? oldRoleRead.promise
      : Promise.resolve({ data: [], error: null });
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });

    renderAuth();
    await waitFor(() => expect(screen.getByText("anonymous|no-role")).toBeInTheDocument());
    act(() => { auth.listener?.("SIGNED_IN", { user: { id: "owner-old" } }); });
    await waitFor(() => expect(screen.getByText("owner-old|roles-loading")).toBeInTheDocument());
    act(() => { auth.listener?.("SIGNED_OUT", null); });
    expect(auth.signals.every(signal=>signal.aborted)).toBe(true);
    oldRoleRead.resolve({ data: [{ role: "super_admin" }], error: null });

    await waitFor(() => expect(screen.getByText("anonymous|no-role")).toBeInTheDocument());
  });

  it("loads the current roles after an effect is restarted in StrictMode", async () => {
    const session = { user: { id: "owner-a" } };
    auth.synchronousInitialSession = session;
    auth.getSession.mockResolvedValue({ data: { session }, error: null });
    render(<StrictMode><AuthProvider><Probe /></AuthProvider></StrictMode>);
    expect(await screen.findByText("owner-a|cashier")).toBeInTheDocument();
  });

  it("preserves server-confirmed cashier roles when dealer metadata is unavailable", async () => {
    auth.resolveQuery = (table) => Promise.resolve(table === "dealers"
      ? { data: [], error: { message: "503 Service Unavailable" } }
      : { data: table === "user_roles" ? [{ role: "cashier" }] : [], error: null });
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: "cashier-a" } } }, error: null });
    function CashierProbe() {
      const { isCashier, rolesError } = useAuth();
      return <p>{`${isCashier ? "cashier-confirmed" : "cashier-unconfirmed"}|${rolesError ?? "ready"}`}</p>;
    }
    render(<AuthProvider><CashierProbe /></AuthProvider>);
    expect(await screen.findByText(/cashier-confirmed\|Chưa xác minh/)).toBeInTheDocument();
  });
});
