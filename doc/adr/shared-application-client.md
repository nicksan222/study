# Shared application client

- Status: Accepted
- Date: 2026-11-13

## Context

Study must support desktop execution and browser-based development. People and
agents must be able to develop and verify the real application in a browser
without launching the native shell. Both environments must reuse the same
application screens, behavior, and backend contracts.

## Decision

Study must have one shared React client, a TypeScript application server, and a
thin native desktop host. The client workspace must be `apps/client`, its package
must be `@study/client`, and its internal import alias must be `#client`.

| Location                | Responsibility                                                                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/client`           | Shared React application: routes, screens, frontend state, queries, and application client integration. Runs in the browser and the desktop webview. |
| `apps/desktop`          | Tauri host and packaging: native windows, OS integration, updates, and ownership of the private server process. Loads the shared client build.       |
| `apps/server`           | TypeScript application services, AI integration, persistence access, RPC handlers, and background work.                                              |
| `packages/contracts`    | Browser-safe schemas, identifiers, errors, and typed Effect RPC contracts shared by client and server.                                               |
| `packages/db`           | Drizzle schema and SQLite connection and transaction primitives used by the server.                                                                  |
| `packages/ui`           | Shared presentation primitives without application data or feature behavior.                                                                         |
| `packages/localization` | English and Italian user-visible copy and formatting.                                                                                                |
| `apps/landing`          | Public website, separate from the application client.                                                                                                |

### Client and host boundary

Routes, feature screens, and frontend application behavior must live in the shared
client. Differences between browser and desktop must sit behind a small client host boundary:
server endpoint discovery, opening the sign-in browser, native updates, and native
diagnostics. Feature screens consume those operations and their availability;
native API imports and host detection belong at that boundary.

The desktop host must launch and own the private Bun server. The desktop client must discover
its endpoint through Tauri and connect directly over loopback HTTP using the
same typed RPC contracts as the browser client. The server owns the database and
application behavior; the native shell owns OS integration and process lifetime.

### Browser development is a required workflow

- `bun dev` starts the client and the real application server, with the browser
  client available at `http://localhost:5173`.
- Browser development uses the same React application, services, and RPC
  contracts as desktop. It does not substitute a mock backend.
- Browser mode provides browser implementations of host operations where
  appropriate and reports native-only capabilities as unavailable.
- Routine development and UI verification use the browser. Native checks remain
  necessary for native-only behavior.
- The desktop build consumes the client build output instead of maintaining a
  second frontend.

## Rationale

One client avoids duplicating screens, frontend state, and interaction behavior.
TypeScript application services can directly use TypeScript AI integrations,
while the native shell remains focused on native responsibilities. A browser
entry point allows application development independently of a running native
window. The name `client` describes this shared role.

## Accepted tradeoffs

- Desktop releases package and coordinate the native host and Bun runtime.
  Readiness, shutdown, backend failure, and local transport remain explicit
  engineering responsibilities.
- Sharing a client reduces duplication but does not provide automatic platform
  parity. Browser sign-in and native sign-in differ; updates and desktop
  diagnostics require native support and separate verification.
- The shared client includes a small amount of host integration. A focused
  boundary is preferred over scattering host checks across feature screens.
- A single frontend workspace favors shared behavior over independently evolving
  browser and desktop applications.

## Scope and reconsideration

This decision governs client sharing, runtime responsibilities, host integration,
and browser development. Framework choices, background-work abstractions, and
other internal package boundaries require their own decisions when evaluated.

Revisit the shared frontend structure if browser and desktop require materially
different application composition. Revisit the runtime split if measured
packaging, lifecycle, resource, or native integration costs outweigh the benefits
of the TypeScript backend.
