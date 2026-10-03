//! A piece's status under its header: that it is up to date, or outdated with what changed
//! and Update, or how its update is going (the current text stays on screen meanwhile).

use super::super::ids;
use super::super::page::{MaterialStatus, Piece};
use crate::ui::screens::shell::page::pages::components::job_problem_parts;
use crate::ui::screens::shell::page::*;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::{ActiveTheme as _, Disableable as _};
use gpui_kit::{
    AnyElement, InteractiveElement as _, SharedString, StatefulInteractiveElement as _,
};
use study_app::views::JobStatus;
use study_ui::{button, units};

impl AppShell {
    /// What goes between the header and the text of `piece`: `None` for a set of mistakes
    /// and while the first text is being written (the page shows its own progress). One line
    /// holds the status and, when the project moved on, Update; below it come why an update
    /// failed or waits.
    pub(in crate::ui::screens::shell::page::pages::study) fn status_strip(
        &self,
        piece: &Piece,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        if piece.is_mistakes() || piece.current.is_none() {
            return None;
        }
        let unit = units(cx);
        let colors = cx.theme().colors;
        let status = piece.status();
        let tint = if status.failed() {
            colors.danger
        } else {
            colors.muted_foreground
        };
        let running = piece
            .update
            .as_ref()
            .and_then(|update| update.job.as_ref())
            .filter(|job| job.status == JobStatus::Running);
        let mut line = div()
            .w_full()
            .flex()
            .flex_wrap()
            .items_center()
            .gap(unit(study_ui::scale::SPACE_SM))
            .child(
                div()
                    .id(ids::STATUS)
                    .test_support()
                    .aria_label(SharedString::from(status.label(locale)))
                    .flex()
                    .items_center()
                    .gap(unit(study_ui::scale::SPACE_XS))
                    .text_size(unit(study_ui::scale::TEXT_SMALL))
                    .text_color(tint)
                    .children(running.map(|job| {
                        crate::ui::screens::shell::page::pages::components::status_icon(
                            job.status,
                            IconName::LoaderCircle,
                            tint,
                            unit(14.),
                        )
                    }))
                    .child(SharedString::from(status.label(locale))),
            );
        if matches!(status, MaterialStatus::Outdated(_))
            && self.study.offers(piece.head().project_id)
        {
            line = line.child(self.update_button(piece, locale, cx));
        }
        let mut strip = div()
            .w_full()
            .flex()
            .flex_col()
            .gap(unit(study_ui::scale::SPACE_XS))
            .child(line);
        if piece.updating() {
            strip = strip.children(self.update_problem(piece, locale, cx));
        }
        Some(strip.into_any_element())
    }

    /// Update, which rewrites the piece from the whole project as it is now; it waits while
    /// workers start.
    fn update_button(&self, piece: &Piece, locale: Locale, cx: &mut Context<Self>) -> AnyElement {
        let head = piece.head();
        let (project, kind) = (head.project_id, head.kind);
        button(ids::UPDATE, text(locale, Message::UpdateMaterial), cx)
            .icon(IconName::RotateCw)
            .disabled(self.study.making || self.workers.starting())
            .on_click(cx.listener(move |this, _, _, cx| this.update_material(project, kind, cx)))
            .into_any_element()
    }

    /// What the update waits for or why it stopped: its setup, a retry, and the settings it
    /// needs.
    fn update_problem(
        &self,
        piece: &Piece,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> Vec<AnyElement> {
        let Some(update) = piece.update.as_ref() else {
            return Vec::new();
        };
        let Some(job) = update
            .job
            .as_ref()
            .filter(|job| job.status.is_stopped() || job.status == JobStatus::Waiting)
        else {
            return Vec::new();
        };
        let key = update.id.get() as u64;
        job_problem_parts(
            ((ids::MATERIAL_RETRY, key), (ids::MATERIAL_SETTINGS, key)),
            job,
            self.chatgpt_state(),
            None,
            AppShell::retry_material,
            locale,
            cx,
        )
        .into_iter()
        .collect()
    }
}
