//! The headline numbers as one quiet caption line, each figure opening where it is counted.

use super::super::ids;
use crate::features::dashboard::Snapshot;
use crate::ui::screens::shell::page::*;
use gpui_kit::AnyElement;
use gpui_kit::SharedString;
use gpui_kit::component::{
    ActiveTheme as _,
    button::{Button, ButtonCustomVariant, ButtonVariants as _},
};
use study_app::views::JobStatus;
use study_localization::{
    file_count, media_size, project_count, results_ready, separator, session_count, with_size,
};
use study_ui::units;

/// One headline number, in words with its count, and the page it opens.
struct Stat {
    words: String,
    page: Page,
}

impl AppShell {
    /// The workspace in numbers, as one line: projects, sessions, files (with their size)
    /// and results ready, separated by dots.
    pub(in crate::ui::screens::shell::page::pages::home) fn stats(
        &self,
        snapshot: &Snapshot,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let colors = cx.theme().colors;
        let faint = study_ui::palette(cx).faint;
        let unit = units(cx);
        let stats = [
            Stat {
                words: project_count(locale, snapshot.projects.len()),
                page: Page::Projects,
            },
            Stat {
                words: session_count(locale, snapshot.session_count),
                page: Page::Projects,
            },
            Stat {
                words: with_size(
                    file_count(locale, snapshot.file_count),
                    &media_size(locale, snapshot.file_bytes),
                ),
                page: Page::MediaList,
            },
            Stat {
                words: results_ready(locale, snapshot.count(JobStatus::Succeeded)),
                page: Page::Pipelines,
            },
        ];
        let mut line = div()
            .w_full()
            .flex()
            .flex_wrap()
            .items_center()
            .gap(unit(study_ui::scale::SPACE_XXS))
            .text_size(unit(study_ui::scale::TEXT_CAPTION))
            .text_color(faint);
        for (index, stat) in stats.into_iter().enumerate() {
            if index > 0 {
                line = line.child(div().child(separator()));
            }
            let page = stat.page;
            line = line.child(
                Button::new(ids::STAT + index)
                    .accessibility_label(stat.words.clone())
                    .tab_stop(true)
                    .h(unit(24.))
                    .px(unit(study_ui::scale::SPACE_XXS))
                    .rounded(unit(study_ui::scale::RADIUS_SM))
                    .custom(
                        ButtonCustomVariant::new(cx)
                            .color(colors.background.opacity(0.))
                            .foreground(faint)
                            .hover(colors.secondary_hover)
                            .active(colors.secondary_active),
                    )
                    .child(
                        div()
                            .text_size(unit(study_ui::scale::TEXT_CAPTION))
                            .child(SharedString::from(stat.words)),
                    )
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.navigate(page, cx);
                    })),
            );
        }
        line.into_any_element()
    }
}
