//! Reusable, themed presentation components for Study's GPUI desktop app. Components take
//! plain values, copy and callbacks; they never own data or localized text.
//!
//! Where to look:
//!
//! | Module | Holds |
//! |---|---|
//! | `theme` | [`configure_theme`], [`set_appearance`], [`set_zoom`], [`ZOOM_RANGE`], [`scaled_px`], [`units`], [`scale`], [`palette()`], [`Palette`], [`float_shadow`]: colors, fonts, the size scales, zoom |
//! | `icon` | [`icon()`]: Study's own SVG drawings, falling back to GPUI Kit's |
//! | `button` | [`button()`], [`highlighter_button`], [`icon_button`]: the standard button sizes, and the one learning action a screen may fill with the highlighter |
//! | `workspace` | [`WorkspaceShell`]: the main window |
//! | `onboarding` | [`OnboardingFrame`]: the first-run tour's window |
//! | `chrome` | (private) title bar and inset surface shared by both windows |
//! | `navigation` | [`NavigationRail`], [`navigation_row`]: the sidebar's labelled destinations |
//! | `page` | [`PageFrame`], [`PageView`], [`PageHeader`], [`PageIntro`], [`ContentPage`], [`SectionSidebar`] |
//! | `menu` | [`MenuItem`], [`MenuSection`]: sidebar and settings rows |
//! | `tree` | [`ProjectGroup`], [`SessionRow`]: the foldable project tree |
//! | `choice` | [`ChoiceCard`], [`ChoiceGrid`]: single-choice cards |
//! | `row` | (private) the hover-animated row surface behind menu, tree and choice rows |
//! | `composer` | [`Composer`], [`Note`]: text entry and the notebook's notes |
//! | `gallery` | [`Gallery`]: a responsive grid measured from its own width |
//! | `diagram` | [`DiagramView`], [`diagram_svg`]: paints a `study_diagram` diagram, hand-drawn in Excalifont |
//! | `diagram_canvas` | [`DiagramCanvas`], [`DiagramLabels`]: a diagram to explore, dragged, scrolled and zoomed |
//! | `preview` | [`ThemePreview`]: a miniature light or dark window |
//! | `motion` | [`Rise`], [`Shimmer`], and (private) `FadeIn` for the shell's pages: short entrance motion, and the sweep over running work's words |
//! | `keys` | [`is_shortcut`]: whether a key press is the app's or the page's |
//! | `rounded_clip` | [`RoundedClip`]: clips content to rounded corners |
//! | `ids` | (private) every element id this crate reserves |
//!
//! Every component is a builder: `new` takes what it can't render without, one method sets
//! each optional part, and `RenderOnce` draws it. The same concept has the same method
//! everywhere, so a new component should reuse these names:
//!
//! | Method | Means |
//! |---|---|
//! | `new(id, label)` | a caller-chosen `impl Into<ElementId>` first, then the visible text |
//! | `icon(IconName)` | the leading glyph, drawn through [`icon()`] |
//! | `description(text)` | quiet supporting text below or beside the title |
//! | `selected(bool)` / `disabled(bool)` | state, forwarded to the native button |
//! | `on_click(Fn(&ClickEvent, &mut Window, &mut App))` | stored as `row::ClickHandler` |
//! | `action(Button)` | a separately focusable control; call again to add another |
//! | `item(..)`, `row(..)`, `card(..)` | append one child; call once per child |
//! | `footer(..)`, `content(..)` | a slot below the main content |
//!
//! Shared styling to build on rather than copy: `row::RowSurface` for anything clickable
//! that highlights, `chrome` for window surfaces, `button` for button sizes, and
//! [`scaled_px`] (`theme::unit`), or [`units`] for many at once, for every length.

mod button;
mod choice;
mod chrome;
mod composer;
mod diagram;
mod diagram_canvas;
mod gallery;
mod icon;
mod ids;
mod keys;
mod menu;
mod motion;
mod navigation;
mod onboarding;
mod page;
mod preview;
mod rounded_clip;
mod row;
mod theme;
mod tree;
mod workspace;

pub use button::{button, highlighter_button, icon_button};
pub use choice::{ChoiceCard, ChoiceGrid};
pub use composer::{Composer, Note};
pub use diagram::{DiagramView, diagram_svg};
pub use diagram_canvas::{DiagramCanvas, DiagramLabels};
pub use gallery::Gallery;
pub use icon::icon;
pub use keys::is_shortcut;
pub use menu::{MenuItem, MenuSection};
pub use motion::{Rise, Shimmer};
pub use navigation::{NavigationRail, navigation_row};
pub use onboarding::OnboardingFrame;
pub use page::{
    Column, ContentPage, EmptyState, PAGE_GUTTER, PageColumn, PageFrame, PageHeader, PageIntro,
    PageView, Section, SectionSidebar, body_text, heading, page_column, page_scroll, page_sections,
};
pub use preview::ThemePreview;
pub use rounded_clip::RoundedClip;
pub use theme::{
    Palette, ZOOM_RANGE, configure_theme, float_shadow, palette, scale, set_appearance, set_zoom,
    unit as scaled_px, units,
};
pub use tree::{ProjectGroup, SessionRow};
pub use workspace::WorkspaceShell;
