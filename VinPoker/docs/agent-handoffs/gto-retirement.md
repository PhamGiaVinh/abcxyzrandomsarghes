# Retired GTO bootstrap and admin route

Owner retired GTO; F6 removes App.tsx global remote-range initialization and writable RangeEditor route/lazy import. Keeps all operational routes and separate DEV/UAT preview guards. Does not delete database data, range algorithms, historical GTO components or alter backend grants.

Three static source regressions PASS locally. Existing Operations CI expanded to include App/source-test paths, source regression and mocked-backend browser startup at375/1280px across Floor/Tracker/Swing/ChipOps/old GTO URL. Browser test proves no GTO range fetch in these startup paths, not authenticated feature UAT or proof of every possible consumer. Full typecheck/build/browser CI pending before qualification.

Root App dirty preserved; own worktree D:\wt\vinpoker-gto-retirement. No production deploy. Backend/GTO data restoration unnecessary for source rollback; revert this package if unintended consumer found. Campaign release guard and exact-source checks remain.
