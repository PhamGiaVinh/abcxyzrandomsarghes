/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __APP_GIT_COMMIT_SHA__: string | null;

interface ImportMetaEnv {
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_FLOOR_TABLE_CONTROL_V3?: string;
  readonly VITE_FLOOR_UAT_ENV?: string;
  readonly VITE_OPS_TOUR_CASHIER?: string;
  readonly VITE_ONLINE_SATELLITE_PILOT?: string;
  readonly VITE_ONLINE_SATELLITE_RUNTIME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
