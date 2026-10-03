//! Help: how Study works, read as one calm page in the notebook's column, titled Help in the
//! title bar: a heading, then a way back into the welcome tour, then each part of Study as a
//! titled paragraph (the last one the keys that go faster).

use super::ids;
use crate::ui::screens::shell::page::*;
use gpui_kit::component::ActiveTheme as _;
use study_ui::{Column, PageHeader, PageIntro, PageView, button, palette, scale, units};

impl AppShell {
    /// Help, with a way back into the welcome tour.
    pub(in crate::ui::screens::shell::page) fn help_page(
        &self,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> PageView {
        let unit = units(cx);
        let colors = palette(cx);
        // The way back into the tour sits under the introduction, in reach without scrolling.
        let intro = PageIntro::lead(text(locale, Message::HelpDescription)).action(
            button(
                ids::REPLAY_ONBOARDING,
                text(locale, Message::ReplayOnboarding),
                cx,
            )
            .on_click(cx.listener(|this, _, _, cx| this.replay_onboarding(cx))),
        );
        let body = study_ui::page_scroll(ids::PAGE, cx)
            .bg(cx.theme().colors.background)
            .text_color(colors.foreground)
            .child(
                study_ui::page_column(Column::Read)
                    .flex()
                    .flex_col()
                    .child(intro.mb(unit(scale::SPACE_LG)))
                    .child(
                        div().flex().flex_col().gap(unit(scale::SPACE_XL)).children(
                            GUIDE
                                .iter()
                                .map(|&(title, body)| topic(title, body, locale, cx)),
                        ),
                    ),
            );
        PageView::with_header(
            PageHeader::new(text(locale, Message::Help)).icon(Page::Help.icon()),
            body,
        )
    }
}

/// The parts of Study, each with its title and what it does.
const GUIDE: [(Message, Message); 5] = [
    (Message::HelpCaptureTitle, Message::HelpCaptureBody),
    (Message::HelpAskTitle, Message::HelpAskBody),
    (Message::HelpStudyTitle, Message::HelpStudyBody),
    (Message::HelpPracticeTitle, Message::HelpPracticeBody),
    (Message::HelpKeysTitle, Message::HelpKeysBody),
];

/// One part of Study: its title heading over a paragraph of body text.
fn topic(title: Message, body: Message, locale: Locale, cx: &gpui_kit::App) -> gpui_kit::Div {
    let unit = units(cx);
    div()
        .flex()
        .flex_col()
        .gap(unit(scale::SPACE_XS))
        .child(study_ui::heading(text(locale, title), cx))
        .child(
            study_ui::body_text(cx)
                .whitespace_normal()
                .child(text(locale, body)),
        )
}
