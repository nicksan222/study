//! The welcome tour: a few full-window steps the first time Study opens. It says what Study
//! is for, sets the language and look, shows how sessions work (notes, and `@study` to
//! ask), signs in to ChatGPT, whose plan runs the language models, downloads the models that
//! run here (speech-to-text where the computer can, and search), and ends on the first real
//! action. The AI step waits only for this computer's measurement; going on starts
//! downloading what runs here, which finishes in the background.
//!
//! Every step can be skipped: skipping is the way on without the models. Finishing or
//! skipping saves `onboarded`, so the tour opens by itself only once; Help can replay it.

use super::components::{brand_tile, feature_tiles, hero_badge, sample_session};
use super::ids;
use crate::ui::screens::shell::page::*;
use gpui_kit::component::{Disableable as _, button::ButtonVariants as _};
use gpui_kit::{AnyElement, IntoElement as _};
use study_app::LocalModel;
use study_app::benchmark::Placement;
use study_localization::step_of;
use study_ui::{OnboardingFrame, button, highlighter_button};

/// The steps of the tour. A new step goes in `ALL` at the same place as in the enum (the
/// test checks), and in the exhaustive matches here and in `onboarding_view`.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
enum Step {
    #[default]
    Welcome,
    Look,
    Notes,
    Ai,
    Ready,
}

impl Step {
    /// Every step, in declaration order, which is the order the tour walks:
    /// `ALL[step.index()] == step`.
    const ALL: [Self; 5] = [
        Self::Welcome,
        Self::Look,
        Self::Notes,
        Self::Ai,
        Self::Ready,
    ];

    fn index(self) -> usize {
        self as usize
    }

    fn next(self) -> Option<Self> {
        Self::ALL.get(self.index() + 1).copied()
    }

    fn previous(self) -> Option<Self> {
        self.index().checked_sub(1).map(|index| Self::ALL[index])
    }

    fn title(self) -> Message {
        match self {
            Self::Welcome => Message::OnboardingWelcomeTitle,
            Self::Look => Message::OnboardingLookTitle,
            Self::Notes => Message::OnboardingNotesTitle,
            Self::Ai => Message::OnboardingAiTitle,
            Self::Ready => Message::OnboardingReadyTitle,
        }
    }

    /// The line under the title that says what the step is for.
    fn description(self) -> Message {
        match self {
            Self::Welcome => Message::OnboardingWelcomeIntro,
            Self::Look => Message::OnboardingLookIntro,
            Self::Notes => Message::OnboardingNotesIntro,
            Self::Ai => Message::OnboardingAiIntro,
            Self::Ready => Message::OnboardingReadyIntro,
        }
    }
}

/// Where the tour is, and the model download it can start.
#[derive(Debug, Default)]
pub(in crate::ui::screens::shell::page) struct Onboarding {
    /// `None` while the tour is closed.
    step: Option<Step>,
    pub(super) downloading: bool,
    /// The last download ended: `Some(true)` when everything it asked for installed.
    pub(super) downloaded: Option<bool>,
    /// Why the last ChatGPT sign-in did not end on the plan.
    pub(super) sign_in_failed: Option<Message>,
}

impl AppShell {
    /// Opens the tour unless it was finished or skipped before.
    pub(crate) fn start_onboarding(&mut self, cx: &mut Context<Self>) {
        if !self.preferences.onboarded {
            self.onboarding.step = Some(Step::Welcome);
            cx.notify();
        }
    }

    /// Opens the tour from the start, whatever was saved.
    pub(in crate::ui::screens::shell::page) fn replay_onboarding(
        &mut self,
        cx: &mut Context<Self>,
    ) {
        self.onboarding.step = Some(Step::Welcome);
        cx.notify();
    }

    #[cfg(test)]
    fn onboarding_open(&self) -> bool {
        self.onboarding.step.is_some()
    }

    fn go_to_step(&mut self, step: Step, cx: &mut Context<Self>) {
        self.onboarding.step = Some(step);
        if step == Step::Ai {
            // The step shows the measurement, what is already installed, and whether
            // someone is signed in to ChatGPT.
            self.ensure_llm_loaded(cx);
            self.refresh_installed_models();
        }
        cx.notify();
    }

    /// Closes the tour and remembers it; then opens `section` of Settings, if any, or Home.
    pub(super) fn finish_onboarding(
        &mut self,
        section: Option<SettingsSection>,
        cx: &mut Context<Self>,
    ) {
        self.onboarding.step = None;
        if !self.preferences.onboarded {
            self.preferences.onboarded = true;
            self.persist(cx);
        }
        match section {
            Some(section) => {
                self.settings_section = section;
                self.navigate(Page::Settings, cx);
            }
            None => self.navigate(Page::Home, cx),
        }
        cx.notify();
    }

    /// Whether `model` is downloaded, as last checked.
    fn model_ready(&self, model: LocalModel) -> bool {
        match model {
            LocalModel::Transcription => self.transcription.model_installed(),
            LocalModel::Search => self.system.search_installed() == Some(true),
        }
    }

    fn refresh_installed_models(&mut self) {
        self.transcription.refresh_installed(&self.app);
        self.system.refresh_installed(&self.app);
    }

    /// The models the measurement placed on this computer that are not downloaded yet.
    pub(super) fn models_to_download(&self) -> Vec<LocalModel> {
        let Some(report) = self.system.report() else {
            return Vec::new();
        };
        let plan = report.plan();
        [
            (LocalModel::Transcription, plan.transcription),
            // Search never leaves this computer.
            (LocalModel::Search, Placement::Local),
        ]
        .into_iter()
        .filter(|&(model, placement)| placement == Placement::Local && !self.model_ready(model))
        .map(|(model, _)| model)
        .collect()
    }

    /// Whether the AI step may go on: once the measurement is in (or will not come). What
    /// runs here does not hold the tour up: going on starts its download, which finishes
    /// in the background.
    fn ai_step_done(&self) -> bool {
        self.system.report().is_some()
            || !matches!(
                self.startup,
                pages::Startup::Checking | pages::Startup::Running
            )
    }

    /// Downloads, one after another, every model that runs here and is missing, in the
    /// background: the tour goes on meanwhile, and work waiting for a model starts again once
    /// it installs.
    pub(super) fn download_local_models(&mut self, cx: &mut Context<Self>) {
        let models = self.models_to_download();
        if self.onboarding.downloading || models.is_empty() {
            return;
        }
        self.onboarding.downloading = true;
        self.onboarding.downloaded = None;
        cx.notify();
        let app = self.app.clone();
        let install = self.app.spawn(async move {
            for model in models {
                app.install_model(model).await?;
            }
            Ok::<_, study_core::Error>(())
        });
        cx.spawn(async move |this, cx| {
            let result = install.await.unwrap_or_else(|error| Err(error.into()));
            if let Err(error) = &result {
                crate::features::errors::report(error);
            }
            let _ = this.update(cx, |view, cx| {
                view.onboarding.downloading = false;
                view.onboarding.downloaded = Some(result.is_ok());
                view.refresh_installed_models();
                cx.notify();
            });
        })
        .detach();
    }

    /// Signs in to ChatGPT, whose plan every language model tier runs on, unless someone
    /// already is or a sign-in is already waiting.
    pub(super) fn use_chatgpt_plan(&mut self, cx: &mut Context<Self>) {
        if self.chatgpt_account().is_some() {
            return;
        }
        let started = self.run_chatgpt_sign_in(false, cx, |view, result, cx| {
            view.onboarding.sign_in_failed = match result {
                Ok(()) if view.chatgpt_account().is_some() => None,
                Ok(()) => Some(Message::LlmChatGptNotSharing),
                Err(message) => Some(message),
            };
            cx.notify();
        });
        if started {
            self.onboarding.sign_in_failed = None;
        }
    }

    /// Drops the tour's note of a failed ChatGPT sign-in, once another sign-in has ended.
    pub(in crate::ui::screens::shell::page) fn forget_tour_sign_in_failure(&mut self) {
        self.onboarding.sign_in_failed = None;
    }

    /// The tour's window for the current step, or `None` when it is closed.
    pub(in crate::ui::screens::shell::page) fn onboarding_view(
        &self,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> Option<OnboardingFrame> {
        let step = self.onboarding.step?;
        let hero = match step {
            Step::Welcome => brand_tile(locale, cx),
            Step::Look => hero_badge(IconName::Palette, cx),
            Step::Notes => hero_badge(IconName::NotebookPen, cx),
            Step::Ai => hero_badge(IconName::Cpu, cx),
            Step::Ready => hero_badge(IconName::PartyPopper, cx),
        };
        let content: AnyElement = match step {
            Step::Welcome => feature_tiles(locale, cx).into_any_element(),
            Step::Look => self.look_step(locale, cx).into_any_element(),
            Step::Notes => sample_session(locale, cx).into_any_element(),
            Step::Ai => self.ai_step(locale, cx).into_any_element(),
            Step::Ready => self.ready_step(locale, cx).into_any_element(),
        };
        let next = match step.next() {
            Some(next) => {
                let label = if step == Step::Welcome {
                    Message::OnboardingStart
                } else {
                    Message::OnboardingNext
                };
                button(ids::NEXT, text(locale, label), cx)
                    .primary()
                    // The AI step waits only for the measurement; going on downloads what runs
                    // here in the background.
                    .disabled(step == Step::Ai && !self.ai_step_done())
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if step == Step::Ai {
                            this.download_local_models(cx);
                        }
                        this.go_to_step(next, cx)
                    }))
            }
            // Starting to study is the learning action, so the tour's last step fills it with
            // the highlighter.
            None => highlighter_button(ids::NEXT, text(locale, Message::OnboardingFinish), cx)
                .on_click(cx.listener(|this, _, _, cx| this.finish_onboarding(None, cx))),
        };
        let mut frame =
            OnboardingFrame::new(step.index(), Step::ALL.len(), text(locale, step.title()))
                .brand(text(locale, Message::AppName))
                .progress_label(step_of(locale, step.index() + 1, Step::ALL.len()))
                .hero(hero)
                .description(text(locale, step.description()))
                .content(content)
                .next(next);
        if let Some(previous) = step.previous() {
            frame = frame.back(
                button(ids::BACK, text(locale, Message::Back), cx)
                    .ghost()
                    .on_click(cx.listener(move |this, _, _, cx| this.go_to_step(previous, cx))),
            );
        }
        if step.next().is_some() {
            frame = frame.skip(
                button(ids::SKIP, text(locale, Message::OnboardingSkip), cx)
                    .ghost()
                    .on_click(cx.listener(|this, _, _, cx| this.finish_onboarding(None, cx))),
            );
        }
        Some(frame)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::preferences::Preferences;
    use crate::testing::TempApp;
    use crate::ui::screens::shell::page::pages::{help, settings};
    use crate::ui::screens::shell::page::testing::{self, click, find};
    use gpui_kit::{AnyWindowHandle, Entity, TestAppContext};
    use study_core::Language;

    /// Opens the shell as the app does on launch, with the tour if it was never seen.
    fn open_shell(
        cx: &mut TestAppContext,
        app: &TempApp,
        preferences: Preferences,
    ) -> (AnyWindowHandle, Entity<AppShell>) {
        let (window, shell) = testing::open_shell(cx, app.app(), preferences);
        cx.update(|cx| shell.update(cx, |shell, cx| shell.start_onboarding(cx)));
        (window, shell)
    }

    /// Names each step's successor in declaration order. Exhaustive, so a new step does not
    /// compile until it is placed here, and the test then fails until it is in `ALL`.
    fn declared_after(step: Step) -> Option<Step> {
        match step {
            Step::Welcome => Some(Step::Look),
            Step::Look => Some(Step::Notes),
            Step::Notes => Some(Step::Ai),
            Step::Ai => Some(Step::Ready),
            Step::Ready => None,
        }
    }

    #[test]
    fn every_step_is_in_all_in_declaration_order() {
        let declared: Vec<Step> =
            std::iter::successors(Some(Step::default()), |&step| declared_after(step)).collect();
        assert_eq!(declared, Step::ALL);
        for (index, step) in Step::ALL.into_iter().enumerate() {
            assert_eq!(step.index(), index);
            assert_eq!(step.next(), Step::ALL.get(index + 1).copied());
            assert_eq!(step.previous(), index.checked_sub(1).map(|i| Step::ALL[i]));
        }
    }

    fn step(cx: &mut TestAppContext, shell: &Entity<AppShell>) -> Option<Step> {
        cx.update(|cx| shell.read(cx).onboarding.step)
    }

    /// Clicks Next until the tour shows `target`, and lets what that step loads settle.
    fn walk_to(
        cx: &mut TestAppContext,
        window: AnyWindowHandle,
        shell: &Entity<AppShell>,
        target: Step,
    ) {
        while step(cx, shell) != Some(target) {
            click(cx, window, ids::NEXT);
        }
        cx.run_until_parked();
    }

    #[gpui_kit::test]
    fn a_new_user_is_welcomed_and_skipping_is_remembered(cx: &mut TestAppContext) {
        let app = TempApp::new();
        let (window, shell) = open_shell(cx, &app, Preferences::default());
        assert_eq!(step(cx, &shell), Some(Step::Welcome));

        click(cx, window, ids::NEXT);
        assert_eq!(step(cx, &shell), Some(Step::Look));
        // Choosing a language on the tour applies and saves it, as Settings does.
        click(
            cx,
            window,
            settings::ids::LANGUAGE + Language::Italian as usize,
        );
        assert_eq!(
            cx.update(|cx| shell.read(cx).preferences.language),
            Language::Italian
        );

        click(cx, window, ids::SKIP);
        assert!(!cx.update(|cx| shell.read(cx).onboarding_open()));
        assert_eq!(cx.update(|cx| shell.read(cx).active), Page::Home);
        let saved = Preferences::load(&app).unwrap();
        assert!(saved.onboarded);
        assert_eq!(saved.language, Language::Italian);

        // Once seen, the tour does not open by itself again.
        let (_, again) = open_shell(cx, &app, saved);
        assert_eq!(step(cx, &again), None);
    }

    #[gpui_kit::test]
    fn the_tour_walks_to_the_end_and_can_be_replayed_from_help(cx: &mut TestAppContext) {
        let app = TempApp::new();
        let (window, shell) = open_shell(cx, &app, Preferences::default());
        for &expected in &Step::ALL[1..] {
            click(cx, window, ids::NEXT);
            assert_eq!(step(cx, &shell), Some(expected));
        }
        // The last step's primary action finishes the tour.
        click(cx, window, ids::NEXT);
        assert_eq!(step(cx, &shell), None);

        click(cx, window, Page::Help as usize);
        click(cx, window, help::ids::REPLAY_ONBOARDING);
        assert_eq!(step(cx, &shell), Some(Step::Welcome));
    }

    #[gpui_kit::test]
    fn the_ai_step_knows_an_account_already_signed_in(cx: &mut TestAppContext) {
        use study_app::chat::{ChatGptAccount, ChatGptPreferences};
        use study_core::preferences::Secret;

        let app = TempApp::new();
        app.save_preferences(&ChatGptPreferences {
            account: Some(ChatGptAccount {
                client_id: "issued".into(),
                subject: "user-1".into(),
                email: Some("ada@example.com".into()),
                sharing: true,
                refresh_token: Secret::parse("refresh"),
            }),
            ..ChatGptPreferences::default()
        })
        .unwrap();
        let (window, shell) = open_shell(cx, &app, Preferences::default());
        walk_to(cx, window, &shell, Step::Ai);
        // Already signed in: the step says so instead of offering to sign in.
        assert!(cx.update(|cx| shell.read(cx).chatgpt_account().is_some()));
        assert!(find(cx, window, ids::CHATGPT_SIGN_IN).is_none());
    }

    /// A measurement of a small computer: too little memory for anything but search.
    fn small_computer() -> study_app::benchmark::Report {
        use study_app::benchmark::{ComputeScore, Report, SystemInfo};
        Report {
            system: SystemInfo {
                os: String::new(),
                os_version: None,
                arch: String::new(),
                cpu_brand: String::new(),
                physical_cores: None,
                logical_cores: 1,
                total_memory_bytes: 0,
                available_memory_bytes: 0,
                simd: Vec::new(),
            },
            compute: ComputeScore {
                matmul_gflops: 0.0,
                memory_bandwidth_gbps: 0.0,
            },
            elapsed_secs: 0.0,
        }
    }

    #[gpui_kit::test]
    fn the_ai_step_goes_on_while_the_models_download(cx: &mut TestAppContext) {
        let app = TempApp::new();
        let (window, shell) = open_shell(cx, &app, Preferences::default());
        walk_to(cx, window, &shell, Step::Ai);
        // Nobody is signed in, so the step offers to.
        assert!(find(cx, window, ids::CHATGPT_SIGN_IN).is_some());

        cx.update(|cx| {
            shell.update(cx, |shell, _| {
                shell.system.set_report(small_computer());
                shell.onboarding.downloading = true;
            })
        });
        // While the models download, the step shows it instead of the button, and the tour
        // goes on: the download finishes in the background.
        assert!(find(cx, window, ids::DOWNLOAD).is_none());
        click(cx, window, ids::NEXT);
        assert_eq!(step(cx, &shell), Some(Step::Ready));
    }
}
