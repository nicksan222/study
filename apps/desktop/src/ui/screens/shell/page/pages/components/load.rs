//! What a page says around its content: that its first load is running, that it failed
//! with nothing to show and a way to try again, and the line under it saying what went
//! wrong last or that a save is running.

use crate::ui::screens::shell::page::*;
use study_ui::{ContentPage, PageView, button};

/// What loads a page again, such as `AppShell::load_study`.
pub(in crate::ui::screens::shell::page) type Reload = fn(&mut AppShell, &mut Context<AppShell>);

/// Where a page's first load stands, and what it says about it.
pub(in crate::ui::screens::shell::page) struct FirstLoad {
    /// Whether a load has ended, well or not.
    pub(in crate::ui::screens::shell::page) loaded: bool,
    /// Whether the last load failed and the page has nothing to show.
    pub(in crate::ui::screens::shell::page) failed: bool,
    /// What the page says while it loads.
    pub(in crate::ui::screens::shell::page) loading: Message,
    /// What the page says when the load failed.
    pub(in crate::ui::screens::shell::page) load_error: Message,
    /// What the button to try again runs.
    pub(in crate::ui::screens::shell::page) retry: Reload,
}

impl FirstLoad {
    /// Whether the page has content to draw; until then it shows [`Self::notice`].
    pub(in crate::ui::screens::shell::page) fn ready(&self) -> bool {
        self.loaded && !self.failed
    }

    /// `page` saying the load is running, or that it failed with a button to try again
    /// (`retry_id`).
    pub(in crate::ui::screens::shell::page) fn notice(
        self,
        page: ContentPage,
        retry_id: impl Into<gpui_kit::ElementId>,
        locale: Locale,
        cx: &mut Context<AppShell>,
    ) -> PageView {
        if !self.loaded {
            return page.status(text(locale, self.loading)).into();
        }
        let retry = self.retry;
        page.failure(text(locale, self.load_error))
            .item(
                button(retry_id, text(locale, Message::Retry), cx)
                    .on_click(cx.listener(move |this, _, _, cx| retry(this, cx))),
            )
            .into()
    }
}

/// `page` with the line saying what went wrong last, or else that a save is running when
/// `saving`.
pub(in crate::ui::screens::shell::page) fn status_line(
    page: ContentPage,
    error: Option<Message>,
    saving: bool,
    locale: Locale,
) -> ContentPage {
    match error {
        Some(error) => page.failure(text(locale, error)),
        None if saving => page.status(text(locale, Message::Saving)),
        None => page,
    }
}
