//! Measuring this computer once, the first time Study opens. The report is kept in the app
//! database, so later launches read it instead; `study_app` does the work.

use study_app::App;
use study_app::benchmark::Report;

/// Measures this computer unless the app database already holds a report. Runs on the app's
/// runtime.
pub fn measure(app: &App) -> tokio::task::JoinHandle<study_core::Result<Report>> {
    let measuring = app.clone();
    app.spawn(async move { measuring.measure_machine_once().await })
}

/// The result of a run started by [`measure`], including the task itself having stopped.
pub async fn outcome(
    run: tokio::task::JoinHandle<study_core::Result<Report>>,
) -> study_core::Result<Report> {
    run.await
        .map_err(|join| study_core::err!("the measuring task stopped: {join}"))?
}
