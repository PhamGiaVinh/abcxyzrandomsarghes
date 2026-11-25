// Explicit disposable UI gate only. Production featureFlags.ts remains OFF.
if(location.hostname!=='127.0.0.1' || !window.__ptHttp) throw Error('ISOLATED_PT_BROWSER_REQUIRED');
export const FEATURES={financePtStatementDetails:window.__ptHttp.salaryOnly===true};
