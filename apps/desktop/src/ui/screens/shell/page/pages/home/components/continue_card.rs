//! The sessions to get back to, as a section of rows.

use super::super::ids;
use super::{glyph, note, row_button};
use crate::features::clock::now;
use crate::features::dashboard::Snapshot;
use crate::ui::screens::shell::page::*;
use gpui_kit::AnyElement;
use gpui_kit::SharedString;
use study_localization::age;
use study_ui::Section;
use study_ui::units;

impl AppShell {
    /// The most recently active sessions: a row each, with its project and how long ago.
    pub(in crate::ui::screens::shell::page::pages::home) fn continue_card(
        &self,
        snapshot: &Snapshot,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let faint = study_ui::palette(cx).faint;
        let unit = units(cx);
        let mut rows = div().w_full().flex().flex_col();
        if snapshot.recent_sessions.is_empty() {
            let message = if snapshot.projects.is_empty() {
                Message::NoProjectsYet
            } else {
                Message::DashboardNoSessions
            };
            rows = rows.child(note(text(locale, message), cx));
        }
        let now = now();
        for entry in &snapshot.recent_sessions {
            let id = entry.session.id;
            rows = rows.child(
                row_button(
                    (ids::SESSION_ROW, id.get() as u64),
                    entry.session.title.clone(),
                    cx,
                )
                .child(
                    div()
                        .w_full()
                        .h(unit(32.))
                        .px(unit(study_ui::scale::SPACE_XS))
                        .flex()
                        .items_center()
                        .gap(unit(study_ui::scale::SPACE_XS))
                        .child(glyph(IconName::NotebookText, cx))
                        .child(
                            div()
                                .min_w_0()
                                .flex_1()
                                .flex()
                                .items_baseline()
                                .gap(unit(study_ui::scale::SPACE_XS))
                                .child(
                                    div()
                                        .min_w_0()
                                        .overflow_hidden()
                                        .text_ellipsis()
                                        .whitespace_nowrap()
                                        .text_size(unit(study_ui::scale::TEXT_UI))
                                        .child(entry.session.title.clone()),
                                )
                                .child(
                                    div()
                                        .min_w_0()
                                        .flex_1()
                                        .overflow_hidden()
                                        .text_ellipsis()
                                        .whitespace_nowrap()
                                        .text_size(unit(study_ui::scale::TEXT_CAPTION))
                                        .text_color(faint)
                                        .child(entry.project_name.clone()),
                                ),
                        )
                        .child(
                            div()
                                .flex_none()
                                .text_size(unit(study_ui::scale::TEXT_CAPTION))
                                .text_color(faint)
                                .child(SharedString::from(age(
                                    locale,
                                    now - entry.session.updated_at,
                                ))),
                        ),
                )
                .on_click(cx.listener(move |this, _, window, cx| {
                    this.navigate(Page::Projects, cx);
                    this.show_project_session();
                    this.open_session(id, window, cx);
                })),
            );
        }
        Section::new(text(locale, Message::ContinueTitle))
            .child(rows)
            .flex_1()
            .min_w(unit(360.))
            .into_any_element()
    }
}
