# Study design system

Study uses Groam's Graphite workspace foundations, approved in the subject overview mockup
`.impeccable/mocks/home-groam/subject-a.png`. The note notebook direction is
`.impeccable/mocks/home-groam/note-dump.png`. The product is a working study notebook:
capturing, finding, transforming and practising the learner's own material takes priority.

## Shared foundations

`packages/ui/src/components/shell.tsx` and `list.tsx`, with their CSS, port Groam's actual
header, page body, section heading and list geometry at revision
`bd880298474e37b78483a67ed9cd691ed1c5526f`. The original MIT license is kept in
`packages/ui/src/vendor/groam/LICENSE`. Use these domain-free `@study/ui` primitives;
application data and typed RPC remain in `apps/desktop/src`.

The shared Menu and searchable single-select Combobox adapt coss UI's MIT-licensed
`apps/ui` components at revision `3d8ca28e7d90123e9e0f44665944dc240b026ccb`.
The license and source links live in `packages/ui/src/vendor/coss`. Use the existing
Base UI foundation for keyboard navigation, focus and dismissal; keep Groam's tokens
and geometry. Include only controls the study tasks need, with no second component kit.

Headers sit on the page, with no rule, contrasting band or sticky overlay. A muted parent,
light slash and 20px semibold title share a row with compact actions. The 73.5px desktop
title row aligns with the sidebar switcher's centre. Header-to-body space is 24px on
desktop and 16px on narrow views. Page bodies fill the available width with
24px desktop/16px narrow insets. Overview and library pages share these insets without an additional
page-width cap; reading and editing columns retain their content-specific measures.
Lists bleed to those insets, use fine divided rows, 12px vertical
padding, 13.5px desktop type, and plain 18px icons; they are not grids of boxed icon cards.
Hover, focus, current selection and keyboard activation retain their distinct states.

## Tokens and type

The desktop's token authority is `apps/desktop/src/styles.css`; shared primitives consume
semantic roles. The landing site keeps its separate presentation. Google Sans Flex is
bundled locally under `apps/desktop/src/assets/fonts`, including its license. Use it for
headings, body and labels; use the local monospace stack for code and paths. Diagrams
retain their hand-drawn Excalifont lettering.

| Role            | Light   | Dark    |
| --------------- | ------- | ------- |
| Canvas          | #f4f4f6 | #121318 |
| Page            | #fdfdfd | #191a20 |
| Sidebar         | #efeff2 | #15161b |
| Card            | #fafafa | #191a20 |
| Popover         | #f8f8fa | #202127 |
| Text            | #32343b | #c5c7d0 |
| Supporting text | #636671 | #a0a3af |
| Primary         | #496b9b | #8b9fc4 |
| Primary text    | #ffffff | #15161b |
| Border          | #e1e2e6 | #30323b |
| Input           | #cccfd5 | #41444f |
| Muted           | #efeff2 | #262831 |
| Accent          | #e9eaee | #2b303c |

Controls use 8px corners and a compact 32px desktop height; surfaces use quiet hairlines
and 12px corners. Green, ochre and rose communicate status, always with text. Do not
introduce decorative gradients, photographs, shadows around every card, invented progress
metrics, remote fonts or saturated alternative palettes.

## Subject workspace

The current subject picker owns the top of the sidebar, with search directly below it. Subject identities use one quiet letter badge throughout the picker, lists and notebook breadcrumb. Automatic initials follow the title; a saved custom one-to-three-letter monogram can replace them. The icon editor previews both modes and confirms successful saves with a toast.
Overview, Notes, Sources, Flashcards, Diagram and Practice all belong to that subject. Changing subjects keeps the section and clears the old selected item. An item's
own subject is authoritative for deep links; unresolved or missing subjects never expose
another subject's content. The saved current-subject hint is validated against the database.
All subjects, Settings and Help stay global in the footer. Search is subject scoped inside
the workspace and global on global pages.

The overview prioritizes review, continuing a note and adding sources, then background
activity. Notes are the note dump, not a generic assistant chat. Each entry keeps its
attachments, current text, earlier versions, transformation origin and parent version.
Improve, Summarize and custom transformations use the existing version model. Original
uploaded bytes stay accessible; a file's extraction is not presented as a fictitious note
version. Text notes are classified as questions in the background. Questions expose an explicit Answer action; automatic answers use the medium model and require the workspace preference to be enabled. Manual question/note corrections take precedence over detection.

## Interaction and verification

Preserve light/dark appearance, zoom, bilingual English/Italian copy, keyboard navigation,
dialog focus, drafts, recording ownership, source citations, destructive confirmations,
pending work and actionable recovery. The 820 × 540 native minimum remains usable;
narrower browser views preserve navigation and move header actions into the shared dock.
All copy comes from `study-localization`. Browser tests use isolated real RPC servers.
Assess every page in both themes and at narrow sizes, including important pending, empty
and version-history states, and fix independent UX/UI review findings before finishing.

## Note entry and errors

The Notes starter lives at `/notes`; an active notebook uses `/notes/:noteId`.
Both use `WorkspaceSurface` from `@study/ui/workspace`, with explicit welcome and note
variants, the same restrained typography and a bottom composer dock. The content column
stops at 48rem on wide screens; the interface does not enlarge to fill the monitor.
The active notebook header is one compact subject/note breadcrumb. The sidebar owns
its collapse control while open, and the content shows one reveal control while hidden.
Cmd/Ctrl+K reveals navigation and focuses search. Note actions use the row's context
menu without permanent overflow buttons.

`WorkspaceCard` owns one compact right context panel, controlled by the square menu icon
in the note header. It combines current-note notes, attachments, revisions and
generated material with selection, page transformation and note deletion actions.
Selection and transformation open shared dialogs with readable 14px form text and one
scrolling body. Closing either dialog returns focus to its card action; closing the panel
keeps drafts and operation ownership mounted. Previews are read-only and retain exact
version identities; a revision compares its actual parent with its current version. The
starter uses the same panel toggle without inventing activity or totals. Narrow layouts
move the card into the page flow and keep controls reachable.

`@study/ui/composer` owns the shared input surface and footer, with starter and notebook
variants using the same geometry. Draft text and files follow the user into a confirmed
note; starting a note does not request a reply. Notes remain an unboxed chronological
notebook. Save note is primary, Cmd/Ctrl+Enter saves, and Ask Study is explicit. Destructive
note actions use the shared confirmation dialog and preserve pending and uncertain
operation fences.

Shared `@study/ui/error-state` owns page and inline failure presentation: a neutral icon,
localized title and explanation, and the relevant recovery action. Page failures replace
the page body; operation failures stay compact beside the work they affect.

## Settings

Settings use the shared `@study/ui/settings` surface, with an 85rem (1360px) maximum dialog width,
a 13rem navigation column and compact labels and controls. Sections use shared groups
and rows; descriptions stay with their labels, and controls align at the trailing edge.
The Data and backups view separates local backup actions, saved backups and restore
status. File selection uses the shared Button, empty states explain the next action,
and destructive confirmations preserve their existing safeguards. Narrow screens reduce
navigation to icons and use the available viewport without clipping controls.

Appearance uses matching three-column color-scheme and theme cards on wide screens,
with a shared 120px height. Scheme previews show a miniature workspace; themes retain
their circular color palettes. Narrow screens reduce the columns. Interface sliders
use neutral tracks and thumbs, plain tabular values and visible keyboard focus.

Shared `@study/ui/danger-dialog` owns destructive confirmations. The user types the
localized action phrase or the entity's exact name; opening another confirmation resets
that intent. Pending operations retain their identity, disable dismissal and preserve
reviewed-version and uncertain-operation safeguards. Long confirmations scroll their
body while keeping the title and actions visible.

Shared `@study/ui/toast` provides localized operation feedback. Notifications follow
new committed outcomes rather than replaying cached receipts. Backup rows show useful
dates and sizes; operation identifiers and diagnostic receipts stay out of normal UI.
