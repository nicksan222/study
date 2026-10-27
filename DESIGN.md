# Study design system

Study uses Groam's Graphite workspace foundations, approved in the subject overview mockup
`.impeccable/mocks/home-groam/subject-a.png`. The session notebook direction is
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
desktop and 16px on narrow views. Page bodies have 24px desktop/16px narrow insets and a
1600px maximum width. Lists bleed to those insets, use fine divided rows, 12px vertical
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

The current subject picker owns the top of the sidebar, with search directly below it.
Overview, Sessions, Sources, Flashcards, Diagram, Practice and Activity all belong to that
subject. Changing subjects keeps the section and clears the old selected item. An item's
own subject is authoritative for deep links; unresolved or missing subjects never expose
another subject's content. The saved current-subject hint is validated against the database.
All subjects, Settings and Help stay global in the footer. Search is subject scoped inside
the workspace and global on global pages.

The overview prioritizes review, continuing a session and adding sources, then background
activity. Sessions are the note dump, not a generic assistant chat. Each entry keeps its
attachments, current text, earlier versions, transformation origin and parent version.
Improve, Summarize and custom transformations use the existing version model. Original
uploaded bytes stay accessible; a file's extraction is not presented as a fictitious note
version. Only notes mentioning `@study` receive an answer.

## Interaction and verification

Preserve light/dark appearance, zoom, bilingual English/Italian copy, keyboard navigation,
dialog focus, drafts, recording ownership, source citations, destructive confirmations,
pending work and actionable recovery. The 820 × 540 native minimum remains usable;
narrower browser views preserve navigation and move header actions into the shared dock.
All copy comes from `study-localization`. Browser tests use isolated real RPC backends.
Assess every page in both themes and at narrow sizes, including important pending, empty
and version-history states, and fix independent UX/UI review findings before finishing.
