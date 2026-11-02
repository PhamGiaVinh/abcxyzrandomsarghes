import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "react-error-boundary";
import "./index.css";

const root = createRoot(document.getElementById("root")!);
const isCenterPointPokerMastersRoute = window.location.pathname.replace(/\/+$/, "") === "/center-point-poker-masters";

function finishBootTransition() {
  // Signal boot synchronously after React accepts the root render. Background tabs
  // can throttle requestAnimationFrame for longer than the watchdog timeout.
  window.dispatchEvent(new Event("vp:react-mounted"));

  // Keep the visual splash transition on the next frame.
  requestAnimationFrame(() => {
    try {
      sessionStorage.removeItem("vp:just-updated");
      sessionStorage.removeItem("vp:auto-reloaded");
      // Keep the preload retry fence for this tab session. A rendered root
      // (including the boot-error screen) does not prove lazy chunks recovered.
    } catch {
      // Session storage is best-effort on privacy-restricted browsers.
    }
    const splash = document.getElementById("boot-splash");
    if (!splash) return;
    splash.classList.add("boot-splash--hide");
    setTimeout(() => splash.remove(), 500);
  });
}

type BootModuleStage = "player-app" | "root-fallback" | "i18n" | "event-app";
type BootModuleKind = "module-fetch" | "module-syntax" | "module-evaluation";
class BootModuleFailure extends Error {
  constructor(readonly stage: BootModuleStage, readonly kind: BootModuleKind) {
    super("required_boot_module_failed");
  }
}
function requiredBootImport<T>(stage: BootModuleStage, request: Promise<T>): Promise<T> {
  return request.catch((cause: unknown) => {
    const detail = cause && typeof cause === "object" ? cause as { name?: unknown; message?: unknown } : null;
    const message = typeof detail?.message === "string" ? detail.message : "";
    const kind: BootModuleKind = /fetch dynamically imported module|loading dynamically imported module|load module script/i.test(message)
      ? "module-fetch" : detail?.name === "SyntaxError" ? "module-syntax" : "module-evaluation";
    throw new BootModuleFailure(stage, kind);
  });
}
function showBootFailure(cause: unknown) {
  const diagnostic = cause instanceof BootModuleFailure ? cause : null;
  // ErrorBoundary cannot catch a rejected import before the React tree exists.
  // Keep recovery independent of the very chunks that failed to load.
  root.render(
    <main role="alert" data-boot-stage={import.meta.env.DEV ? diagnostic?.stage : undefined}
      data-boot-kind={import.meta.env.DEV ? diagnostic?.kind : undefined}
      className="mx-auto max-w-lg space-y-4 p-6 text-foreground">
      <h1 className="text-xl font-semibold">Không tải được ứng dụng</h1>
      <p>Kết nối hoặc tệp ứng dụng chưa sẵn sàng. Hãy kiểm tra mạng rồi thử tải lại.</p>
      <button type="button" className="min-h-11 rounded-lg bg-primary px-4 py-2 text-primary-foreground"
        onClick={() => window.location.reload()}>Tải lại ứng dụng</button>
    </main>,
  );
  finishBootTransition();
}

if (isCenterPointPokerMastersRoute) {
  void requiredBootImport("event-app", import("./pages/CenterPointPokerMastersApp")).then(({ default: CenterPointPokerMastersApp }) => {
    root.render(<CenterPointPokerMastersApp />);
    finishBootTransition();
  }).catch(showBootFailure);
} else {
  void Promise.all([
    requiredBootImport("player-app", import("./PlayerApp")),
    requiredBootImport("root-fallback", import("./components/RootErrorFallback")),
    requiredBootImport("i18n", import("./i18n")),
  ]).then(([{ default: PlayerApp }, { RootErrorFallback }]) => {
    // Lazy-load Sentry only in production when a DSN is configured.
    if (import.meta.env.PROD && import.meta.env.VITE_SENTRY_DSN) {
      void import("@sentry/react").then((Sentry) => Sentry.init({ dsn: import.meta.env.VITE_SENTRY_DSN as string }));
    }

    root.render(
      <ErrorBoundary
        FallbackComponent={RootErrorFallback}
        onError={(error, info) => console.error("Root ErrorBoundary:", error, info)}
        onReset={() => window.location.reload()}
      >
        <PlayerApp />
      </ErrorBoundary>,
    );
    finishBootTransition();
    // Optional services must not gate the operational app or turn their own
    // import/initialization failure into an application-wide boot failure.
    void import("./lib/sound").then(({ initButtonSounds }) => initButtonSounds())
      .catch(() => console.warn("Optional sound initialization unavailable"));
    void import("./lib/registerSW").then(({ registerServiceWorker }) => registerServiceWorker())
      .catch(() => console.warn("Optional service worker initialization unavailable"));
    void import("./lib/onesignal").then(({ initOneSignal }) => initOneSignal())
      .catch(() => console.warn("Optional push initialization unavailable"));
    void import("./lib/webVitals").then(({ initWebVitals }) => initWebVitals())
      .catch(() => console.warn("Optional performance reporting unavailable"));
  }).catch(showBootFailure);
}

// Recover from Vite chunk-load failures (common right after an update when
// caches were cleared but the module graph still references old hashes).
window.addEventListener("vite:preloadError", (e) => {
  try {
    if (sessionStorage.getItem("vp:reloaded-after-preload-error")) return;
    sessionStorage.setItem("vp:reloaded-after-preload-error", "1");
  } catch {
    // Without a durable fence, a persistent chunk error could reload forever.
    // Let the original error reach the explicit/manual recovery UI instead.
    return;
  }
  e.preventDefault?.();
  window.location.reload();
});

window.addEventListener("error", (e) => {
  const msg = (e.message || "").toLowerCase();
  if (
    msg.includes("is not defined") ||
    msg.includes("cannot read properties of undefined") ||
    msg.includes("is not a function")
  ) {
    try {
      if (sessionStorage.getItem("vp:chunk-reloaded")) return;
      sessionStorage.setItem("vp:chunk-reloaded", "1");
    } catch {
      // Do not auto-navigate when the cross-navigation retry fence is unavailable.
      return;
    }
    const url = new URL(location.href);
    url.searchParams.set("recover", Date.now().toString());
    location.replace(url.toString());
  }
});

