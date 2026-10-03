//! Page-level layout. Where to look:
//!
//! | Module | Holds |
//! |---|---|
//! | `layout` | [`page_scroll`], [`page_column`], [`page_sections`], [`heading`], [`body_text`], [`Section`]: where every page's content sits and how it is grouped |
//! | `empty` | [`EmptyState`]: the centred notice in place of content a page doesn't have yet |
//! | `frame` | [`PageFrame`]: the surface every page sits in |
//! | `view` | [`PageView`] and [`PageHeader`]: what a page hands the shell |
//! | `header` | (crate) a [`PageHeader`] drawn into the title bar, for the shell and [`ContentPage`] |
//! | `intro` | [`PageIntro`]: the block that opens a page's body, the one shape of a page's own header |
//! | `content` | [`ContentPage`]: the stock titled page of caller-owned items |
//! | `sidebar` | [`SectionSidebar`]: the section's secondary navigation |

/// The inset, in design pixels, from a side panel's leading edge to its content and title.
pub(crate) const ASIDE_GUTTER: f32 = 16.;

mod content;
mod empty;
mod frame;
mod header;
mod intro;
mod layout;
mod sidebar;
mod view;

pub use content::ContentPage;
pub use empty::EmptyState;
pub use frame::PageFrame;
pub(crate) use header::{HeaderScale, header_contents, header_row};
pub use intro::PageIntro;
pub use layout::{
    Column, PAGE_GUTTER, PageColumn, Section, body_text, heading, page_column, page_scroll,
    page_sections,
};
pub use sidebar::SectionSidebar;
pub use view::{PageHeader, PageView};
