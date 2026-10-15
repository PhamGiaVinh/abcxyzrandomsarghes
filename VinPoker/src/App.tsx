import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { installToastSounds } from "@/lib/toastSound";

// Attach success/error/info/warning sound effects to every sonner toast.
installToastSounds();

import { isTrackerVoiceUatRoute } from "@/lib/trackerVoice/previewRoute";
const isSeriesMarketDevRoute = import.meta.env.DEV && window.location.pathname === "/__dev/series-market";
const isTrackerUnifiedOpsDevRoute =
  import.meta.env.DEV && window.location.pathname === "/__dev/tracker-unified-ops";
const isPayrollStatementDevRoute =
  import.meta.env.DEV && window.location.pathname === "/__dev/payroll-statement";
const trackerVoiceUatEnabled = import.meta.env.VITE_TRACKER_VOICE_UAT_ENABLED === "true";
const isTrackerVoiceUatPreviewRoute = isTrackerVoiceUatRoute(window.location.pathname, trackerVoiceUatEnabled);
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { Layout } from "@/components/Layout";
import { UpdateNotifier } from "@/components/UpdateNotifier";
import { UpdateOverlay } from "@/components/UpdateOverlay";
import { PushNotificationPrompt } from "@/components/PushNotificationPrompt";
import { EmailVerificationGate } from "@/components/EmailVerificationGate";
import { LanguagePrompt } from "@/components/LanguagePrompt";
import { RouteLoader } from "@/components/RouteLoader";

const Tournaments = lazy(() => import("./pages/Tournaments"));
const TournamentDetail = lazy(() => import("./pages/TournamentDetail"));
const TournamentLiveTracker = lazy(() => import("./pages/TournamentLiveTracker"));
const LiveCenter = lazy(() => import("./pages/LiveCenter"));
const PublicTournamentClock = lazy(() => import("./pages/PublicTournamentClock"));
const Clubs = lazy(() => import("./pages/Clubs"));
const ClubDetail = lazy(() => import("./pages/ClubDetail"));
const MyStacks = lazy(() => import("./pages/MyStacks"));
const Account = lazy(() => import("./pages/Account"));
const Auth = lazy(() => import("./pages/Auth"));
const ClubAdmin = lazy(() => import("./pages/ClubAdmin"));
const ClubFinanceDashboard = lazy(() => import("./pages/ClubFinanceDashboard"));
// Accounting Control "Tài chính & Đối soát" — UI-only mock shell; page self-gates on FEATURES.accountingControl.
const AccountingControl = lazy(() => import("./pages/AccountingControl"));
const DealerInsuranceProfiles = lazy(() => import("./pages/DealerInsuranceProfiles"));
const SeriesIntelligence = lazy(() => import("./pages/SeriesIntelligence"));
const OwnerDailyDigest = lazy(() => import("./pages/OwnerDailyDigest"));
const VerifiedMarketJeju = lazy(() => import("./pages/VerifiedMarketJeju"));
const SeriesDecisionLogAdmin = lazy(() => import("./pages/SeriesDecisionLogAdmin"));
const ChipOpsInventory = lazy(() => import("./pages/ChipOpsInventory"));
// Marketing module (/marketing) — page self-gates on FEATURES.marketingModule + role.
const Marketing = lazy(() => import("./pages/Marketing"));
// F&B module (/fnb/*) — pages self-gate on FEATURES.fnb* + role. Ships dark (flags OFF).
const FnbCounter = lazy(() => import("./pages/FnbCounter"));
const FnbKitchenDisplay = lazy(() => import("./pages/FnbKitchenDisplay"));
const FnbTableOrder = lazy(() => import("./pages/FnbTableOrder"));
const FnbServe = lazy(() => import("./pages/FnbServe"));
const FnbAdmin = lazy(() => import("./pages/FnbAdmin"));
const FnbHub = lazy(() => import("./pages/FnbHub"));
// F&B public DEMO (/fnb/demo) — self-contained static showcase; no supabase/RPC. Gated by FEATURES.fnbDemo.
const FnbDemo = lazy(() => import("./pages/FnbDemo"));
const SuperAdmin = lazy(() => import("./pages/SuperAdmin"));
const CashierDashboard = lazy(() => import("./pages/CashierDashboard"));
const DealerControlBoard = lazy(() => import("./pages/DealerControlBoard"));
const TrackerDashboard = lazy(() => import("./pages/TrackerDashboard"));
const TrackerHandHistory = lazy(() => import("./pages/TrackerHandHistory"));
const TrackerHandInputConsole = lazy(() => import("./pages/TrackerHandInputConsole"));
const TrackerPlayerAnalytics = lazy(() => import("./pages/TrackerPlayerAnalytics"));
const FloorDashboard = lazy(() => import("./pages/FloorDashboard"));
const DealerSwingDashboard = lazy(() => import("./pages/DealerSwingDashboard"));
// Accountant workspace (/accountant) — dedicated role-gated area (club_accountants/owner/admin).
const AccountantDashboard = lazy(() => import("./pages/AccountantDashboard"));
const MediaCenter = lazy(() => import("./pages/MediaCenter"));
const AdminUsers = lazy(() => import("./pages/AdminUsers"));
const AdminLeaderboard = lazy(() => import("./pages/AdminLeaderboard"));
const AdminMoneyList = lazy(() => import("./pages/AdminMoneyList"));
const AdminWebVitals = lazy(() => import("./pages/AdminWebVitals"));
const BulkCreateTournaments = lazy(() => import("./pages/BulkCreateTournaments"));
const Leaderboard = lazy(() => import("./pages/Leaderboard"));
const Documents = lazy(() => import("./pages/Documents"));
const Video = lazy(() => import("./pages/Video"));
const BookingChat = lazy(() => import("./pages/BookingChat"));
const ChatInbox = lazy(() => import("./pages/ChatInbox"));
const DirectChat = lazy(() => import("./pages/DirectChat"));
const GroupChat = lazy(() => import("./pages/GroupChat"));
const TournamentConfig = lazy(() => import("./pages/TournamentConfigPage"));
const GroupInvite = lazy(() => import("./pages/GroupInvite"));
const SeriesDetail = lazy(() => import("./pages/SeriesDetail"));
const SetupDavinci = lazy(() => import("./pages/SetupDavinci"));
const FindBacker = lazy(() => import("./pages/FindBacker"));
const PlayerProfile = lazy(() => import("./pages/PlayerProfile"));
const Marketplace = lazy(() => import("./pages/Marketplace"));
const StakingNew = lazy(() => import("./pages/StakingNew"));
const StakingMyDeals = lazy(() => import("./pages/StakingMyDeals"));
const StakingPortfolio = lazy(() => import("./pages/StakingPortfolio"));
const AdminStaking = lazy(() => import("./pages/AdminStaking"));
const Notifications = lazy(() => import("./pages/Notifications"));
const News = lazy(() => import("./pages/News"));
const NewsDetail = lazy(() => import("./pages/NewsDetail"));
const InternationalEvents = lazy(() => import("./pages/InternationalEvents"));
const Terms = lazy(() => import("./pages/Terms"));
const Privacy = lazy(() => import("./pages/Privacy"));
const VerifyEmail = lazy(() => import("./pages/VerifyEmail"));
const AuthCallback = lazy(() => import("./pages/AuthCallback"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const PackageListing = lazy(() => import("./pages/PackageListing"));
const PackageDetail = lazy(() => import("./pages/PackageDetail"));
const Feed = lazy(() => import("./pages/Feed"));
const NotificationSettings = lazy(() => import("./pages/NotificationSettings"));
const Unsubscribe = lazy(() => import("./pages/Unsubscribe"));
const TournamentTv = lazy(() => import("./pages/TournamentTv"));
const TvPair = lazy(() => import("./pages/TvPair"));
const TournamentDisplay = lazy(() => import("./pages/TournamentDisplay"));
// GE-2D online-poker shell (dark; gated by FEATURES.onlinePoker)
const OnlinePoker = lazy(() => import("./pages/OnlinePoker"));
const OnlinePokerTable = lazy(() => import("./pages/OnlinePokerTable"));
// DEV-ONLY visual harness for the poker table. Gated to import.meta.env.DEV so the route AND
// its lazy chunk are tree-shaken out of the production build (the dead ternary branch drops
// the dynamic import). Reached only at /__dev/table; not linked anywhere.
const DevTablePreview = import.meta.env.DEV ? lazy(() => import("./dev/TablePreview")) : null;
// DEV-ONLY visual harness for the neon-green tournament clock (PR Clock-A). Same
// import.meta.env.DEV gate → route + lazy chunk stripped from production. Reached
// only at /__dev/clock; not linked anywhere.
const DevClockPreview = import.meta.env.DEV ? lazy(() => import("./dev/ClockPreview")) : null;
// DEV-ONLY visual harness for the tracker LiveFelt (fixture-rendered — no Supabase).
// Same import.meta.env.DEV gate → route + lazy chunk stripped from production.
// Reached only at /__dev/livefelt; not linked anywhere.
const DevLiveFeltPreview = import.meta.env.DEV ? lazy(() => import("./dev/LiveFeltPreview")) : null;
// DEV-ONLY fixture for responsive Viewer RPT shell screenshots and interaction QA.
const DevViewerRPTPreview = import.meta.env.DEV ? lazy(() => import("./dev/ViewerRPTPreview")) : null;
// DEV-ONLY fixture for Public Tournament Live Viewer V2. No Supabase/auth/network.
const DevPublicTournamentEventPreview = import.meta.env.DEV
  ? lazy(() => import("./dev/PublicTournamentEventPreview"))
  : null;
// DEV-ONLY visual harness for the operator TrackerRacetrack felt (mock data — no Supabase),
// with rich + betChips toggles. Same import.meta.env.DEV gate → route + lazy chunk stripped
// from production. Reached only at /__dev/tracker; not linked anywhere.
const DevTrackerPreview = import.meta.env.DEV ? lazy(() => import("./components/tracker/TrackerInputPreview")) : null;
const DevDealerTabletPreview = import.meta.env.DEV ? lazy(() => import("./dev/DealerTabletPreview")) : null;
// DEV-only fixture for the Floor/Tracker completed-hand correction workspace.
const DevHandCorrectionPreview = import.meta.env.DEV ? lazy(() => import("./dev/HandCorrectionPreview")) : null;
// DEV-ONLY visual harness for the member-card design (cashier → Cấp lại thẻ). Fixture-rendered — no
// Supabase. Same import.meta.env.DEV gate → route + chunk stripped from production. Reached only at /__dev/card.
const DevCardPreview = import.meta.env.DEV ? lazy(() => import("./dev/CardPreview")) : null;
const DevSeriesMarketPreview = import.meta.env.DEV
  ? lazy(() => import("./components/series-market/VerifiedMarketDevPreview"))
  : null;
const DevTrackerUnifiedOpsPreview = import.meta.env.DEV
  ? lazy(() => import("./dev/TrackerUnifiedOpsPreview"))
  : null;
const DevPayrollStatementPreview = import.meta.env.DEV
  ? lazy(() => import("./dev/PayrollStatementPreview"))
  : null;
// The diagnostic is bundled only by a deliberate Preview UAT build variable.
// Production builds do not register the route or import its chunk.
const DevTrackerVoiceV0Preview = trackerVoiceUatEnabled
  ? lazy(() => import("./dev/TrackerVoiceV0Preview"))
  : null;
// Poker IQ Drill — player-facing cold-start feature (focused full-screen flow, no Layout chrome)
const PokerIQ = lazy(() => import("./pages/PokerIQ"));
// Dealer Mobile App (/dealer/*) — own mobile shell; gated by FEATURES.dealerMobileApp
const DealerAppShell = lazy(() => import("./components/dealer-app/DealerAppShell"));
const DealerHome = lazy(() => import("./pages/dealer/DealerHome"));
const DealerDay = lazy(() => import("./pages/dealer/DealerDay"));
const DealerWeek = lazy(() => import("./pages/dealer/DealerWeek"));
const DealerCareers = lazy(() => import("./pages/dealer/DealerCareers"));
const DealerAccount = lazy(() => import("./pages/dealer/DealerAccount"));
const DealerSalary = lazy(() => import("./pages/dealer/DealerSalary"));
// Staff App (/staff/*) — separate non-dealer staff portal; self-gates on FEATURES.staffApp.
const StaffAppShell = lazy(() => import("./components/staff-app/StaffAppShell"));
const StaffHome = lazy(() => import("./pages/staff/StaffHome"));
const StaffAttendance = lazy(() => import("./pages/staff/StaffAttendance"));
const StaffAccount = lazy(() => import("./pages/staff/StaffAccount"));
const StaffSalary = lazy(() => import("./pages/staff/StaffSalary"));
// Club operating expenses ledger; page self-gates on FEATURES.clubExpenses + owner/cashier role.
const ClubExpenses = lazy(() => import("./pages/ClubExpenses"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      refetchOnWindowFocus: true,
    },
  },
});

const App = () => {
  if (isSeriesMarketDevRoute && DevSeriesMarketPreview) {
    return (
      <BrowserRouter>
        <Suspense fallback={<RouteLoader />}>
          <Routes>
            <Route path="*" element={<DevSeriesMarketPreview />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    );
  }

  if (isTrackerUnifiedOpsDevRoute && DevTrackerUnifiedOpsPreview) {
    return (
      <BrowserRouter>
        <Suspense fallback={<RouteLoader />}>
          <Routes>
            <Route path="*" element={<DevTrackerUnifiedOpsPreview />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    );
  }

  if (isPayrollStatementDevRoute && DevPayrollStatementPreview) {
    return (
      <BrowserRouter>
        <Suspense fallback={<RouteLoader />}>
          <Routes>
            <Route path="*" element={<DevPayrollStatementPreview />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    );
  }

  if (import.meta.env.DEV && window.location.pathname === "/__dev/dealer-tablet" && DevDealerTabletPreview) {
    return <BrowserRouter><Suspense fallback={<RouteLoader />}><DevDealerTabletPreview /></Suspense></BrowserRouter>;
  }

  if (import.meta.env.DEV && window.location.pathname === "/__dev/hand-correction" && DevHandCorrectionPreview) {
    return <BrowserRouter><Suspense fallback={<RouteLoader />}><DevHandCorrectionPreview /></Suspense></BrowserRouter>;
  }

  if (isTrackerVoiceUatPreviewRoute && DevTrackerVoiceV0Preview) {
    return (
      <BrowserRouter>
        <Suspense fallback={<RouteLoader />}>
          <Routes>
            <Route path="*" element={<DevTrackerVoiceV0Preview />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner
        theme="dark"
        position="top-center"
        offset={`calc(env(safe-area-inset-top) + 16px)`}
        mobileOffset={{
          top: `calc(env(safe-area-inset-top) + 12px)`,
          bottom: `calc(env(safe-area-inset-bottom) + 96px)`,
          left: `calc(env(safe-area-inset-left) + 12px)`,
          right: `calc(env(safe-area-inset-right) + 12px)`,
        }}
      />
      <BrowserRouter>
        <AuthProvider>
          <UpdateNotifier />
          <UpdateOverlay />
          {/* UpdateBanner disabled — auto-update silently khi user ẩn tab/idle */}
          {/* <UpdateBanner /> */}
          <EmailVerificationGate />
          <LanguagePrompt />
          <PushNotificationPrompt />
          <Suspense fallback={<RouteLoader />}>
            <Routes>
<Route path="/auth" element={<Auth />} />
<Route path="/auth/callback" element={<AuthCallback />} />
<Route path="/verify-email" element={<VerifyEmail />} />
<Route path="/forgot-password" element={<ForgotPassword />} />
<Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/setup-davinci" element={<SetupDavinci />} />
              {/* TV projection screens — no Layout chrome */}
              <Route path="/tv/pair" element={<TvPair />} />
              <Route path="/tv/:tournamentId" element={<TournamentTv />} />
              <Route path="/display/:displayToken" element={<TournamentDisplay />} />
              {/* Poker IQ Drill — focused full-screen flow, hides global nav chrome */}
              <Route path="/poker-iq" element={<PokerIQ />} />
              {/* Online-poker TABLE — chrome-less full-viewport route (NO Layout nav), like
                  /poker-iq. The lobby /poker stays inside <Layout> below (keeps its nav). */}
              <Route path="/poker/table/:tableId" element={<OnlinePokerTable />} />
              {/* F&B Kitchen Display + guest table ordering — chrome-less full-screen (no Layout
                  nav), like /tv. Pages self-gate on FEATURES.fnbKitchen / fnbCounter. Ship dark. */}
              <Route path="/fnb/kitchen" element={<FnbKitchenDisplay />} />
              <Route path="/fnb/order" element={<FnbTableOrder />} />
              {/* DEV-ONLY visual harness (import.meta.env.DEV) — fixture-rendered poker table
                  for screenshots; not linked, stripped from the production build. */}
              {import.meta.env.DEV && DevTablePreview && (
                <Route path="/__dev/table" element={<DevTablePreview />} />
              )}
              {import.meta.env.DEV && DevClockPreview && (
                <Route path="/__dev/clock" element={<DevClockPreview />} />
              )}
              {import.meta.env.DEV && DevLiveFeltPreview && (
                <Route path="/__dev/livefelt" element={<DevLiveFeltPreview />} />
              )}
              {import.meta.env.DEV && DevViewerRPTPreview && (
                <Route path="/__dev/viewer-rpt" element={<DevViewerRPTPreview />} />
              )}
              {import.meta.env.DEV && DevPublicTournamentEventPreview && (
                <Route path="/__dev/public-live-v2" element={<DevPublicTournamentEventPreview />} />
              )}
              {import.meta.env.DEV && DevTrackerPreview && (
                <Route path="/__dev/tracker" element={<DevTrackerPreview />} />
              )}
              {import.meta.env.DEV && DevCardPreview && (
                <Route path="/__dev/card" element={<DevCardPreview />} />
              )}
              {import.meta.env.DEV && DevSeriesMarketPreview && (
                <Route path="/__dev/series-market" element={<DevSeriesMarketPreview />} />
              )}
              {/* Dealer Mobile App — its own mobile shell, separate from Layout
                  chrome. Self-gates on the dealer link + FEATURES.dealerMobileApp. */}
              <Route element={<DealerAppShell />}>
                <Route path="/dealer" element={<DealerHome />} />
                <Route path="/dealer/day" element={<DealerDay />} />
                <Route path="/dealer/week" element={<DealerWeek />} />
                <Route path="/dealer/careers" element={<DealerCareers />} />
                <Route path="/dealer/account" element={<DealerAccount />} />
                <Route path="/dealer/salary" element={<DealerSalary />} />
              </Route>
              {/* Staff App — separate non-dealer staff shell. Source stays mock while staffApp flag is OFF. */}
              <Route element={<StaffAppShell />}>
                <Route path="/staff" element={<StaffHome />} />
                <Route path="/staff/attendance" element={<StaffAttendance />} />
                <Route path="/staff/account" element={<StaffAccount />} />
                <Route path="/staff/salary" element={<StaffSalary />} />
              </Route>
              <Route element={<Layout />}>
                <Route path="/" element={<Tournaments />} />
                <Route path="/tournament/:id" element={<TournamentDetail />} />
                <Route path="/live" element={<LiveCenter />} />
                <Route path="/live/:tournamentId" element={<TournamentLiveTracker />} />
                <Route path="/clock/:tournamentId" element={<PublicTournamentClock />} />
                <Route path="/clubs" element={<Clubs />} />
                <Route path="/club/:id" element={<ClubDetail />} />
                <Route path="/my-stacks" element={<MyStacks />} />
                <Route path="/leaderboard" element={<Leaderboard />} />
                <Route path="/documents" element={<Documents />} />
                <Route path="/video" element={<Video />} />
                <Route path="/chat/:tournamentId" element={<BookingChat />} />
                <Route path="/inbox" element={<ChatInbox />} />
                <Route path="/dm/:userId" element={<DirectChat />} />
                <Route path="/group/:groupId" element={<GroupChat />} />
                <Route path="/invite/:token" element={<GroupInvite />} />
                <Route path="/series/:id" element={<SeriesDetail />} />
                <Route path="/account" element={<Account />} />
                <Route path="/find-backer" element={<FindBacker />} />
                <Route path="/marketplace" element={<Marketplace />} />
                <Route path="/staking/new" element={<StakingNew />} />
                <Route path="/staking/my-deals" element={<StakingMyDeals />} />
                <Route path="/staking/portfolio" element={<StakingPortfolio />} />
                <Route path="/admin/staking" element={<AdminStaking />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/notification-settings" element={<NotificationSettings />} />
                <Route path="/unsubscribe" element={<Unsubscribe />} />
                <Route path="/feed" element={<Feed />} />
                <Route path="/news" element={<News />} />
                <Route path="/news/:slug" element={<NewsDetail />} />
                <Route path="/international" element={<InternationalEvents />} />
                <Route path="/packages" element={<PackageListing />} />
                <Route path="/packages/:packageId" element={<PackageDetail />} />
                <Route path="/player/:userId" element={<PlayerProfile />} />
                <Route path="/club/admin" element={<ClubAdmin />} />
                <Route path="/club/admin/finance" element={<ClubFinanceDashboard />} />
                <Route path="/club/admin/expenses" element={<ClubExpenses />} />
                {/* Tài chính & Đối soát — mock cockpit. Page self-gates on FEATURES.accountingControl (default OFF).
                    Device-aware: phones get the read-only mobile /ops/accounting view. */}
                <Route path="/club/admin/accounting-control" element={<AccountingControl />} />
                <Route path="/club/admin/insurance" element={<DealerInsuranceProfiles />} />
                {/* Trí tuệ Series device-aware: phones get the read-only mobile /ops/series view. */}
                <Route path="/club/admin/series-intelligence" element={<SeriesIntelligence />} />
                <Route path="/club/admin/daily-digest" element={<OwnerDailyDigest />} />
                <Route path="/club/admin/market-intelligence" element={<VerifiedMarketJeju />} />
                {/* CAPTURE v0 Decision Log — page self-gates on FEATURES.seriesDecisionLog (default OFF). */}
                <Route path="/club/admin/series-decision-log" element={<SeriesDecisionLogAdmin />} />
                {/* Chip Ops — read-only issued-chip inventory. Page self-gates on FEATURES.chipOps. */}
                {/* Chip Ops is device-aware: phones get the mobile /ops/chip-ops UI, desktop the inventory. */}
                <Route path="/chip-ops" element={<ChipOpsInventory />} />
                {/* Marketing — club-scoped composer/scheduler. Page self-gates on FEATURES.marketingModule + role.
                    Device-aware: phones get the mobile /ops/marketing UI, desktop the full composer. */}
                <Route path="/marketing" element={<Marketing />} />
                {/* F&B counter + admin — keep Layout chrome. Pages self-gate on FEATURES.fnb*. */}
                <Route path="/fnb/hub" element={<FnbHub />} />
                {/* F&B counter is device-aware: phones get the mobile /ops/fnb UI, desktop the counter. */}
                <Route path="/fnb" element={<FnbCounter />} />
                <Route path="/fnb/serve" element={<FnbServe />} />
                <Route path="/fnb/admin" element={<FnbAdmin />} />
                {/* F&B public DEMO — static showcase, keeps Layout chrome. Self-gates on FEATURES.fnbDemo. */}
                <Route path="/fnb/demo" element={<FnbDemo />} />
                {/* GE-2D online-poker LOBBY — keeps Layout chrome. The TABLE route is
                    chrome-less above (full-screen). Pages self-gate on FEATURES.onlinePoker. */}
                <Route path="/poker" element={<OnlinePoker />} />
                <Route path="/cashier" element={<CashierDashboard />} />
                <Route path="/dealer-board" element={<DealerControlBoard />} />
                <Route path="/tracker" element={<TrackerDashboard />} />
                <Route path="/tracker/history" element={<TrackerHandHistory />} />
                <Route path="/accountant" element={<AccountantDashboard />} />
                <Route path="/tracker/hand-input" element={<TrackerHandInputConsole />} />
                <Route path="/tracker/player/:playerId/analytics" element={<TrackerPlayerAnalytics />} />
                <Route path="/floor" element={<FloorDashboard />} />
                <Route path="/dealer-swing" element={<DealerSwingDashboard />} />
                <Route path="/admin" element={<SuperAdmin />} />
                <Route path="/admin/users" element={<AdminUsers />} />
                <Route path="/media" element={<MediaCenter />} />
                <Route path="/admin/tournaments/bulk-create" element={<BulkCreateTournaments />} />
                <Route path="/admin/leaderboard" element={<AdminLeaderboard />} />
                <Route path="/admin/money-list" element={<AdminMoneyList />} />
                <Route path="/admin/web-vitals" element={<AdminWebVitals />} />
                <Route path="/admin/tournament-config/:clubId" element={<TournamentConfig />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
