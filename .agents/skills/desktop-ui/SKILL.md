---
name: desktop-ui
description: Use when adding, moving or reviewing desktop React pages, shared UI controls, view state, interactions or styling in Study.
---

# Desktop UI

- Production pages live in `apps/client/src/routes`; the React shell lives in `apps/client` and is shared by browser and desktop.
  Shared presentation primitives are `packages/ui` (`@study/ui`), adapted from local Latch.
  Reuse them for both native and browser consumers; do not build a second component set.
- The native shell is `apps/desktop/src-tauri`: only native capabilities and transport.
  Business behavior belongs in `apps/server`; typed Effect RPC contracts live in `packages/contracts`.
- The React frontend uses the browser-safe Effect RPC client from `@study/server/client`
  and the same typed contracts as other consumers.
- Access native capabilities through `apps/client/src/lib/host.ts`; shared components
  use this host boundary instead of importing Tauri APIs or detecting the native host.
- All user-visible copy comes from `@study/localization` in English and Italian; run
  `bun gen` when changing the database schema and check drift with `bun gen:check`.
- Keep asynchronous state in query/mutation hooks and invalidate after committed mutations.
  Events are refresh hints; a reconnect or missed event must recover through queries.
- Run focused frontend checks and package tests. The old `just e2e` runner is retired;
  do not substitute a fake server to claim end-to-end coverage.
- For native-only file dialogs, microphone and updater, verify the Tauri app with the
  `see-the-app` skill. Browser tests cover shared production components, not native plugins.
