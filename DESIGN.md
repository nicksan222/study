# Study design system

Study uses the compact neutral-and-blue interface from the local Latch project. The
implementation authority is `packages/ui/src/styles.css` and its shared React components.
The Tauri shell owns native windows; application screens live in `apps/desktop/src/pages`.

Use shared `@study/ui` components for buttons, fields, dialogs, lists, settings rows,
page containers, alerts, and empty states. Extend these primitives when necessary so a
repeated visual rule has one implementation. Keep shared components free of Study domain
contracts and application state.

Use semantic background, foreground, muted, border, primary, and severity tokens. Blue
identifies primary actions and focus. Color always has a text or icon counterpart. Preserve
both light and dark themes and the saved appearance preference. Do not add hard-coded
colors, remote font dependencies, gradients, or decorative assets to operational screens.

Use the local system sans-serif and monospace stacks. Normal interface text is compact,
with 14px body copy and 12px secondary labels. Keep important error explanations readable.
Monospace identifies code and filesystem paths. Website font assets remain local under
`packages/ui/assets/fonts`; the landing site has its own reading layout.

Use a sidebar and compact top bar, with list/detail layouts for projects, sources, and
sessions. Shared readable and wide page containers govern gutters and section spacing.
Settings are titled sections with divided rows. A minimum 820 × 540 native window must
remain usable; narrower browser development views preserve navigation and stack controls.

Every action has a visible pending state, actionable errors, and an empty state that points
to the next step. Preserve keyboard navigation, labelled controls, focus indication, dialog
focus restoration, and search shortcuts. Destructive actions require their existing
confirmation flow. Content can scroll without hiding primary navigation or essential actions.

English and Italian copy comes from `study-localization`; the webview imports its generated
catalog. A generated gRPC consumer supplies application data. No production fixture or
mock state belongs in a screen. Events invalidate queries; persisted service state remains
authoritative after reconnect or missed events.

Verify the actual app in both themes, native and browser consumer transports, pending and
error states, keyboard flows, long content, and narrow windows. Static lint checks alone do
not establish visual or accessibility quality.
