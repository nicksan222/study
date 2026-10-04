---
name: Study
description: The Highlighted Notebook. A quiet, neutral study notebook in the Codex app's restraint, whose one colour is the learner's highlighter.
colors:
  canvas-dark: "#1a1a1a"
  sidebar-dark: "#0e0e0e"
  raised-dark: "#222222"
  fill-dark: "#222222"
  hover-dark: "#262626"
  selected-dark: "#2e2e2e"
  line-dark: "#2c2c2c"
  ink-dark: "#ececec"
  ink-2-dark: "#ababab"
  ink-3-dark: "#858585"
  highlighter-ink-dark: "#f2d24b"
  highlighter-wash-dark: "#3b3416"
  danger-dark: "#f07a72"
  canvas-light: "#ffffff"
  sidebar-light: "#f3f3f3"
  raised-light: "#ffffff"
  fill-light: "#f3f3f3"
  hover-light: "#ededed"
  selected-light: "#e7e7e7"
  line-light: "#e4e4e4"
  ink-light: "#111111"
  ink-2-light: "#4f4f4f"
  ink-3-light: "#686868"
  highlighter-ink-light: "#806200"
  highlighter-wash-light: "#fff0a1"
  danger-light: "#c4302b"
  highlighter-fill: "#f2d24b"
  on-highlighter: "#1a1600"
  site-blue-bg-light: "#ebf3f8"
  site-blue-chip-light: "#d3e5ef"
  site-blue-ink-light: "#24516e"
  site-green-bg-light: "#edf4ee"
  site-green-chip-light: "#d5e9d8"
  site-green-ink-light: "#2c5a37"
  site-orange-bg-light: "#fbf0e4"
  site-orange-chip-light: "#f7dcc2"
  site-orange-ink-light: "#7a4519"
  site-purple-bg-light: "#f4f0f8"
  site-purple-chip-light: "#e3d8ee"
  site-purple-ink-light: "#57397a"
  site-pink-bg-light: "#faeff4"
  site-pink-chip-light: "#f2d6e3"
  site-pink-ink-light: "#7d3256"
  site-blue-bg-dark: "#1b252c"
  site-blue-chip-dark: "#23394a"
  site-blue-ink-dark: "#a9cde3"
  site-green-bg-dark: "#1c261f"
  site-green-chip-dark: "#25392b"
  site-green-ink-dark: "#a8d3b1"
  site-orange-bg-dark: "#2a2219"
  site-orange-chip-dark: "#45311f"
  site-orange-ink-dark: "#eec39c"
  site-purple-bg-dark: "#241f2b"
  site-purple-chip-dark: "#392d48"
  site-purple-ink-dark: "#cfb8ea"
  site-pink-bg-dark: "#2a1e24"
  site-pink-chip-dark: "#45293a"
  site-pink-ink-dark: "#ebb5cd"
typography:
  display:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: "32px"
  title:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: "24px"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: "24px"
  ui:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  small:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "18px"
  caption:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
  diagram:
    fontFamily: "Excalifont"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "22px"
  site-display:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "clamp(44px, 5.4vw, 76px)"
    fontWeight: 600
    lineHeight: 1.02
    letterSpacing: "-0.035em"
  site-heading:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "clamp(32px, 3.6vw, 48px)"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.03em"
  site-lead:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 400
    lineHeight: 1.55
  site-body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.6
  site-hand:
    fontFamily: "Excalifont, Inter, system-ui, sans-serif"
    fontSize: "23px"
    fontWeight: 400
    lineHeight: 1.25
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "20px"
  full: "9999px"
spacing:
  xxs: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  xxl: "48px"
  xxxl: "64px"
components:
  button-primary-dark:
    backgroundColor: "{colors.ink-dark}"
    textColor: "{colors.canvas-dark}"
    typography: "{typography.ui}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 12px"
  button-primary-light:
    backgroundColor: "{colors.ink-light}"
    textColor: "{colors.canvas-light}"
    typography: "{typography.ui}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 12px"
  button-highlighter:
    backgroundColor: "{colors.highlighter-fill}"
    textColor: "{colors.on-highlighter}"
    typography: "{typography.ui}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 14px"
  button-quiet-dark:
    backgroundColor: "{colors.hover-dark}"
    textColor: "{colors.ink-dark}"
    typography: "{typography.ui}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 12px"
  button-quiet-light:
    backgroundColor: "{colors.hover-light}"
    textColor: "{colors.ink-light}"
    typography: "{typography.ui}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 12px"
  icon-button:
    rounded: "{rounded.md}"
    size: "28px"
  send-button:
    rounded: "{rounded.full}"
    size: "28px"
  row:
    typography: "{typography.ui}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 8px"
  chip:
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    height: "22px"
    padding: "0 8px"
  composer-dark:
    backgroundColor: "{colors.raised-dark}"
    textColor: "{colors.ink-dark}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
    padding: "12px 16px"
  composer-light:
    backgroundColor: "{colors.raised-light}"
    textColor: "{colors.ink-light}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
    padding: "12px 16px"
  popover:
    rounded: "{rounded.lg}"
    padding: "4px"
  sidebar:
    width: "260px"
  notebook-column:
    width: "680px"
  page-column:
    width: "960px"
  site-tile:
    rounded: "{rounded.xl}"
    padding: "clamp(16px, 2vw, 32px)"
  site-paper-light:
    backgroundColor: "{colors.canvas-light}"
    rounded: "{rounded.lg}"
    padding: "24px"
  site-paper-dark:
    backgroundColor: "{colors.canvas-dark}"
    rounded: "{rounded.lg}"
    padding: "24px"
  site-tab-chip:
    rounded: "{rounded.md}"
    size: "40px"
  site-button-large:
    backgroundColor: "{colors.highlighter-fill}"
    textColor: "{colors.on-highlighter}"
    rounded: "{rounded.md}"
    height: "48px"
    padding: "0 24px"
  site-frame:
    width: "1200px"
  site-docs-sidebar:
    rounded: "{rounded.xl}"
    width: "260px"
  site-docs-page:
    width: "760px"
  site-reading-measure:
    width: "680px"
---

# Design System: Study

## Overview

**Creative North Star: "The Highlighted Notebook"**

Study looks like a well-kept notebook on a quiet desk. The structure and restraint come from
the Codex app: a tonal sidebar beside a plain canvas, one reading column, a floating
composer, and work that folds away into one grey line instead of filling the page. Almost
everything is neutral ink on neutral ground. Lines and boxes are rare; tone, space and type
do the separating.

The one colour is the learner's highlighter. It marks only what is about learning: the cards
due today, the days to an exam, the `@study` that asks a question, the passage an answer
cites, the question being practised, and where the keyboard is. Because nothing else is
coloured, a highlighted thing is always worth looking at. This is the visual form of "a
calm place for everything you learn": calm by default, bright exactly where attention pays.

Both themes are first-class. Dark is the first-run look (evening study at a desk), light is
Codex's paper-white canvas. Every token exists in both. Inter carries the whole interface in
six sizes; diagrams keep their hand-drawn Excalifont. The interface scales as one with zoom.

**Key Characteristics:**
- Neutral tonal surfaces: sidebar, canvas and raised layers, with hairlines only where tone can't separate.
- One accent, the highlighter, used for learning moments, never for decoration or brand; the logo is its one exception.
- A notebook, not a chat: the learner's notes are the page, read at a comfortable measure.
- Background work folds into one quiet line that opens on demand.
- Six type sizes, a 4-point spacing scale, four radii.
- Failure is the only state with colour; success and progress stay quiet.

## Colors

Neutral ink on neutral ground in two themes, plus one highlighter yellow and one red for
failure.

### Primary
- **Highlighter fill** (`highlighter-fill`): the solid marker. Fills the one learning action
  on a screen (Review now, Start practice) with `on-highlighter` text, and the count badge of
  cards due. The same yellow in both themes, as a real highlighter is.
- **Highlighter ink** (`highlighter-ink-dark`, `highlighter-ink-light`): the highlighter as
  text, icon or line: the exam countdown, the focus ring, the active practice question's
  marker, the selected citation. In light it darkens to an ochre so it reads on white.
- **Highlighter wash** (`highlighter-wash-dark`, `highlighter-wash-light`): a translucent
  marker stroke behind ink: a cited passage while its citation is hovered or focused, a
  search match, the `@study` mention chip. Text on it stays `ink`.

### Neutral
- **Canvas** (`canvas-*`): the main reading surface: notebook, pages, settings.
- **Sidebar** (`sidebar-*`): the sidebar and title bar, one continuous tone. Darker than the
  canvas in dark, greyer in light, so the regions separate with no divider.
- **Raised** (`raised-*`): what floats: composer, menus, popovers, the command palette and
  dialogs. Always with a hairline and the floating shadow, since in light it is the canvas's
  own white.
- **Fill** (`fill-*`): what is set into the page rather than floating on it: an opened fold
  of work, previews and media tiles, flashcard faces.
- **Hover / Selected** (`hover-*`, `selected-*`): row and control states. Selected is a
  full-width pill, never a coloured bar or border.
- **Line** (`line-*`): the rare hairline: the composer's and popovers' edge, table rules, the
  edge of a text field. Never around page sections.
- **Ink, Ink 2, Ink 3** (`ink-*`, `ink-2-*`, `ink-3-*`): primary text; secondary text and
  icons; metadata, timestamps, section labels and folded work lines.
- **Danger** (`danger-*`): text and icon of something that failed and needs the learner. The
  only state colour. Its one other use is an alert asking before something is lost: the
  glyph on its wash and the button that goes ahead.

### Named Rules
**The One Highlighter Rule.** The highlighter marks learning, nothing else: due cards, exam
countdowns, `@study`, citations, practice and focus. If a use isn't about remembering,
understanding or practising, it's neutral. At most one highlighter-filled control per screen.

**The Highlighter's Tile Rule.** The logo is the highlighter's own tile: a `highlighter-fill`
rounded square (radius 15 on a 64 grid) holding an open book in `#1a1600` ink on `#fffdf4`
pages, one line of the right page washed yellow. It is the one place the highlighter means
the brand, and it stays yellow in both themes. The masters are
`assets/logo/study.svg` and, under 40px (title bars, favicons), `study-small.svg`, the
same book without text lines; the app, the website, the favicon and the installers' icons
are all made from them. It is never recoloured, outlined or set on a yellow ground.

**The Quiet Success Rule.** Done is normal, so it isn't coloured: finished work is an `ink-3`
line with a check. Running is a shimmer, waiting is `ink-3` text. Only failure gets colour,
in `danger`, always with what to do next. Recording is running work too: its live dot and
level meter are `ink`, and Stop is a quiet button.

**The Next Step Rule.** A failure reads in order: the reason, then the one action that fixes
it, after or beside it, never above it. The action is the one that can help: Sign in when
it needs a sign-in, Pick sessions when the sessions hold too little, Retry only when trying
again can work. A page that fails to load says so in `danger` with Retry.

**The No Rainbow Rule.** Kinds of things (audio, PDF, page, project) are told apart by a
monochrome glyph and a word, never by a hue. No coloured icon tiles. A diagram's own fills are content,
like a drawing on paper, and keep their colours; the interface around it doesn't.

**The Contrast Floor.** Body and UI text meet 4.5:1 on every ground they sit on. `ink-3` is
for `canvas` and `sidebar`; on `selected` or `hover`, metadata steps up to `ink-2`.

## Typography

**Body Font:** Inter, bundled in Regular, Medium and SemiBold (the system UI font on macOS).
**Diagram Font:** Excalifont, for diagrams only.

**Character:** One workhorse sans in six sizes and three weights. Hierarchy comes from size
and weight steps, never from colour or capitals.

### Hierarchy
- **Display** (600, 26px, 32px): the one greeting or empty-state headline on a page. At most
  one per screen.
- **Title** (600, 17px, 24px): the page or session title, section headings, dialog titles.
- **Body** (400, 15px, 24px): notes, answers, transcripts, readings: anything read rather
  than scanned. Max measure 680px (about 70 characters).
- **UI** (400, or 500 for labels that need weight, 14px, 20px): controls, sidebar and list
  rows, buttons, menu items, field text.
- **Small** (400, 13px, 18px): secondary lines in rows (a project under a session), help
  text, folded work lines.
- **Caption** (400, 12px, 16px): timestamps, sizes, counts, section labels, chips.

### Named Rules
**The Six Sizes Rule.** Every text size is one of the six above, at 100% zoom. Today's sizes
map onto them: 10 to 12.5 become caption, 13 small, 14 UI, 15 and 16 body, 17 to 19 title,
22 and up display (and a 22 to 24 heading that isn't a page's headline becomes title).

**The Sentence Case Rule.** Labels, buttons and headings are in sentence case. No all-caps,
no tracked-out small labels.

## Layout

The window is a sidebar beside a canvas. The sidebar (260px, resizable from 220 to 360px,
collapsible) and the title bar share one tone. The title bar holds the sidebar toggle,
back and forward, the page title in `title` (17/24, 600) with its project in `ink-3` beside
it on a session, and the page's actions as 28px transparent icon buttons (16px `ink-2`
glyph) on the right. Nothing else: no description after the title, no zoom control (zoom
lives in the View menu, its shortcuts and Settings › Appearance), no filled buttons. There
is no other toolbar strip, and no page repeats its actions in its own header.

Every page is one column, starting on the canvas's left edge under the page title, in one of
two widths:
- **Reading, 680px:** the notebook, study notes, a flashcard review, practice and
  Help: anything read.
- **List, 960px:** Home, Library, Activity, a project's overview, Settings, and a diagram,
  whose canvas needs the width: pages of rows, tiles, fields and drawings.

Every page sits in the same frame: the page width (960px), centred on the canvas, with at
least the 28px page gutter on each side. A page's column starts on the frame's left edge, so
content sits in the middle of a wide window and its first letter is in the same place on
every page that shares a canvas width; a reading column (680px) simply stops sooner, and
the frame's room past it stays empty. Its description, headings, rows, tiles and actions
all start on that edge; nothing at the first level adds its own inset, and only nesting (a
project's sessions, an opened fold) indents, by 16px. A page's description is its first
line, in UI `ink-2`, in the same column as everything under it, with 24px below it. The
canvas keeps 32px above the column and 48px below. As the canvas narrows the frame fills it
inside the gutter. In code, a page body is `study_ui::page_scroll` (the gutter and the space
above and below) holding a `study_ui::page_column(Column::Read | Column::Page)`, which
brings the frame; a page of sections puts `study_ui::page_sections` in it. Never a
centring margin or a hand-set inset.

The notebook is a reading column in the same frame. The time and a note's actions sit in a
96px margin to the right of it. The composer is docked at the bottom of the notebook column,
at the notes' width, with 16px below it. A new session is the empty notebook it becomes:
its project and heading at the top, three ways to start under them (record, add files, ask
@study), and the composer docked where the open session keeps it, so nothing moves when
the first note goes in.

The first-run tour keeps its footer (Back, the step, Continue) in the same place from step
to step, pinned to the bottom of the stage, so Continue never moves under the pointer.

Spacing follows a 4-point scale (4, 8, 12, 16, 24, 32, 48, 64), and in code every gap,
padding and margin is a `scale::SPACE_*` step, never a literal. Inside a row or control, 8 to
12; between related items, 4 to 8; between groups, 24 to 32; between page sections, 48. A
section is a `title` heading and its content on the canvas, separated from the next by space,
not a border. In code, a section is `study_ui::Section` (its title, an optional count and
action, its content), a lone heading is `study_ui::heading`, and a paragraph of reading text
is `study_ui::body_text`. Whatever opens a page's body is `study_ui::PageIntro`, in one of
three variants, each with fixed type and spacing: `lead`, the page's description alone (UI,
`ink-2`); `title`, what the page shows (title type, then its description in UI `ink-2` and
its facts in caption `ink-3`, 4px apart), such as study notes or a quiz; and `headline`, the
screen's one display headline (display type, its description in body `ink-2`, 8px apart),
such as a new session or a step of the tour. A control the page belongs to (a project
picker) sits above the title and actions sit 16px under the rest; 24px separates it from
what follows. A page or list with nothing to show yet, still loading, or failed
to load shows `study_ui::EmptyState`: its glyph, one line, and the way forward, centred.

Below 680px of window width the sidebar overlays the canvas instead of sitting beside it,
and the columns fill the width with 16px margins. Below 720px of window height the sidebar's
rows go dense (28px). Everything scales with zoom (75% to 200%).

### Named Rules
**The Space Not Lines Rule.** Regions separate by tone (sidebar, canvas, raised) and groups by
space. Add a hairline only where neither can work: a table, a field edge, a floating layer.

## Elevation & Depth

Depth is tonal. Four levels: sidebar, canvas, fill (set into the page) and raised (floating
above it). Surfaces are flat at rest. The one
shadow belongs to floating layers (composer, menus, popovers, the command palette, dialogs, alerts,
toasts), always together with a `line` hairline: in dark a deep soft shadow (0 8px 24px,
black at 45%), in light a faint one (0 8px 24px, black at 8%). Cards, rows and page sections
never cast shadows.

### Named Rules
**The Only Floating Things Float Rule.** A shadow means "this is above the page and will go
away". Nothing anchored in the page gets one.

## Shapes

Gently rounded, in four steps. Small (6px) for chips, citation marks, inline code and the
`@study` mention. Medium (8px) for buttons, rows, menu items and fields. Large (12px) for
menus, popovers, dialogs, previews and media tiles. Extra large (20px) for the composer only.
Round controls (the send button, avatars) are full circles. Icons are 1.5px-stroke line
drawings at 16px (14px inline), coloured `ink-2`, or `ink` when active.

## Components

### Buttons
- **Shape:** medium radius, 32px tall (28px in dense rows), 12px side padding.
- **Primary:** filled with `ink`, text in the canvas colour: the main non-learning action of
  a view (Create project, Save).
- **Highlighter:** filled with `highlighter-fill` and `on-highlighter` text: the learning
  action (Review now, Start practice). One per screen at most, under the One Highlighter Rule.
- **Quiet:** `hover` tone fill, `ink` text, no border: every other action button, such as
  Try again or Start again.
- **Ghost:** transparent, `ink-2` text, `hover` tone on hover: a way to somewhere rather
  than an action (Open library, See details, Show details), and secondary choices such as
  Cancel.
- **Icon buttons:** 28px, transparent, `ink-2` glyph; `hover` tone on hover.
- **Send:** a 28px `ink` circle with an arrow in the canvas colour, inert (`selected` fill)
  while empty.
- **States:** hover steps the fill one tone; pressed one more. Focus draws a 2px
  `highlighter-ink` ring 2px outside the shape. Transitions take 100ms.

### Chips
- **Style:** small radius, 22px, caption text, `selected` tone fill, `ink-2` text. Used for
  attachments in the composer, filters and source kinds.
- **Mention:** `@study` renders as a chip on `highlighter-wash` with `ink` text: the learner
  can see a note will be answered.
- **Citation:** the source's number alone, no brackets, as a superscript chip: caption
  digits in `ink-2` on the `selected` fill, small radius, 16px tall, 0 4px padding, raised
  4px off the baseline. Hovered, it fills with `highlighter-wash`; focused, it takes the
  focus ring. Opening it shows the cited passage in its source, washed in
  `highlighter-wash`: the passage lives in another file, so it lights up where it opens. A source list names each source by its title in `ink`, its site
  or moment in caption `ink-3`; never a raw address in place of a title.

### Cards / Containers
- No bordered boxes, anywhere on the page: a section is a heading, its rows and space. What
  must stand apart (a flashcard face, a card being edited, a choice) sits on `fill` with
  space around it: no border and no rule inside it. Rows of settings separate by 12 to 16px
  of space, not hairlines.
- **Choices** (Settings › Language and Appearance) are large-radius tiles on `fill`; the
  chosen one takes the `selected` tone and a check, never an outline.
- **Previews and media** (a page image, a video frame, a file's first lines) sit in a large-
  radius tile on `fill`, no border, no shadow.
- **An opened fold** (a transcript, a reading) is an inset on `fill` at medium radius with
  16px padding, under the line that opened it.

### Inputs / Fields
- **Style:** `canvas` fill with a `line` hairline, medium radius, 32px, UI text; placeholder
  in `ink-3`.
- **Focus:** the hairline gives way to the 2px `highlighter-ink` focus ring. The composer is
  the exception: it holds focus whenever the learner writes, so a ring there would never go
  out. Focused, its hairline steps up to `ink` at 26% instead.
- **Error:** the hairline turns `danger`, with the message below in small `danger` text.
- **Disabled:** text and hairline drop to `ink-3`.

### Alerts
- **What asks:** every action that loses or replaces the learner's work (deleting a file,
  project, session, message, material, card or practice; writing material again) asks
  first in an alert, never in an inline row. Nothing else uses one: a choice that loses
  nothing just happens.
- **Shape:** a card at most 420px wide, centred over the whole window, on `raised` with the
  hairline, large radius, 24px padding and the floating shadow. Behind it the window dims
  under a black scrim (55% in dark, 25% in light), and nothing behind it takes a click.
- **Content:** a 40px disc with the glyph (a bin on `danger` at 12% in `danger` for a loss;
  a turning arrow on `highlighter-wash` in `highlighter-ink` for a replacement), then the
  title as a short question in Title type ("Delete this session?"), then what goes with it
  and what stays in small `ink-2` ("Attached files stay in the Library."). A failed try
  shows under it in small `danger`.
- **Buttons:** right-aligned, Cancel (ghost) then the button that goes ahead, named by the
  action ("Delete session", "Write again"): `danger` for a loss, primary for a replacement.
- **Leaving:** Cancel, Escape and a click on the dimmed window all close it without going
  ahead. While the action runs, Cancel is disabled and the alert stays.

### Navigation
- **Sidebar, top to bottom:** labelled destination rows (Home, Projects, Flashcards,
  Diagrams, Practice, Library, Activity), then the page's own list (the projects
  tree on Projects), then Settings and Help pinned to the bottom. Labels and icons together,
  as Codex does: no unlabelled icon rail. Search stays in the title bar with its shortcut.
- **Rows:** 32px, medium radius, UI text with a 16px `ink-2` glyph, meta right-aligned in
  caption `ink-3` (8h, 1d). Hover is the `hover` tone; selected is a full-width `selected`
  pill with `ink` text. Only a short value (a time, a count) sits at the right; a status in
  words (Needs sign-in, Not downloaded) goes on the row's secondary line, so the label keeps
  the width and never breaks or truncates.
- **Projects tree:** a project row in UI weight 500 with a disclosure chevron; its sessions
  indented 16px below in regular weight, so projects and sessions never read as the same
  thing.
- **Running work** shows as a small spinner in place of the row's glyph.
- **Row tools** (a project's open-material and new-session buttons) show only while the
  row is hovered, focused or selected, so names get the width.
- **Pinned at the bottom:** Settings and Help, one under the other, so neither label ever
  breaks or truncates in Italian or at high zoom. Where the list scrolls under them, it
  fades into the sidebar tone over 24px.

### Composer
- **Shape:** extra-large radius, `raised` fill, `line` hairline, the floating shadow.
- **Inside:** body-sized text field over a bottom row: attach, tools and record as icon
  buttons on the left, the send circle on the right.
- **Typing:** `@study` becomes a mention chip as it's typed; `/` opens the tools menu as a
  popover above the composer.

### Notebook (signature component)
The session is a notebook, not a chat; its glyph everywhere is a notebook, never a speech
bubble.
- **Notes** are the page: body text, left-aligned in the 680px column, no bubble or box.
  Consecutive notes sit 12px apart, a new moment 32px. The time and the note's actions
  (copy, reply, delete) appear in `ink-3` to the right on hover, and on every entry while
  the learner moves through the notebook by keyboard (not while writing in the composer).
- **Files** are one 36px line: kind glyph, name in UI, kind and size in caption `ink-3`,
  open and preview as icon buttons on hover.
- **Work on a file folds** into one small `ink-3` line under it, with a chevron:
  "Transcribed 8 min of audio", "Read 12 pages". Opening it shows the text in an inset on `fill`. While
  it runs, a soft highlight sweeps across the line's words; failure turns the line `danger`
  with Retry beside it.
- **Answers** from `@study` start with a caption `ink-3` label ("Study", with its glyph),
  then unboxed body prose with citation chips. Opening a citation shows its passage in the
  source's preview, washed in `highlighter-wash`: the answer and its source light up
  together.
- **Replies** fold into a caption `ink-3` line ("2 replies") that opens in place.
- **Days** are named by a caption `ink-3` label with 32px above it; no rules either side.
- **Keyboard:** Tab follows reading order (a note's actions, a file line, its fold,
  citations, replies, then the composer), each with the focus ring.

### Lists and summaries
- A list is rows on the canvas under a heading: no card per item.
- A count or status reads as a sentence in a row ("29 cards due · Linear algebra exam in
  5 days"), the due count and countdown in the highlighter, not as big stat tiles.

## Do's and Don'ts

### Do:
- **Do** separate regions by tone (sidebar, canvas, raised) and groups by space (24 to 48px).
- **Do** keep every text size on the six-step scale and every gap on the 4-point scale.
- **Do** reserve the highlighter for learning moments, with at most one highlighter-filled
  control per screen.
- **Do** fold background work into one `ink-3` line that opens on demand.
- **Do** design every surface in dark and light, and in English and Italian. Italian runs
  longer, so give labels room to grow and let rows wrap rather than truncate.
- **Do** make every control reachable and visibly focused from the keyboard, with the 2px
  highlighter focus ring.
- **Do** size everything through the theme's zoom unit, so 75% to 200% zoom holds.

### Don't:
- **Don't** draw a border around anything on the page but a field, a table or a floating
  layer: not a section, a list, a card, a choice or a dashboard figure.
- **Don't** use coloured icon tiles or a hue per kind of thing.
- **Don't** colour success or progress green; only failure is coloured.
- **Don't** tint chrome: the title bar is the sidebar's tone, never blue-grey.
- **Don't** right-align the learner's notes as chat bubbles.
- **Don't** add shadows to anything anchored in the page.
- **Don't** put a kicker (a small label above a heading, such as "Summary") on a page; the
  title bar names the page.
- **Don't** ask "are you sure?" inline beside the thing; a loss or a rewrite asks in an
  alert, and nothing else does.
- **Don't** colour a learner's wrong answer `danger`: it is a result, not a failure.
  Failure is the app's, and comes with a fix.
- **Don't** introduce a type size, radius or colour outside this file; change this file first.

## Website

The website (`apps/landing`, landing and docs, English and Italian) is the Highlighted
Notebook at marketing scale: the app's tokens, fonts, radii and spacing in both themes
(`src/styles/global.css`), warmed by two things the app does not have, notebook-tab tints
and a hand-drawn margin. Everything above holds on the site except where this section says
otherwise. The site follows the reader's `prefers-color-scheme`.

### Colour
- **Notebook tabs** (`site-<hue>-bg`, `-chip`, `-ink`, blue, green, orange, purple, pink, in
  both themes): one soft tint per story section, set by a `tint-<hue>` class. The `bg` is the
  section's tile, the `chip` its icon chip (40px, medium radius, at the section's lead; 24 to
  32px inside its tiles), the `ink` the chip's glyph and short labels in that tile. Never on a
  paragraph, a heading or a button. Each tint means one thing wherever it appears, in its own
  section and in the hero's previews of it: green is Answers, purple is Quizzes, orange is
  Flashcards, pink is Diagrams, blue is the material and its home (the Material and Yours
  sections). A tint names a section, not a kind of thing: the files in the material tile all
  take the section's blue. This is the site's one exception to the No Rainbow Rule; the app
  keeps it.
- **Highlighter** yellow is not a tab. It keeps its reserved uses: learning moments (the
  phrase washes in the hero passage, the `@study` mention, cited passages, a right answer, a
  pressed rating, the caret), focus, and Download.
  Download is the one section without a hue: its tile is `sidebar`, so the only yellow in it
  is the app's icon (the logo, large and tilted a little, as it sits in a dock) and the
  Download button. The other platforms are one line of links, never a table. One
  highlighter button per screen: Download in the hero; the nav's Download is quiet there.
- A diagram's node fills use tab chip tones, as content (the No Rainbow Rule's drawing
  exemption).

### Type
Inter at display scale with tight tracking: `site-display` for the one hero headline,
`site-heading` for section titles (docs H1 is 34 to 48px, same tracking), `site-lead` for
section and docs leads in `ink-2`, `site-body` (17/1.6) for page text and docs prose (17/1.7).
Tile titles are 19px 600; product pieces inside tiles keep the app's sizes (13 to 17px).
Excalifont (`site-hand`, 21 to 24px, `ink-2`) is for margin notes and inside diagrams only.
Sentence case throughout.

### Layout
- A 1200px frame with a `clamp(16px, 4vw, 48px)` gutter. Sections sit 96 to 168px apart
  (`clamp(96px, 11vw, 168px)`); no rules between them.
- **Hero:** five columns of headline, lead and Download beside seven of the source passage
  (`5fr 7fr`), stacking under 1080px.
- **Story section:** a 12-column grid, 24px gaps: the lead (tab chip, heading, body,
  `arrow-right` links to its docs pages) over columns 1 to 7 at the 680px measure, a margin
  note in 8 to 12, then tiles. Paired tiles split 5/7 or 7/5 and stretch to the same height.
  Under 900px everything takes the full width and wide captures drop out.
- **Docs:** a 260px tonal sidebar (`sidebar` tone, extra-large radius, sticky under the bar)
  beside a page of at most 760px whose lead, prose and previous/next links stop at the 680px
  measure. Groups are caption `ink-3` labels; the current page is a `selected` pill in 500
  weight. Under 900px the sidebar becomes a disclosure above the page. Tables are the only
  ruled thing.
- **Bar and footer:** a 64px sticky bar on canvas at 88% with a background blur; the footer
  is a `sidebar` band.

### Tiles and captures
- **Tile** (`site-tile`): extra-large radius, the section's tint (or `fill`), no border, no
  shadow. Product pieces sit on it as `site-paper-*`: `canvas`, large radius, 24px padding.
  The passage and the data sketch use `sidebar` instead of a tint.
- **Built pieces, not pictures:** the passage, cited answer, quiz question, flashcard and
  diagram are working HTML in the app's components (citation chip, mention, quiet rating
  buttons, choices on `hover`).
- **Captures** (`Shot.astro`) are real app pages, 1440 by 900 points, in the reader's theme
  and language. Each is cropped in those points to the part that proves the point and shown
  at no less than the app's own size, so no app text renders under about 11px; a crop sits in
  a large-radius `canvas` frame with an `ink-3` caption, the first naming the sample course. A rough mark (bracket, loop) may
  sit on a crop where a learner would circle it.

### Hand-drawn margin
- **Notes** are `.hand .hand-note`: Excalifont in `ink-2`, rotated within -3 to +3 degrees
  (set per note with `--r`), short, pointing at the product with a stroke. They annotate;
  they never carry a label or a heading.
- **Strokes** come from `rough.ts`'s seeded pen (each build draws the same): arrows with
  open two-flick heads, loose rings, drifting underlines, brackets, checks, a star, a pencil.
  Every line bows slightly and is drawn twice; the second `.thin` pass is 1.1px at 55%,
  0.8px off the 2px first. Round caps and joins, `currentColor`, usually `ink-2`.

### Anchored ink
Arrows and marks that point at something are empty `svg`s inside a `[data-ink-scope]`:
`data-arrow` with `data-from` (the note) and `data-to` (the target), or `data-mark` (`ring`,
`underline`, `double`, `bracket`, `check`, `star`) with `data-to`. `scripts/anchor.ts` measures
and draws them, and redraws them on resize, font load and `relayout`; they are never placed by
hand. A ring is sized to its letters' ink, not the line box, and stops halfway to the next
line, so it never crosses a neighbouring line. An arrow takes the cleanest route that crosses
no text or picture; when there is none (or the ends are missing, hidden, overlapping or too
close) the runtime hides it and says why in `data-ink-hidden`.

### Motion
- **Every sequence finishes within about 1.2s** of coming into view, its first ink to its last;
  slower ones read as far too long. The text in one piece shares a budget of `PIECE_MS` (800ms)
  and types faster when it has more units.
- **Durations come from `scripts/pace.ts`** (`DRAW_MS` 300, `HEAD_MS` 90, `FADE_MS` 160,
  `STAGGER_MS` 50, `STEP_MS` 120, `PIECE_MS` 800, `CHAR_MS` 10 to 14, `WORD_MS` 20 to 28,
  `HAND_WORD_MS` 20), or in CSS from the `--pace-draw`, `--pace-fade` and `--pace-step`
  properties it sets on the root. No other duration is written down.
- A piece (`[data-ink]`) inks once, when 15% of it is in view; pieces arriving together start
  100ms apart. Strokes draw along their length in 300ms ease-out, 50ms apart (the last by
  240ms); the text starts within 120ms, while they finish. Anchored arrows draw two at a time
  after their note has written, the shaft then a 90ms head.
- **Handwriting** reveals word by word, 20ms apart, each word wiping in from the left; the
  note settles into its rotation over 300ms. **Typing** is what the app writes: 10 to 14ms a
  letter or 20 to 28ms a word, with the `highlighter-ink` caret on the newest unit only.
  Citations and steps fade or pop in 160ms.
- Loops run only while in view and stop once touched: the hero's marks change every 3.5s, the
  Learn tabs every 9s.
- **Reduced motion and no script show the final state.** Text is always in the DOM; the
  `js-ink` class, set before first paint only with script and motion allowed, hides what has
  not been set down. Without it every piece, text and anchored mark is complete at once.

### Named Rules
**The Tab Not Paint Rule.** A section's tint lives on its tiles and chips. If it touches a
paragraph, heading or button, it's decoration; take it off.

**The Margin Is Not Chrome Rule.** Excalifont and rough strokes annotate the product. They are
never a label, a heading, a button or an icon.

**The Measured Ink Rule.** An arrow or mark that points at something is anchored and measured
by the runtime. If it is positioned by hand, it will miss at some width; anchor it.

**The Quick Ink Rule.** A sequence is done within about 1.2s, on `pace.ts` durations. If it
needs a number of its own, it is too slow or off the pace.

**The Readable Capture Rule.** A capture shows app text at the app's size or not at all: crop
it, don't shrink it.
