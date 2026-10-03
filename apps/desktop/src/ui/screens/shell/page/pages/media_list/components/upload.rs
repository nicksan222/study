//! The upload dialog: drop files, or choose them from disk.

use super::super::ids;
use crate::ui::screens::shell::page::pages::components::centered_top;
use crate::ui::screens::shell::page::*;
use gpui_kit::ExternalPaths;
use gpui_kit::StatefulInteractiveElement as _;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::{
    ActiveTheme as _, Disableable as _, WindowExt as _, button::ButtonVariants as _, dialog::Dialog,
};
use study_ui::{button, units};

impl AppShell {
    /// The upload dialog, drawn afresh each frame: a drop zone, what the import is doing,
    /// and the file picker. It stays open while files are imported.
    pub(in crate::ui::screens::shell::page::pages::media_list) fn media_upload_dialog(
        &self,
        dialog: Dialog,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> Dialog {
        let locale = self.preferences.language;
        let unit = units(cx);
        // Only an import under way holds the dialog open. The system's file picker can be left
        // waiting (or never answer, headless): closing the dialog meanwhile is still allowed,
        // and files picked later are imported all the same.
        let importing = self.media.busy;
        let mut content = div().w_full().flex().flex_col().gap(unit(14.)).child(
            div()
                .id(ids::DROP_ZONE)
                .test_support()
                .aria_label(text(locale, Message::DropMediaFiles))
                .w_full()
                .h(unit(210.))
                .rounded(unit(study_ui::scale::RADIUS_LG))
                .border_1()
                .border_color(cx.theme().colors.border)
                .bg(cx.theme().colors.muted.opacity(0.25))
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .gap(unit(14.))
                .child(gpui_kit::component::Icon::new(IconName::ArrowUp).size(unit(32.)))
                .child(text(locale, Message::DropMediaFiles))
                .child(
                    div()
                        .text_size(unit(study_ui::scale::TEXT_SMALL))
                        .text_color(cx.theme().colors.muted_foreground)
                        .child(text(locale, Message::UploadMediaHint)),
                )
                .drag_over::<ExternalPaths>(|style, _, _, cx| {
                    style
                        .border_color(cx.theme().colors.primary)
                        .bg(cx.theme().colors.secondary)
                })
                .on_drop(cx.listener(|this, paths: &ExternalPaths, window, cx| {
                    if !this.media.busy && !this.media.picking {
                        this.import_media_paths(paths.paths().to_vec(), window, cx);
                    }
                })),
        );
        if let Some(error) = self.media.error {
            content = content.child(
                div()
                    .text_color(cx.theme().colors.danger)
                    .child(text(locale, error)),
            );
        } else if self.media.busy {
            content = content.child(text(locale, Message::ImportingMedia));
        }
        dialog
            .title(text(locale, Message::UploadMedia))
            .w(unit(500.).min(window.viewport_size().width - unit(48.)))
            .margin_top(centered_top(window, 380., cx))
            .close_button(!importing)
            .keyboard(!importing)
            .overlay_closable(!importing)
            .child(content)
            .footer(
                div()
                    .flex()
                    .justify_end()
                    .gap(unit(8.))
                    .child(
                        button(ids::CANCEL_UPLOAD, text(locale, Message::Cancel), cx)
                            .ghost()
                            .disabled(importing)
                            .on_click(|_, window, cx| window.close_dialog(cx)),
                    )
                    .child(
                        button(ids::CHOOSE_FILE, text(locale, Message::ChooseMediaFile), cx)
                            .primary()
                            .disabled(importing || self.media.picking)
                            .on_click(cx.listener(|this, _, window, cx| {
                                this.choose_media_file(window, cx)
                            })),
                    ),
            )
    }
}

#[cfg(test)]
mod tests {
    use super::super::super::ids;
    use crate::app::preferences::Preferences;
    use crate::testing::TempApp;
    use crate::ui::screens::shell::page::testing::{click, find, open_shell};
    use crate::ui::screens::shell::page::*;
    use gpui_kit::TestAppContext;

    /// While the system's file picker is open, and even if it never answers, the dialog can
    /// still be closed: by Cancel, or by Escape.
    #[gpui_kit::test]
    fn the_upload_dialog_closes_while_the_picker_waits(cx: &mut TestAppContext) {
        let app = TempApp::new();
        let (window, shell) = open_shell(cx, app.app(), Preferences::default());
        click(cx, window, Page::MediaList as usize);
        for close in [Some(ids::CANCEL_UPLOAD), None] {
            click(cx, window, ids::UPLOAD);
            let zone = find(cx, window, ids::DROP_ZONE).expect("the dialog is open");
            assert_eq!(
                zone.label(),
                Some(text(Locale::English, Message::DropMediaFiles))
            );
            click(cx, window, ids::CHOOSE_FILE);
            assert!(cx.did_prompt_for_paths());
            assert!(cx.update(|cx| shell.read(cx).media.picking));
            match close {
                Some(button) => click(cx, window, button),
                None => {
                    cx.simulate_keystrokes(window, "escape");
                    cx.run_until_parked();
                }
            }
            assert!(
                find(cx, window, ids::DROP_ZONE).is_none(),
                "the dialog closed"
            );
            // The picker answers late: nothing was picked, and the Library is as it was.
            cx.simulate_path_prompt_response(|_| None);
            cx.run_until_parked();
            assert!(!cx.update(|cx| shell.read(cx).media.picking));
        }
    }
}
