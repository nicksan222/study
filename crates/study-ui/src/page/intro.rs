//! [`PageIntro`]: the block that opens a page's body, the one shape every page's own header
//! takes, so titles, descriptions and the lines about them are the same size and the same
//! distance apart everywhere.

use gpui_kit::{
    AnyElement, App, Div, FontWeight, IntoElement, ParentElement as _, RenderOnce, SharedString,
    StyleRefinement, Styled, Window, div, prelude::FluentBuilder as _,
};

use crate::scale;

/// How loud a [`PageIntro`]'s title is. The title bar already names the page, so most
/// pages have no title in the body at all.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum IntroVariant {
    /// No title: the page's description alone, in UI `ink-2`.
    Lead,
    /// The title of what the page shows, such as notes or a quiz: title type (17/24),
    /// its lines 4px apart, the description in UI `ink-2`.
    Title,
    /// The one headline on a screen that starts something, such as a new session or a
    /// step of the tour: display type (26/32), its lines 8px apart, the description in
    /// body `ink-2`.
    Headline,
}

impl IntroVariant {
    /// The title's size and line height, in design pixels.
    fn title(self) -> (f32, f32) {
        match self {
            Self::Lead | Self::Title => (scale::TEXT_TITLE, 24.),
            Self::Headline => (scale::TEXT_DISPLAY, 32.),
        }
    }

    /// The description's size and line height, in design pixels.
    fn description(self) -> (f32, f32) {
        match self {
            Self::Lead | Self::Title => (scale::TEXT_UI, 20.),
            Self::Headline => (scale::TEXT_BODY, 24.),
        }
    }

    /// The space between the intro's lines, in design pixels.
    fn gap(self) -> f32 {
        match self {
            Self::Lead | Self::Title => scale::SPACE_XXS,
            Self::Headline => scale::SPACE_XS,
        }
    }
}

/// What opens a page's body, in order: what it belongs to (a control such as a project
/// picker), its title, its description, lines of facts about it, then its actions. Every
/// part but the variant is optional. It sets no space around itself; [`ContentPage`]
/// leaves [`scale::SPACE_LG`] under it, and a page that places one itself does the same.
///
/// [`ContentPage`]: super::ContentPage
#[derive(IntoElement)]
pub struct PageIntro {
    base: Div,
    variant: IntroVariant,
    context: Option<AnyElement>,
    title: Option<SharedString>,
    description: Option<SharedString>,
    meta: Vec<AnyElement>,
    actions: Vec<AnyElement>,
    centered: bool,
}

impl PageIntro {
    fn new(variant: IntroVariant, title: Option<SharedString>) -> Self {
        Self {
            base: div().w_full(),
            variant,
            context: None,
            title,
            description: None,
            meta: Vec::new(),
            actions: Vec::new(),
            centered: false,
        }
    }

    /// A page's description on its own, as its first line.
    pub fn lead(description: impl Into<SharedString>) -> Self {
        Self::new(IntroVariant::Lead, None).description(description)
    }

    /// What the page shows, titled in title type.
    pub fn title(title: impl Into<SharedString>) -> Self {
        Self::new(IntroVariant::Title, Some(title.into()))
    }

    /// The screen's one headline, in display type.
    pub fn headline(title: impl Into<SharedString>) -> Self {
        Self::new(IntroVariant::Headline, Some(title.into()))
    }

    /// What the page belongs to, above the title: a control, never a label of the page's
    /// kind (`DESIGN.md`: no kickers). A quiet button here lines its text up with the title
    /// by pulling itself left by its own padding.
    pub fn context(mut self, context: impl IntoElement) -> Self {
        self.context = Some(context.into_any_element());
        self
    }

    /// What the page is for or what it says, under the title, in `ink-2`.
    pub fn description(mut self, description: impl Into<SharedString>) -> Self {
        self.description = Some(description.into());
        self
    }

    /// A line of facts about what the page shows (its project, its age, its counts), in
    /// caption `ink-3`, under the description. Each call adds a line.
    pub fn meta(mut self, line: impl IntoElement) -> Self {
        self.meta.push(line.into_any_element());
        self
    }

    /// A control under the rest, such as "Replay the tour"; actions sit in one wrapping row,
    /// 16px under the last line.
    pub fn action(mut self, action: impl IntoElement) -> Self {
        self.actions.push(action.into_any_element());
        self
    }

    /// Centres every line, for a screen with nothing beside its intro (the tour).
    pub fn centered(mut self) -> Self {
        self.centered = true;
        self
    }
}

impl Styled for PageIntro {
    fn style(&mut self) -> &mut StyleRefinement {
        self.base.style()
    }
}

impl RenderOnce for PageIntro {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let unit = crate::theme::units(cx);
        let palette = crate::theme::palette(cx);
        let variant = self.variant;
        let line = |div: Div| {
            div.min_w_0()
                .whitespace_normal()
                .when(self.centered, |div| div.text_center())
        };
        let title = self.title.map(|title| {
            let (size, height) = variant.title();
            line(div())
                .text_size(unit(size))
                .line_height(unit(height))
                .font_weight(FontWeight::SEMIBOLD)
                .child(title)
        });
        let description = self.description.map(|description| {
            let (size, height) = variant.description();
            line(div())
                .text_size(unit(size))
                .line_height(unit(height))
                .text_color(palette.muted)
                .child(description)
        });
        let meta = self.meta.into_iter().map(|meta| {
            line(div())
                .text_size(unit(scale::TEXT_CAPTION))
                .line_height(unit(16.))
                .text_color(palette.faint)
                .child(meta)
        });
        let actions = (!self.actions.is_empty()).then(|| {
            div()
                .mt(unit(scale::SPACE_MD - variant.gap()))
                .flex()
                .flex_wrap()
                .items_center()
                .gap(unit(scale::SPACE_XS))
                .children(self.actions)
        });
        self.base
            .min_w_0()
            .flex()
            .flex_col()
            .map(|base| {
                if self.centered {
                    base.items_center()
                } else {
                    base.items_start()
                }
            })
            .gap(unit(variant.gap()))
            .children(self.context)
            .children(title)
            .children(description)
            .children(meta)
            .children(actions)
    }
}
