//! The welcome tour's pictures: the brand tile, the three things Study does, and a sample
//! session that shows notes being written down and one note asking the assistant. Glyphs are
//! monochrome (`DESIGN.md`, the No Rainbow Rule); only the `@study` mention is highlighted.

use crate::ui::screens::shell::page::pages::components::{badge, feature_card, panel};
use gpui_kit::assets::IconName;
use gpui_kit::component::ActiveTheme as _;
use gpui_kit::{App, Div, FontWeight, ParentElement as _, Styled as _, div};
use study_localization::{Locale, Message, text};
use study_ui::units;

/// The app's mark, large, for the first step.
pub(in crate::ui::screens::shell::page::pages::onboarding) fn brand_tile(
    locale: Locale,
    cx: &App,
) -> Div {
    let unit = units(cx);
    let colors = cx.theme().colors;
    div()
        .size(unit(76.))
        .flex()
        .items_center()
        .justify_center()
        .rounded(unit(study_ui::scale::RADIUS_XL))
        .bg(colors.primary)
        .text_color(colors.primary_foreground)
        .text_size(unit(study_ui::scale::TEXT_DISPLAY))
        .font_weight(FontWeight::SEMIBOLD)
        .child(text(locale, Message::BrandMark))
}

/// The step's glyph above its title, in the secondary ink.
pub(in crate::ui::screens::shell::page::pages::onboarding) fn hero_badge(
    icon: IconName,
    cx: &App,
) -> Div {
    badge(icon, cx.theme().colors.muted_foreground, 68., cx)
}

/// Three things Study does, side by side, wrapping on narrow windows.
pub(in crate::ui::screens::shell::page::pages::onboarding) fn feature_tiles(
    locale: Locale,
    cx: &App,
) -> Div {
    let unit = units(cx);
    let colors = cx.theme().colors;
    let features = [
        (
            IconName::Layers,
            Message::OnboardingCaptureTitle,
            Message::OnboardingCaptureText,
        ),
        (
            IconName::AtSign,
            Message::OnboardingAskTitle,
            Message::OnboardingAskText,
        ),
        (
            IconName::GraduationCap,
            Message::OnboardingReviewTitle,
            Message::OnboardingReviewText,
        ),
    ];
    div()
        .w_full()
        .flex()
        .flex_wrap()
        .gap(unit(12.))
        .children(features.into_iter().map(|(icon, title, body)| {
            feature_card(cx)
                .min_w(unit(200.))
                .gap(unit(8.))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(unit(8.))
                        .child(
                            study_ui::icon(icon)
                                .size(unit(16.))
                                .flex_none()
                                .text_color(colors.muted_foreground),
                        )
                        .child(study_ui::heading(text(locale, title), cx)),
                )
                .child(
                    study_ui::body_text(cx)
                        .text_color(colors.muted_foreground)
                        .child(text(locale, body)),
                )
        }))
}

/// A sample session as the notebook shows it: a note, a recording on its one line, then a
/// note that asks `@study`, and the answer under it, all on the page with no bubbles.
pub(in crate::ui::screens::shell::page::pages::onboarding) fn sample_session(
    locale: Locale,
    cx: &App,
) -> Div {
    let unit = units(cx);
    let colors = cx.theme().colors;
    let palette = study_ui::palette(cx);
    let note = |content: Div| study_ui::body_text(cx).w_full().child(content);
    let file = div()
        .w_full()
        .flex()
        .items_center()
        .gap(unit(8.))
        .text_size(unit(study_ui::scale::TEXT_UI))
        .child(
            div()
                .text_color(colors.muted_foreground)
                .child(study_ui::icon(IconName::AudioLines).size(unit(16.))),
        )
        .child(text(locale, Message::OnboardingSampleFile))
        .child(
            div()
                .text_color(palette.faint)
                .child(study_ui::icon(IconName::CircleCheck).size(unit(14.))),
        );
    // The mention stands out as it does to the student: the word that asks for an answer.
    let question = text(locale, Message::OnboardingSampleQuestion);
    let rest = question
        .strip_prefix(study_core::ASSISTANT_MENTION)
        .unwrap_or(question);
    let asked = div()
        .flex()
        .flex_wrap()
        .items_center()
        .gap(unit(6.))
        .child(
            div()
                .px(unit(6.))
                .rounded(unit(study_ui::scale::RADIUS_SM))
                .bg(palette.highlighter_wash)
                .text_color(palette.foreground)
                .font_weight(FontWeight::MEDIUM)
                .child(study_core::ASSISTANT_MENTION),
        )
        .child(rest.trim_start());
    let answer = div()
        .w_full()
        .flex()
        .flex_col()
        .gap(unit(4.))
        .child(
            div()
                .flex()
                .items_center()
                .gap(unit(6.))
                .text_size(unit(study_ui::scale::TEXT_CAPTION))
                .text_color(palette.faint)
                .child(study_ui::icon(IconName::Sparkles).size(unit(14.)))
                .child(text(locale, Message::AppName)),
        )
        .child(note(
            div().child(text(locale, Message::OnboardingSampleAnswer)),
        ));
    panel(cx)
        .w_full()
        .max_w(unit(study_ui::scale::COLUMN_READ))
        .mx_auto()
        .gap(unit(12.))
        .child(note(
            div().child(text(locale, Message::OnboardingSampleNote)),
        ))
        .child(file)
        .child(note(asked))
        .child(answer)
        .child(
            div()
                .mt(unit(study_ui::scale::SPACE_MD))
                .flex()
                .items_center()
                .justify_center()
                .gap(unit(8.))
                .text_size(unit(study_ui::scale::TEXT_SMALL))
                .text_color(colors.muted_foreground)
                .child(study_ui::icon(IconName::AtSign).size(unit(14.)))
                .child(text(locale, Message::OnboardingNotesHint)),
        )
}
