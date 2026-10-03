//! What a page hands the shell: a header for the title bar, a body for the inset surface
//! below it, and optionally the header of a panel the body draws at its trailing edge.

use gpui_kit::assets::IconName;
use gpui_kit::component::button::Button;
use gpui_kit::{AnyElement, App, IntoElement, SharedString};

use super::ContentPage;

/// Title, icon and trailing actions, shown in the title bar over the page. The title bar
/// holds nothing else (`DESIGN.md`, Layout): no sentence about the page, and its actions
/// drawn as the title bar's quiet icon buttons whatever look they came with.
pub struct PageHeader {
    pub(crate) title: SharedString,
    pub(crate) context: Option<SharedString>,
    pub(crate) icon: Option<IconName>,
    pub(crate) actions: Vec<Button>,
}

impl PageHeader {
    pub fn new(title: impl Into<SharedString>) -> Self {
        Self {
            title: title.into(),
            context: None,
            icon: None,
            actions: Vec::new(),
        }
    }

    pub fn icon(mut self, icon: IconName) -> Self {
        self.icon = Some(icon);
        self
    }

    /// What the page belongs to, beside the title in small faint ink: a session's
    /// project, or the file a thread is about. A name, never a sentence describing the
    /// page; the title bar carries no description of the page (`DESIGN.md`, Layout).
    pub fn context(mut self, text: impl Into<SharedString>) -> Self {
        self.context = Some(text.into());
        self
    }

    /// Adds a control at the trailing edge of the header, usually an
    /// [`icon_button`](crate::icon_button). It is drawn as the title bar's controls are:
    /// 28px, transparent, ink 2.
    pub fn action(mut self, action: Button) -> Self {
        self.actions.push(action);
        self
    }
}

enum Body {
    Element(AnyElement),
    Content(ContentPage),
}

/// The header of a panel the page draws flush with its body's trailing edge. The shell
/// shows it in the title bar right above the panel, past a dividing line.
pub(crate) struct Aside {
    pub(crate) header: PageHeader,
    /// The panel's width in design pixels, before zoom.
    pub(crate) width: f32,
}

/// A page's header (if any) and body, split so the shell can place each.
pub struct PageView {
    header: Option<PageHeader>,
    aside: Option<Aside>,
    body: Body,
}

impl PageView {
    /// A body that carries its own heading, or none.
    pub fn bare(body: impl IntoElement) -> Self {
        Self {
            header: None,
            aside: None,
            body: Body::Element(body.into_any_element()),
        }
    }

    pub fn with_header(header: PageHeader, body: impl IntoElement) -> Self {
        Self {
            header: Some(header),
            aside: None,
            body: Body::Element(body.into_any_element()),
        }
    }

    /// Declares the panel the body draws flush with its trailing edge, `width` design pixels
    /// wide, so the shell can title it in the title bar above it. Pad the panel's content
    /// by 16 design pixels to line up with that title, as the page's own content is padded
    /// by 28 to line up with the page's.
    pub fn aside(mut self, header: PageHeader, width: f32) -> Self {
        self.aside = Some(Aside { header, width });
        self
    }

    pub(crate) fn resolve(self, cx: &App) -> (Option<PageHeader>, Option<Aside>, AnyElement) {
        match self.body {
            Body::Element(body) => (self.header, self.aside, body),
            Body::Content(page) => {
                let (header, body) = page.split(cx);
                (Some(header), self.aside, body)
            }
        }
    }
}

impl From<ContentPage> for PageView {
    fn from(page: ContentPage) -> Self {
        Self {
            header: None,
            aside: None,
            body: Body::Content(page),
        }
    }
}

impl From<AnyElement> for PageView {
    fn from(body: AnyElement) -> Self {
        Self::bare(body)
    }
}
