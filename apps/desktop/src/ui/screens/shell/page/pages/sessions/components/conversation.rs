//! An open session: the transcript, the composer under it, and the side panel beside them:
//! an attached file's details, or its thread.

use super::super::ids;
use super::super::page::SidePanel;
use super::{Detail, META_GUTTER, Panel, detail_panel, message_row};
use crate::ui::screens::shell::page::*;
use gpui_kit::component::{ActiveTheme as _, Sizable as _};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::{AnyElement, StatefulInteractiveElement as _};
use study_app::views::PartContent;
use study_core::{SessionId, SourceId};

/// How far from the latest notes, in units, the way back to them shows.
const JUMP_DISTANCE: f32 = 320.;

/// How long after the last note, in seconds, a note starts a new moment, set further apart.
const NEW_MOMENT_SECONDS: i64 = 15 * 60;

/// The notebook's column, shared by the transcript and the composer so they line up: the
/// reading width in the page frame every page shares, with the margin to
/// its right where an entry's time and actions appear ([`META_GUTTER`]). The transcript's
/// rows reach into that margin; the composer and the day labels stop short of it.
pub(super) fn notebook_column(cx: &gpui_kit::App) -> study_ui::PageColumn {
    let unit = study_ui::units(cx);
    study_ui::page_column(study_ui::Column::Read)
        .width(study_ui::Column::Read.width() + META_GUTTER + study_ui::scale::SPACE_LG)
        .gutter(cx)
        .pr(unit(study_ui::scale::SPACE_LG))
}

impl AppShell {
    /// The open session, and the header and width of the side panel beside it, if one shows.
    pub(in crate::ui::screens::shell::page::pages::sessions) fn conversation_body(
        &mut self,
        session_id: SessionId,
        locale: Locale,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> (AnyElement, Option<(study_ui::PageHeader, f32)>) {
        let unit = study_ui::units(cx);
        let colors = cx.theme().colors;
        let state = &self.sessions;
        let mut transcript = notebook_column(cx)
            .py(unit(study_ui::scale::SPACE_LG))
            .flex()
            .flex_col()
            .gap(unit(study_ui::scale::SPACE_SM));
        if state.messages_loading && state.messages_for != Some(session_id) {
            transcript = transcript.child(
                div()
                    .pr(unit(META_GUTTER))
                    .text_color(colors.muted_foreground)
                    .child(text(locale, Message::LoadingMessages)),
            );
        } else if state.messages.is_empty() {
            transcript = transcript.child(
                div()
                    .pr(unit(META_GUTTER))
                    .py(unit(study_ui::scale::SPACE_XXL))
                    .text_center()
                    .text_color(colors.muted_foreground)
                    .child(text(locale, Message::SessionEmptyHint)),
            );
        }
        let open_thread = state.open_thread();
        let mut shown_day = None;
        let mut last_written = None;
        for message in &state.messages {
            // A label where a new day starts, so a long session reads by when it was written.
            let day = crate::features::clock::local_day(message.created_at);
            let new_day = shown_day != Some(day);
            if new_day {
                let first = shown_day.is_none();
                shown_day = Some(day);
                transcript = transcript.child(day_label(
                    crate::features::clock::day(locale, message.created_at),
                    first,
                    cx,
                ));
            }
            let row = message_row(
                message,
                locale,
                &state.expanded,
                &state.shown,
                open_thread,
                state.row_marks(self.chatgpt_state(), window, cx),
                cx,
            );
            // Notes written together sit close; a new moment starts further down.
            let new_moment = !new_day
                && last_written.is_some_and(|last| message.created_at - last > NEW_MOMENT_SECONDS);
            last_written = Some(message.created_at);
            transcript = transcript.child(
                div()
                    .w_full()
                    .when(new_moment, |this| {
                        this.pt(unit(study_ui::scale::SPACE_XL - study_ui::scale::SPACE_SM))
                    })
                    .child(row),
            );
        }
        let footer = self.notebook_footer(locale, None, cx);
        let column = div()
            .flex_1()
            .min_h_0()
            .min_w_0()
            .h_full()
            .flex()
            .flex_col()
            .child(
                div()
                    .relative()
                    .flex_1()
                    .min_h_0()
                    .flex()
                    .flex_col()
                    .child(
                        div()
                            .id(ids::TRANSCRIPT_SCROLL)
                            .flex_1()
                            .min_h_0()
                            .overflow_y_scroll()
                            .track_scroll(&state.scroll)
                            // So the way back to the latest shows as soon as it is far.
                            .on_scroll_wheel(cx.listener(|_, _, _, cx| cx.notify()))
                            .child(transcript),
                    )
                    .children(self.jump_to_latest(locale, cx)),
            )
            .child(footer);
        let (panel, header) = match self.side_panel(locale, window, cx) {
            Some(panel) => (Some(panel.body), Some((panel.header, panel.width))),
            None => (None, None),
        };
        let body = div()
            .flex_1()
            .min_h_0()
            .w_full()
            .flex()
            .child(column)
            .children(panel)
            .into_any_element();
        (body, header)
    }

    /// The composer docked under the notebook, with the error line over it: the same place
    /// in a new session and an open one, so the first note sends from where the next ones
    /// will. `trailing` sits at the composer's end, such as a new session's project.
    pub(super) fn notebook_footer(
        &self,
        locale: Locale,
        trailing: Option<AnyElement>,
        cx: &mut Context<Self>,
    ) -> study_ui::PageColumn {
        let unit = study_ui::units(cx);
        notebook_column(cx)
            // The composer stops short of the margin, at the notes' width.
            .pr(unit(study_ui::scale::SPACE_LG + META_GUTTER))
            .pb(unit(study_ui::scale::SPACE_LG))
            .pt(unit(study_ui::scale::SPACE_XXS))
            .flex()
            .flex_col()
            .gap(unit(study_ui::scale::SPACE_XS))
            .children(self.error_line(locale, cx))
            .child(self.composer(locale, trailing, cx))
    }

    /// A button over the transcript's end, back to the latest notes, while the student has
    /// scrolled well away from them.
    fn jump_to_latest(&self, locale: Locale, cx: &mut Context<Self>) -> Option<AnyElement> {
        let unit = study_ui::units(cx);
        let scroll = &self.sessions.scroll;
        // The offset runs from 0 at the top down to minus the most it can scroll.
        let from_end = scroll.max_offset().y + scroll.offset().y;
        if from_end <= unit(JUMP_DISTANCE) {
            return None;
        }
        Some(
            div()
                .absolute()
                .bottom(unit(12.))
                .w_full()
                .flex()
                .justify_center()
                .child(
                    // It floats over the notes, so it takes the raised surface, its hairline
                    // and the floating shadow (`DESIGN.md`, Elevation & Depth).
                    div()
                        .rounded(unit(study_ui::scale::RADIUS_FULL))
                        .bg(study_ui::palette(cx).raised)
                        .border_1()
                        .border_color(study_ui::palette(cx).border)
                        .shadow(study_ui::float_shadow(cx))
                        .child(
                            study_ui::button(
                                ids::JUMP_TO_LATEST,
                                text(locale, Message::JumpToLatest),
                                cx,
                            )
                            .ghost()
                            .small()
                            .rounded(unit(study_ui::scale::RADIUS_FULL))
                            .icon(IconName::ArrowDown)
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.sessions.scroll.scroll_to_bottom();
                                cx.notify();
                            })),
                        ),
                )
                .into_any_element(),
        )
    }

    /// The panel beside the conversation: a file's details or a thread.
    fn side_panel(
        &mut self,
        locale: Locale,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<Panel> {
        match self.sessions.panel? {
            SidePanel::File(source_id) => self.file_panel(source_id, locale, cx),
            SidePanel::Thread(root) => Some(self.thread_panel(root, locale, window, cx)),
        }
    }

    /// The side panel for a file, if the open conversation or thread still has it.
    fn file_panel(
        &self,
        source_id: SourceId,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> Option<Panel> {
        let state = &self.sessions;
        let mut shown = None;
        let mut jobs = Vec::new();
        let mut document = None;
        for part in state.shown_parts() {
            if let PartContent {
                source_id: Some(id),
                name,
                kind,
            } = &part.content
                && *id == source_id
            {
                shown.get_or_insert((name.as_str(), *kind));
                jobs.extend(part.jobs.iter());
                document = document.or(part.document.as_ref());
            }
        }
        let (name, kind) = shown?;
        Some(detail_panel(
            Detail {
                source_id,
                name,
                kind,
                info: state.shown.get(&source_id),
                jobs,
                document,
                correction: &state.correction,
                cited: state
                    .cited
                    .as_ref()
                    .filter(|(cited, _)| *cited == source_id)
                    .map(|(_, at)| at),
                cited_earlier: state.cited_earlier,
                now: crate::features::clock::now(),
            },
            locale,
            cx,
        ))
    }
}

/// The name of a day over its notes: a faint caption at the notes' left edge, with no rules
/// either side; after the first, set 32 down from the notes before it.
fn day_label(day: String, first: bool, cx: &Context<AppShell>) -> AnyElement {
    let unit = study_ui::units(cx);
    div()
        .w_full()
        .pr(unit(META_GUTTER))
        // The transcript already spaces its rows by the small step.
        .when(!first, |this| {
            this.pt(unit(study_ui::scale::SPACE_XL - study_ui::scale::SPACE_SM))
        })
        .text_size(unit(study_ui::scale::TEXT_CAPTION))
        .text_color(study_ui::palette(cx).faint)
        .child(day)
        .into_any_element()
}
