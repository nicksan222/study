//! Helpers shared by the GPUI page tests: open the shell in a test window, with background
//! work running offline or not at all, click or find an element by id, and wait for
//! background work. The app under test comes from [`TempApp`], and the plain shell from
//! [`open_shell`], both in `crate::testing`.

use super::workers::WorkersState;
use crate::app::preferences::Preferences;
use crate::testing::TempApp;
pub(super) use crate::testing::open_shell;
use crate::ui::screens::shell::AppShell;
use gpui_kit::test::{ElementSnapshot, TestWindowExt as _};
use gpui_kit::{AnyWindowHandle, AppContext as _, ElementId, Entity, TestAppContext};
use std::sync::Arc;
use study_app::WorkerSetup;
use study_app::pipeline::{ExtractorSet, TranscriptionExtractor, VisionExtractor};
use study_app::views::Document;
use study_core::Failure;
use study_core::processing::{BoxFuture, Extractor, ExtractorKind, SourceInput};

/// Marks background work as failed, so nothing runs and actions that need it say why.
pub(super) fn without_workers(cx: &mut TestAppContext, shell: &Entity<AppShell>) {
    set_workers(cx, shell, WorkersState::Failed);
}

/// Sets what background work is doing; a start the shell began and has not finished leaves
/// it as set.
pub(super) fn set_workers(cx: &mut TestAppContext, shell: &Entity<AppShell>, state: WorkersState) {
    cx.update(|cx| shell.update(cx, |shell, _| shell.workers.state = state));
}

/// Draws a frame, clicks the element with `id`, and lets what it started settle.
pub(super) fn click(cx: &mut TestAppContext, window: AnyWindowHandle, id: impl Into<ElementId>) {
    cx.update_window(window, |_, window, cx| {
        window.render_frame(cx);
        window.click(id, cx);
    })
    .unwrap();
    cx.run_until_parked();
}

/// Draws a frame and returns the element with `id`, or `None` when it is not on screen.
pub(super) fn find(
    cx: &mut TestAppContext,
    window: AnyWindowHandle,
    id: impl Into<ElementId>,
) -> Option<ElementSnapshot> {
    cx.update_window(window, |_, window, cx| {
        window.render_frame(cx);
        window.try_find(id)
    })
    .unwrap()
}

/// Draws a frame and lets what it started settle.
pub(super) fn render(cx: &mut TestAppContext, window: AnyWindowHandle) {
    cx.update_window(window, |_, window, cx| window.render_frame(cx))
        .unwrap();
    cx.run_until_parked();
}

/// Waits for background threads (the app's runtime) to finish something, for up to about
/// five seconds.
pub(super) fn wait_until(
    cx: &mut TestAppContext,
    mut done: impl FnMut(&mut TestAppContext) -> bool,
) {
    for _ in 0..500 {
        cx.run_until_parked();
        if done(cx) {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    panic!("timed out");
}

/// The app's own extractors, deciding what to read the same way, but finishing at once
/// with an empty document: tests must never load a real model or reach the plan.
struct Quiet(Arc<dyn Extractor>);

impl Extractor for Quiet {
    fn kind(&self) -> ExtractorKind {
        self.0.kind()
    }

    fn version(&self) -> u32 {
        self.0.version()
    }

    fn extract(&self, _: SourceInput) -> BoxFuture<'_, Result<Document, Failure>> {
        Box::pin(async { Ok(Document::default()) })
    }
}

fn quiet_extractors() -> ExtractorSet {
    ExtractorSet::new(vec![
        Arc::new(Quiet(Arc::new(TranscriptionExtractor::default()))),
        Arc::new(Quiet(Arc::new(VisionExtractor::new(
            study_app::vision::RecognizerConfig::new(study_app::vision::ProviderConfig::Model(
                study_app::chat::Models::build(offline_models())
                    .unwrap()
                    .model(study_app::chat::Tier::Medium),
                study_core::Language::English,
            )),
        )))),
    ])
}

/// Language models on a ChatGPT plan nobody signed in to: titles and answers fail at once
/// as a setup problem, and nothing goes online.
fn offline_models() -> study_app::chat::ModelsConfig {
    study_app::chat::ModelsConfig::from_fn(|tier| {
        use study_app::chat::provider::chatgpt::{self, ChatGptConfig};
        let mut api = chatgpt::defaults(tier);
        // Port 9 on loopback has nothing listening, so a request is refused at once.
        api.base_url = "http://127.0.0.1:9".into();
        study_app::chat::ProviderConfig::ChatGpt(Box::new(ChatGptConfig {
            api,
            issuer: "http://127.0.0.1:9".into(),
            account: None,
        }))
    })
}

/// Opens the shell over `app`. With `working`, background work runs offline: files are read
/// by quiet extractors, and model work fails at once as not signed in. Without, none runs.
/// The event listener is left out: the test scheduler rejects wakeups from other threads.
pub(super) fn open_offline_shell(
    cx: &mut TestAppContext,
    app: &TempApp,
    working: bool,
) -> (AnyWindowHandle, Entity<AppShell>) {
    let app = app.app();
    if working {
        app.start_workers_with(
            WorkerSetup::testing(quiet_extractors()).with_models(offline_models()),
        )
        .unwrap();
    }
    let (window, shell) = open_shell(cx, app, Preferences::default());
    let state = if working {
        WorkersState::Ready
    } else {
        WorkersState::Failed
    };
    set_workers(cx, &shell, state);
    (window, shell)
}
