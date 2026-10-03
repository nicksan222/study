//! What this computer is, and which models it runs itself: a quiet section of lines. A
//! model that would run here but is not downloaded says so, as Settings does, with a way to
//! Settings › Transcription where it downloads.

use super::super::ids;
use super::note;
use crate::features::dashboard::Snapshot;
use crate::ui::screens::shell::page::*;
use gpui_kit::AnyElement;
use gpui_kit::SharedString;
use gpui_kit::component::ActiveTheme as _;
use gpui_kit::component::{Sizable as _, button::ButtonVariants as _};
use study_app::benchmark::{Placement, Reason};
use study_localization::{copies, joined, memory_size};
use study_ui::Section;
use study_ui::{button, units};

impl AppShell {
    /// What this computer is, and which models it runs itself.
    pub(in crate::ui::screens::shell::page::pages::home) fn computer_card(
        &self,
        snapshot: &Snapshot,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let colors = cx.theme().colors;
        let unit = units(cx);
        let see = button(ids::SEE_COMPUTER, text(locale, Message::SeeDetails), cx)
            .ghost()
            .small()
            .text_color(colors.muted_foreground)
            .on_click(cx.listener(|this, _, _, cx| {
                this.settings_section = SettingsSection::System;
                this.navigate(Page::Settings, cx);
            }))
            .into_any_element();
        let Some(report) = &snapshot.report else {
            return Section::new(text(locale, Message::System))
                .action(see)
                .child(note(text(locale, Message::SysNotMeasured), cx))
                .into_any_element();
        };
        let system = &report.system;
        let plan = report.plan();
        let machine = joined(&[
            system.cpu_brand.clone(),
            memory_size(system.total_memory_bytes),
        ]);
        let faint = study_ui::palette(cx).faint;
        // One line per model: what it does, then, faint, whether it runs here; a model not
        // yet downloaded says so instead, with a way to where it downloads.
        let line = |label: Message, state: String, link: Option<AnyElement>| {
            div()
                .w_full()
                .min_h(unit(32.))
                .flex()
                .flex_wrap()
                .items_center()
                .gap(unit(study_ui::scale::SPACE_XS))
                .child(
                    div()
                        .text_size(unit(study_ui::scale::TEXT_UI))
                        .child(text(locale, label)),
                )
                .child(
                    div()
                        .text_size(unit(study_ui::scale::TEXT_CAPTION))
                        .text_color(faint)
                        .child(SharedString::from(state)),
                )
                .children(link)
        };
        let transcription = match plan.transcription {
            Placement::Local if !snapshot.transcription_installed => line(
                Message::SysTranscription,
                text(locale, Message::LocalModelMissing).to_owned(),
                Some(
                    button(
                        ids::SET_UP_TRANSCRIPTION,
                        text(locale, Message::AiSetUp),
                        cx,
                    )
                    .ghost()
                    .small()
                    .text_color(colors.muted_foreground)
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.settings_section = SettingsSection::Transcription;
                        this.navigate(Page::Settings, cx);
                    }))
                    .into_any_element(),
                ),
            ),
            placement => {
                let state = match placement {
                    Placement::Local => Message::RunsHere,
                    Placement::NotHere(Reason::NotEnoughMemory | Reason::TooSlow) => {
                        Message::NotRecommendedHere
                    }
                };
                let mut words = vec![text(locale, state).to_owned()];
                words.extend(
                    plan.transcription_instances
                        .map(|instances| copies(locale, instances.as_usize())),
                );
                line(Message::SysTranscription, joined(&words), None)
            }
        };
        let content = div()
            .w_full()
            .flex()
            .flex_col()
            .child(
                div()
                    .text_size(unit(study_ui::scale::TEXT_SMALL))
                    .text_color(colors.muted_foreground)
                    .child(SharedString::from(machine)),
            )
            .child(transcription);
        Section::new(text(locale, Message::System))
            .action(see)
            .child(content)
            .into_any_element()
    }
}
