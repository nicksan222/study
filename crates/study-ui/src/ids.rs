//! Every element id this crate chooses for its own state (scroll positions, split sizes,
//! motion), in one place so collisions are easy to spot.
//!
//! GPUI resolves an id within the ids of its ancestors, so two ids clash only when they share
//! a parent path. Callers' ids are their own business; these stay clear of each other and of
//! the small ids screens use. The reserved numbers:
//!
//! | Range | Owner |
//! |---|---|
//! | `1001`–`1003` | scroll state ([`CONTENT_BODY_SCROLL`], [`SIDEBAR_ITEMS_SCROLL`], [`NAVIGATION_RAIL_SCROLL`]) |
//! | `1004` | a [`ContentPage`](crate::ContentPage)'s failure message ([`CONTENT_FAILURE`]) |
//! | `1020`, `1022`–`1023` | the shell ([`SHELL_DEFAULT_PAGE_KEY`], [`SHELL_GEOMETRY`], [`SHELL_ASIDE_MOTION`]) |
//! | `1030` | a project row's tools ([`PROJECT_TOOLS_FOCUS`]) |
//! | `1040`–`1041` | the onboarding stage ([`ONBOARDING_STAGE_SCROLL`], [`ONBOARDING_PROGRESS`]) |
//! | `1050`–`1055` | a [`DiagramCanvas`](crate::DiagramCanvas) and its toolbar ([`DIAGRAM_CANVAS`], …) |
//! | [`SHELL_SPLIT`] | the shell's split, one id per display scale ([`shell_split`]) |
//! | `100_000_000`… | [`project_group_motion`], four per group |
//! | `("onboarding", n)` | [`onboarding_motion`] |
//! | `("composer-border", entity)` | [`composer_border`] |
//! | `("composer-editor", entity)` | [`composer_editor`], unless the caller names it |
//! | `(page key, "shell-sidebar")` | [`shell_sidebar`] |
//! | `("sidebar-row", n)` | [`sidebar_row_motion`] |
//!
//! To add one: a fixed id gets a constant in a free slot of the `1000`s block and a line in
//! the `fixed_ids_are_distinct` test below; an id derived from a caller's value gets a
//! function here, so the arithmetic lives in one place.

use std::ops::RangeInclusive;

use gpui_kit::{ElementId, EntityId, Pixels, px};

/// Scroll state of a [`ContentPage`](crate::ContentPage) body.
pub(crate) const CONTENT_BODY_SCROLL: usize = 1001;

/// Scroll state of a [`SectionSidebar`](crate::SectionSidebar)'s item list.
pub(crate) const SIDEBAR_ITEMS_SCROLL: usize = 1002;

/// Scroll state of the [`NavigationRail`](crate::NavigationRail), for a window too short
/// to show every destination.
pub(crate) const NAVIGATION_RAIL_SCROLL: usize = 1003;

/// A [`ContentPage`](crate::ContentPage)'s failure message, which tests find.
pub(crate) const CONTENT_FAILURE: usize = 1004;

/// The page's entrance motion when the caller gives [`WorkspaceShell`](crate::WorkspaceShell)
/// no `page_key`.
pub(crate) const SHELL_DEFAULT_PAGE_KEY: usize = 1020;

/// Where the shell last laid out its title bar and page, which lines the two up.
pub(crate) const SHELL_GEOMETRY: usize = 1022;

/// The dividing line in the title bar sliding in with a page's side panel.
pub(crate) const SHELL_ASIDE_MOTION: usize = 1023;

/// The focus a project row in the [`ProjectGroup`](crate::ProjectGroup) tree keeps for its
/// tools, under the row's own id.
pub(crate) const PROJECT_TOOLS_FOCUS: usize = 1030;

/// Scroll state of the [`OnboardingFrame`](crate::OnboardingFrame) stage.
pub(crate) const ONBOARDING_STAGE_SCROLL: usize = 1040;

/// The [`OnboardingFrame`](crate::OnboardingFrame) progress bar, which accessibility reads.
pub(crate) const ONBOARDING_PROGRESS: usize = 1041;

/// A [`DiagramCanvas`](crate::DiagramCanvas), and the buttons of its toolbar.
pub(crate) const DIAGRAM_CANVAS: usize = 1050;
pub(crate) const DIAGRAM_ZOOM_OUT: usize = 1051;
pub(crate) const DIAGRAM_ACTUAL_SIZE: usize = 1052;
pub(crate) const DIAGRAM_ZOOM_IN: usize = 1053;
pub(crate) const DIAGRAM_FIT: usize = 1054;
/// The drawing inside a [`DiagramCanvas`](crate::DiagramCanvas), which keeps its layout.
pub(crate) const DIAGRAM_DRAWING: usize = 1055;

/// Base of the shell's split ids; [`shell_split`] adds the font size in hundredths of a pixel.
const SHELL_SPLIT_BASE: usize = 1000;

/// Every id [`shell_split`] can return: the theme font size runs from
/// `BASE_FONT_SIZE × ZOOM_RANGE.0` to `BASE_FONT_SIZE × ZOOM_RANGE.1` (see `theme.rs`).
pub(crate) const SHELL_SPLIT: RangeInclusive<usize> =
    SHELL_SPLIT_BASE + 1125..=SHELL_SPLIT_BASE + 3000;

/// The shell's sidebar/page split at the theme font size `font_size`. Each display scale gets
/// its own id, so returning to a scale restores the width the user chose there.
pub(crate) fn shell_split(font_size: Pixels) -> usize {
    let id = SHELL_SPLIT_BASE + (font_size / px(0.01)).round() as usize;
    debug_assert!(SHELL_SPLIT.contains(&id), "zoom outside the theme's range");
    id
}

/// Base of [`project_group_motion`].
const PROJECT_GROUP_MOTION_BASE: usize = 100_000_000;

/// The animated parts of a [`ProjectGroup`](crate::ProjectGroup).
#[derive(Clone, Copy)]
pub(crate) enum ProjectGroupPart {
    /// The folder and chevron glyphs; each fold state has its own id so a change replays.
    Glyphs { expanded: bool },
    /// The unfolding list of sessions.
    Rows,
}

/// The motion id of one part of the [`ProjectGroup`](crate::ProjectGroup) with id `group`.
/// Each group owns four ids from `PROJECT_GROUP_MOTION_BASE + group * 4`.
pub(crate) fn project_group_motion(group: usize, part: ProjectGroupPart) -> usize {
    let offset = match part {
        ProjectGroupPart::Glyphs { expanded } => usize::from(expanded),
        ProjectGroupPart::Rows => 2,
    };
    PROJECT_GROUP_MOTION_BASE + group * 4 + offset
}

/// The entrance motion of part `part` (below 8) of onboarding step `step`. Each step gets
/// fresh ids, so every step arrives the same way.
pub(crate) fn onboarding_motion(step: usize, part: usize) -> ElementId {
    debug_assert!(part < 8, "onboarding motion has eight parts per step");
    ElementId::from(("onboarding", step * 8 + part))
}

/// The focus transition of a [`Composer`](crate::Composer)'s border, keyed on its input so
/// each composer fades on its own.
pub(crate) fn composer_border(input: EntityId) -> ElementId {
    ElementId::from(("composer-border", input))
}

/// A [`Composer`](crate::Composer)'s editor, when its caller gives it no name.
pub(crate) fn composer_editor(input: EntityId) -> ElementId {
    ElementId::from(("composer-editor", input))
}

/// The entrance of the `index`th row of a [`SectionSidebar`](crate::SectionSidebar).
pub(crate) fn sidebar_row_motion(index: usize) -> ElementId {
    ElementId::from(("sidebar-row", index))
}

/// The name under the page's key that holds the shell's sidebar.
const SHELL_SIDEBAR: &str = "shell-sidebar";

/// The sidebar's entrance inside the shell, keyed on the page as the page's own entrance is,
/// so each page's sidebar keeps its own state (its list's scroll) instead of inheriting the
/// last page's, while staying clear of the page's id.
pub(crate) fn shell_sidebar(page_key: &ElementId) -> ElementId {
    ElementId::NamedChild(page_key.clone().into(), SHELL_SIDEBAR.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::theme::{BASE_FONT_SIZE, ZOOM_RANGE};

    #[test]
    fn fixed_ids_are_distinct() {
        let fixed = [
            CONTENT_BODY_SCROLL,
            SIDEBAR_ITEMS_SCROLL,
            NAVIGATION_RAIL_SCROLL,
            CONTENT_FAILURE,
            SHELL_DEFAULT_PAGE_KEY,
            SHELL_GEOMETRY,
            SHELL_ASIDE_MOTION,
            PROJECT_TOOLS_FOCUS,
            ONBOARDING_STAGE_SCROLL,
            ONBOARDING_PROGRESS,
            DIAGRAM_CANVAS,
            DIAGRAM_ZOOM_OUT,
            DIAGRAM_ACTUAL_SIZE,
            DIAGRAM_ZOOM_IN,
            DIAGRAM_FIT,
            DIAGRAM_DRAWING,
        ];
        for (index, id) in fixed.iter().enumerate() {
            assert!(!fixed[index + 1..].contains(id), "{id} is reserved twice");
            assert!(!SHELL_SPLIT.contains(id), "{id} overlaps the shell split");
            assert!(*id < PROJECT_GROUP_MOTION_BASE);
        }
        assert!(*SHELL_SPLIT.end() < PROJECT_GROUP_MOTION_BASE);
    }

    #[test]
    fn shell_split_stays_in_its_range() {
        let (min, max) = ZOOM_RANGE;
        for zoom in [min, 1., max] {
            assert!(SHELL_SPLIT.contains(&shell_split(px(BASE_FONT_SIZE * zoom))));
        }
    }

    #[test]
    fn project_group_parts_do_not_overlap_neighbours() {
        let parts = [
            ProjectGroupPart::Glyphs { expanded: false },
            ProjectGroupPart::Glyphs { expanded: true },
            ProjectGroupPart::Rows,
        ];
        let first: Vec<_> = parts.map(|part| project_group_motion(0, part)).to_vec();
        let next: Vec<_> = parts.map(|part| project_group_motion(1, part)).to_vec();
        assert!(first.iter().all(|id| !next.contains(id)));
    }
}
