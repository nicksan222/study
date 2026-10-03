//! The Transcription section of Settings: the speech-to-text model on this computer (the
//! ChatGPT plan takes no audio) and how many copies of it run. The model hears which
//! language is spoken by itself, so there is no language to set.
//!
//! Text fields edit a draft that is stored only when the user presses Save, so half-typed
//! values are never written. The model download acts on the local machine and never changes
//! what is stored.

use super::super::ids;
use super::overview::{Readiness, Status};
use super::{invalid_message, unloaded_page, with_status};
use crate::ui::screens::shell::page::pages::components::quiet;
use crate::ui::screens::shell::page::*;
use gpui_kit::component::{
    ActiveTheme as _, Disableable as _,
    button::ButtonVariants as _,
    input::{Input, InputEvent, InputState},
};
use gpui_kit::{AppContext as _, Entity, ParentElement as _, Styled as _, Subscription};
use study_app::LocalModel;
use study_app::stt::{TranscriptionForm, TranscriptionPreferences};
use study_ui::{ContentPage, button, units};

/// What the section is doing; while it does, every other action waits.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Busy {
    Saving,
    Downloading,
}

/// The Transcription section: the draft of its settings, and whether the model is on disk.
pub(in crate::ui::screens::shell::page) struct TranscriptionState {
    /// The fields as typed; checked and stored only by Save.
    draft: TranscriptionForm,
    loaded: bool,
    loading: bool,
    /// The draft differs from what is stored.
    dirty: bool,
    busy: Option<Busy>,
    /// The latest outcome to report, and whether it is an error.
    notice: Option<(Message, bool)>,
    model_installed: bool,
    /// The draft changed from code, so the text field must be rewritten.
    inputs_stale: bool,
    placeholders: Option<Locale>,
    /// Copies of the model loaded at once.
    copies: Entity<InputState>,
    _subscription: Subscription,
}

impl TranscriptionState {
    pub(in crate::ui::screens::shell::page) fn new(
        window: &mut Window,
        cx: &mut Context<AppShell>,
    ) -> Self {
        let copies = cx.new(|cx| InputState::new(window, cx));
        let subscription = cx.subscribe(&copies, |this, _, event: &InputEvent, cx| match event {
            InputEvent::Change => this.read_transcription_copies(cx),
            InputEvent::PressEnter { .. } => this.save_transcription(cx),
            _ => {}
        });
        Self {
            draft: TranscriptionForm::default(),
            loaded: false,
            loading: false,
            dirty: false,
            busy: None,
            notice: None,
            model_installed: false,
            inputs_stale: true,
            placeholders: None,
            copies,
            _subscription: subscription,
        }
    }

    /// Whether the local model is on disk, as last checked.
    pub(in crate::ui::screens::shell::page) fn model_installed(&self) -> bool {
        self.model_installed
    }

    /// Checks again whether the local model is on disk, after something downloaded it.
    pub(in crate::ui::screens::shell::page) fn refresh_installed(&mut self, app: &study_app::App) {
        self.model_installed = app.model_installed(LocalModel::Transcription);
    }

    /// Whether transcription can run: it always runs here, once the model is on disk.
    pub(super) fn status(&self, locale: Locale) -> Status {
        let readiness = if !self.loaded {
            Readiness::Checking
        } else if self.model_installed {
            Readiness::Ready
        } else {
            Readiness::NeedsDownload
        };
        Status {
            readiness,
            place: text(locale, Message::RunsHere).to_owned(),
            local: true,
        }
    }
}

impl AppShell {
    pub(in crate::ui::screens::shell::page) fn ensure_transcription_loaded(
        &mut self,
        cx: &mut Context<Self>,
    ) {
        if !self.transcription.loaded && !self.transcription.loading {
            self.load_transcription(cx);
        }
    }

    fn load_transcription(&mut self, cx: &mut Context<Self>) {
        if self.transcription.loading {
            return;
        }
        self.transcription.loading = true;
        self.transcription.notice = None;
        cx.notify();
        self.background(
            move |app| {
                let settings = app.preferences::<TranscriptionPreferences>()?;
                let installed = app.model_installed(LocalModel::Transcription);
                Ok::<_, study_core::Error>((settings, installed))
            },
            move |view, result, cx| {
                let state = &mut view.transcription;
                state.loading = false;
                match result {
                    Ok((settings, installed)) => {
                        state.draft = TranscriptionForm::from(&settings);
                        state.model_installed = installed;
                        state.loaded = true;
                        state.dirty = false;
                        state.inputs_stale = true;
                    }
                    Err(error) => {
                        crate::features::errors::report(&error);
                        state.notice = Some((Message::TranscriptionLoadError, true));
                    }
                }
                cx.notify();
            },
            cx,
        );
    }

    /// Reads the field of model copies into the draft.
    fn read_transcription_copies(&mut self, cx: &mut Context<Self>) {
        let copies = self.transcription.copies.read(cx).value().to_string();
        self.edit_transcription_draft(|draft| draft.local_instances = copies, cx);
    }

    /// Changes the draft with `edit`; a change makes it unsaved.
    fn edit_transcription_draft(
        &mut self,
        edit: impl FnOnce(&mut TranscriptionForm),
        cx: &mut Context<Self>,
    ) {
        let state = &mut self.transcription;
        let mut draft = state.draft.clone();
        edit(&mut draft);
        if draft != state.draft {
            state.draft = draft;
            state.dirty = true;
            state.notice = None;
            cx.notify();
        }
    }

    /// Writes the draft into the field of model copies and shows its placeholder. Runs from
    /// `render`, where a window is at hand.
    pub(in crate::ui::screens::shell::page) fn sync_transcription_inputs(
        &mut self,
        locale: Locale,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let state = &mut self.transcription;
        let refresh_placeholders = state.placeholders != Some(locale);
        if !state.inputs_stale && !refresh_placeholders {
            return;
        }
        let value = state
            .inputs_stale
            .then(|| state.draft.local_instances.clone());
        // One copy of the model unless the user asks for more.
        let one = study_app::stt::ModelCopies::ONE.get().to_string();
        state.copies.update(cx, |input, cx| {
            if let Some(value) = value {
                input.set_value(value, window, cx);
            }
            input.set_placeholder(one, window, cx);
        });
        state.inputs_stale = false;
        state.placeholders = Some(locale);
    }

    fn save_transcription(&mut self, cx: &mut Context<Self>) {
        let state = &self.transcription;
        if state.busy.is_some() || !state.loaded || !state.dirty {
            return;
        }
        let draft = state.draft.clone();
        let settings = match draft.parse() {
            Ok(settings) => settings,
            Err(invalid) => {
                self.transcription.notice = Some((invalid_message(invalid), true));
                cx.notify();
                return;
            }
        };
        self.transcription.busy = Some(Busy::Saving);
        self.transcription.notice = None;
        cx.notify();
        let saved = settings.clone();
        self.background(
            move |app| app.save_preferences(&saved),
            move |view, result, cx| {
                let state = &mut view.transcription;
                state.busy = None;
                state.notice = Some(match result {
                    Ok(()) => {
                        // Show the trimmed values that were stored, unless typing went on.
                        if state.draft == draft {
                            state.draft = TranscriptionForm::from(&settings);
                            state.dirty = false;
                            state.inputs_stale = true;
                        }
                        (Message::SettingsSaved, false)
                    }
                    Err(error) => {
                        crate::features::errors::report(&error);
                        (Message::SaveError, true)
                    }
                });
                cx.notify();
            },
            cx,
        );
    }

    fn download_local_model(&mut self, cx: &mut Context<Self>) {
        let state = &mut self.transcription;
        if state.busy.is_some() || state.model_installed {
            return;
        }
        state.busy = Some(Busy::Downloading);
        state.notice = None;
        cx.notify();
        let app = self.app.clone();
        let install = self
            .app
            .spawn(async move { app.install_model(LocalModel::Transcription).await });
        cx.spawn(async move |this, cx| {
            let result = install.await.unwrap_or_else(|error| Err(error.into()));
            if let Err(error) = &result {
                crate::features::errors::report(error);
            }
            let installed = result.is_ok();
            let _ = this.update(cx, |view, cx| {
                let state = &mut view.transcription;
                state.busy = None;
                state.model_installed =
                    installed && view.app.model_installed(LocalModel::Transcription);
                state.notice =
                    (!state.model_installed).then_some((Message::ModelDownloadError, true));
                cx.notify();
            });
        })
        .detach();
    }

    /// A setting's `control` under its label, with a line of help below it.
    fn setting_field(
        label: &'static str,
        control: impl IntoElement,
        help: &'static str,
        cx: &mut Context<Self>,
    ) -> gpui_kit::Div {
        let unit = units(cx);
        let muted = cx.theme().colors.muted_foreground;
        div()
            .mt(unit(14.))
            .w_full()
            .flex()
            .flex_col()
            .gap(unit(6.))
            .child(
                div()
                    .text_size(unit(study_ui::scale::TEXT_SMALL))
                    .font_weight(gpui_kit::FontWeight::MEDIUM)
                    .child(label),
            )
            .child(control)
            .child(
                div()
                    .text_size(unit(study_ui::scale::TEXT_CAPTION))
                    .text_color(muted)
                    .child(help),
            )
    }

    /// How many copies of the model run at once, typed.
    fn model_copies(&self, locale: Locale, cx: &mut Context<Self>) -> gpui_kit::Div {
        let unit = units(cx);
        let label = text(locale, Message::ModelCopies);
        let input = Input::new(&self.transcription.copies)
            .id(ids::MODEL_COPIES)
            .w_full()
            .max_w(unit(640.))
            .h(unit(40.))
            .aria_label(label);
        Self::setting_field(label, input, text(locale, Message::ModelCopiesHint), cx)
    }

    pub(in crate::ui::screens::shell::page) fn transcription_page(
        &self,
        page: ContentPage,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> ContentPage {
        let state = &self.transcription;
        if !state.loaded {
            let retry = button(ids::TRANSCRIPTION_RETRY, text(locale, Message::Retry), cx)
                .on_click(cx.listener(|this, _, _, cx| this.load_transcription(cx)));
            return unloaded_page(
                page,
                locale,
                state.loading,
                state.notice,
                Message::TranscriptionLoadError,
                retry,
            );
        }
        let busy = state.busy.is_some();
        let mut page = page;
        let status = text(
            locale,
            if state.model_installed {
                Message::LocalModelReady
            } else {
                Message::LocalModelMissing
            },
        );
        page = page.item(quiet(status, cx));
        if !state.model_installed {
            page = page.item(
                div().flex().child(
                    button(
                        ids::TRANSCRIPTION_DOWNLOAD,
                        text(locale, Message::DownloadModel),
                        cx,
                    )
                    .disabled(busy)
                    .on_click(cx.listener(|this, _, _, cx| this.download_local_model(cx))),
                ),
            );
        }
        page = page.item(self.model_copies(locale, cx)).footer_action(
            button(ids::TRANSCRIPTION_SAVE, text(locale, Message::Save), cx)
                .primary()
                .disabled(busy || !state.dirty)
                .on_click(cx.listener(|this, _, _, cx| this.save_transcription(cx))),
        );
        let status = match state.busy {
            Some(Busy::Saving) => Some((Message::Saving, false)),
            Some(Busy::Downloading) => Some((Message::DownloadingModel, false)),
            None => state.notice,
        };
        with_status(page, locale, status)
    }
}
