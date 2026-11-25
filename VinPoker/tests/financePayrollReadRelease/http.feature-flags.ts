// Disposable fixture only; production featureFlags.ts remains false.
if(location.hostname!=='127.0.0.1' || !window.__ptHttp) throw Error('ISOLATED_PT_READ_REQUIRED');
export const FEATURES={financePtStatementDetails:true};
