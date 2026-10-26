---
name: desktop-ui
description: Use when adding, moving or reviewing desktop React pages, shared UI controls, view state, interactions or styling in Study.
---

# Desktop UI

- Production pages live in `apps/desktop/src/pages`; the React shell lives in the same app.
  Shared presentation primitives are `packages/ui` (`@study/ui`), adapted from local Latch.
  Reuse them for both native and browser consumers; do not build a second component set.
- The native shell is `apps/desktop/src-tauri`: only native capabilities and transport.
  Domain behavior belongs in `study-app`; `study-rpc` is the canonical protobuf contract.
- Every command/query uses the generated typed Study client. Both Tauri envelopes and the
  development HTTP bridge carry the same protobuf bytes through real tonic gRPC.
- All user-visible copy comes from `study-localization` in English and Italian; run
  `npm run gen:protocol` when changing the schema or exported copy and check drift.
- Keep asynchronous state in query/mutation hooks and invalidate after committed mutations.
  Events are refresh hints; a reconnect or missed event must recover through queries.
- Run focused frontend checks, then real consumer flows with `just e2e`. No Playwright route
  fulfillment, fake RPC server, mock transport, or duplicate domain handlers in browser E2E.
- For native-only file dialogs, microphone and updater, verify the Tauri app with the
  `see-the-app` skill. Browser tests cover shared production components, not native plugins.
