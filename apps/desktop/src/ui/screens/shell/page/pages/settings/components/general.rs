//! The General sections of Settings: the interface language with a preview of it, and the
//! look (light or dark, and the text size). The tour's "look" step offers the same cards.

use super::super::ids;
use super::settings_card;
use crate::app::preferences::Appearance;
use crate::features::display::ZoomCommand;
use crate::ui::screens::shell::page::*;
use crate::ui::theme_mode;
use gpui_kit::SharedString;
use gpui_kit::component::{ActiveTheme as _, Disableable as _};
use study_core::Language;
use study_localization::{ago, joined, media_size, zoom_percentage};
use study_ui::{
    ChoiceCard, ChoiceGrid, ContentPage, ThemePreview, button, icon_button, set_appearance, units,
};

impl AppShell {
    /// The Language section: a card per language, and a sample of the app in the chosen one.
    pub(in crate::ui::screens::shell::page) fn language_page(
        &self,
        page: ContentPage,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> ContentPage {
        page.item(self.language_choices(locale, cx))
            .item(Self::language_preview(locale, cx))
    }

    /// A card per `Language`, the chosen one marked. The tour's look step shows the same.
    pub(in crate::ui::screens::shell::page) fn language_choices(
        &self,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> ChoiceGrid {
        let selected = self.preferences.language;
        Language::ALL
            .iter()
            .fold(ChoiceGrid::new(), |grid, &language| {
                grid.card(Self::language_button(language, selected, locale, cx))
            })
    }

    /// A card per `Appearance`, the chosen one marked. The tour's look step shows the same.
    pub(in crate::ui::screens::shell::page) fn appearance_choices(
        &self,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> ChoiceGrid {
        let selected = self.preferences.appearance;
        Appearance::ALL
            .iter()
            .fold(ChoiceGrid::new(), |grid, &appearance| {
                grid.card(Self::appearance_button(appearance, selected, locale, cx))
            })
    }

    /// The Appearance section: a card per theme, and the text size.
    pub(in crate::ui::screens::shell::page) fn appearance_page(
        &self,
        page: ContentPage,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> ContentPage {
        page.item(self.appearance_choices(locale, cx))
            .item(self.text_size_card(locale, cx))
    }

    fn language_button(
        language: Language,
        selected: Language,
        ui_locale: Locale,
        cx: &mut Context<Self>,
    ) -> ChoiceCard {
        let (message, subtitle) = match language {
            Language::English => (Message::EnglishOwnName, Message::EnglishOptionSubtitle),
            Language::Italian => (Message::ItalianOwnName, Message::ItalianOptionSubtitle),
        };
        ChoiceCard::new(ids::LANGUAGE + language as usize, text(ui_locale, message))
            .icon(IconName::Globe)
            .description(text(ui_locale, subtitle))
            .selected(language == selected)
            .on_click(cx.listener(move |this, _, _, cx| {
                if this.preferences.language != language || this.save_error {
                    this.preferences.language = language;
                    crate::app::desktop::install(language, cx);
                    this.menu.update(cx, |menu, cx| menu.reload(cx));
                    this.persist(cx);
                    cx.notify();
                }
            }))
    }

    fn appearance_button(
        appearance: Appearance,
        selected: Appearance,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> ChoiceCard {
        let (message, subtitle) = match appearance {
            Appearance::Light => (Message::Light, Message::LightOptionSubtitle),
            Appearance::Dark => (Message::Dark, Message::DarkOptionSubtitle),
        };
        ChoiceCard::new(ids::APPEARANCE + appearance as usize, text(locale, message))
            .visual(ThemePreview::new(theme_mode(appearance)))
            .description(text(locale, subtitle))
            .selected(appearance == selected)
            .on_click(cx.listener(move |this, _, _, cx| {
                if this.preferences.appearance != appearance || this.save_error {
                    this.preferences.appearance = appearance;
                    set_appearance(cx, theme_mode(appearance));
                    this.persist(cx);
                    cx.notify();
                }
            }))
    }

    /// A sample of the app in the chosen language: menu names, a file size, and a time.
    fn language_preview(locale: Locale, cx: &mut Context<Self>) -> gpui_kit::Div {
        let colors = cx.theme().colors;
        let unit = units(cx);
        let menus = [
            Message::Home,
            Message::MediaList,
            Message::Projects,
            Message::Pipelines,
            Message::Settings,
        ]
        .map(|message| text(locale, message).to_owned());
        let rows = [
            (Message::PreviewMenus, joined(&menus)),
            (Message::PreviewSizes, media_size(locale, 1_572_864)),
            (Message::PreviewTimes, ago(locale, 7_200)),
        ];
        settings_card(text(locale, Message::LanguagePreview), cx).child(
            div()
                .w_full()
                .flex()
                .flex_col()
                .gap(unit(8.))
                .children(rows.into_iter().map(|(label, value)| {
                    div()
                        .w_full()
                        .flex()
                        .justify_between()
                        .gap(unit(16.))
                        .text_size(unit(study_ui::scale::TEXT_SMALL))
                        .child(
                            div()
                                .text_color(colors.muted_foreground)
                                .child(text(locale, label)),
                        )
                        .child(div().text_right().child(SharedString::from(value)))
                })),
        )
    }

    /// The zoom controls; the View menu and its shortcuts zoom too. The title bar has none.
    fn text_size_card(&self, locale: Locale, cx: &mut Context<Self>) -> gpui_kit::Div {
        let unit = units(cx);
        let muted = cx.theme().colors.muted_foreground;
        settings_card(text(locale, Message::TextSize), cx)
            .child(
                div()
                    .text_size(unit(study_ui::scale::TEXT_SMALL))
                    .text_color(muted)
                    .child(text(locale, Message::TextSizeHint)),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(unit(8.))
                    .child(
                        icon_button(
                            ids::ZOOM_OUT,
                            text(locale, Message::ZoomOut),
                            IconName::Minus,
                            cx,
                        )
                        .disabled(!self.zoom.can_decrease())
                        .on_click(
                            cx.listener(|this, _, _, cx| this.change_zoom(ZoomCommand::Out, cx)),
                        ),
                    )
                    .child(
                        button(ids::RESET_ZOOM, zoom_percentage(self.zoom.percent()), cx)
                            .tooltip(text(locale, Message::ResetZoom))
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.change_zoom(ZoomCommand::Reset, cx)
                            })),
                    )
                    .child(
                        icon_button(
                            ids::ZOOM_IN,
                            text(locale, Message::ZoomIn),
                            IconName::Plus,
                            cx,
                        )
                        .disabled(!self.zoom.can_increase())
                        .on_click(
                            cx.listener(|this, _, _, cx| this.change_zoom(ZoomCommand::In, cx)),
                        ),
                    ),
            )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::preferences::Preferences;
    use crate::ui::screens::shell::page::testing::{click, open_shell};
    use gpui_kit::component::Theme;
    use gpui_kit::test::TestWindowExt as _;
    use gpui_kit::{AnyWindowHandle, AppContext as _, Pixels, Size, TestAppContext, px};

    /// Opens Settings › Appearance, where the zoom controls are.
    fn open_appearance(cx: &mut TestAppContext, window: AnyWindowHandle) {
        click(cx, window, Page::Settings as usize);
        click(
            cx,
            window,
            ids::SECTION + SettingsSection::Appearance as usize,
        );
    }

    /// The theme's font size and the reset button's size, after drawing a frame.
    fn snapshot_zoom(cx: &mut TestAppContext, window: AnyWindowHandle) -> (Pixels, Size<Pixels>) {
        cx.update_window(window, |_, window, cx| {
            window.render_frame(cx);
            (
                Theme::global(cx).font_size,
                window.find(ids::RESET_ZOOM).bounds().size,
            )
        })
        .unwrap()
    }

    #[gpui_kit::test]
    fn appearance_zoom_scales_theme_and_control_bounds(cx: &mut TestAppContext) {
        let temp = crate::testing::TempApp::new();
        let (window, shell) = open_shell(cx, temp.app(), Preferences::default());
        open_appearance(cx, window);
        let (default_font, default_button) = snapshot_zoom(cx, window);
        assert_eq!(default_font, px(15.));

        click(cx, window, ids::ZOOM_IN);
        let (zoomed_font, zoomed_button) = snapshot_zoom(cx, window);
        assert_eq!(zoomed_font, px(16.5));
        assert!(zoomed_button.height > default_button.height);
        assert!(zoomed_button.width > default_button.width);
        assert_eq!(cx.update(|cx| shell.read(cx).preferences.zoom_percent), 110);

        click(cx, window, ids::ZOOM_IN);
        assert_eq!(snapshot_zoom(cx, window).0, px(18.75));

        click(cx, window, ids::RESET_ZOOM);
        let (reset_font, reset_button) = snapshot_zoom(cx, window);
        assert_eq!(reset_font, default_font);
        assert_eq!(reset_button, default_button);
    }

    #[gpui_kit::test]
    fn appearance_zoom_stops_at_minimum_and_maximum(cx: &mut TestAppContext) {
        let temp = crate::testing::TempApp::new();
        let (window, _shell) = open_shell(cx, temp.app(), Preferences::default());
        open_appearance(cx, window);

        for _ in 0..20 {
            click(cx, window, ids::ZOOM_IN);
        }
        let (maximum, _) = snapshot_zoom(cx, window);
        assert_eq!(maximum, px(30.));
        click(cx, window, ids::ZOOM_IN);
        assert_eq!(snapshot_zoom(cx, window).0, maximum);

        for _ in 0..20 {
            click(cx, window, ids::ZOOM_OUT);
        }
        let (minimum, _) = snapshot_zoom(cx, window);
        assert_eq!(minimum, px(11.25));
        click(cx, window, ids::ZOOM_OUT);
        assert_eq!(snapshot_zoom(cx, window).0, minimum);
    }
}
