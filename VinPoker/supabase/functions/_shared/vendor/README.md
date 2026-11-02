# Pinned tslib dependency

`tslib-2.8.1.mjs` preserves the exact11226-byte response originally locked for `https://esm.sh/tslib@2.8.1/denonext/tslib.mjs`.

SHA256: `c38da5dd6da6281964435002ce204cd586634fe3bdfb24a0ee116f48cf3292e9`.

On2026-11-02 the CDN returned a different body for that same immutable URL, failing frozen CI. The retained local Deno cache provided the original bytes, verified against the unchanged lockfile before copying. `deno.json` resolves that one dependency locally; all other frozen checks remain enabled. The integrity test binds this file to the original lock entry. This adds no package version or new runtime behavior.

The included0BSD license is from the installed Microsoft tslib2.8.1 package.
