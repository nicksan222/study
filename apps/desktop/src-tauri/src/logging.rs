//! Logs and panic backtraces remain available after a desktop process exits.
use crate::diagnostics::DiagnosticLog;
use std::{backtrace::Backtrace, sync::Mutex};
use tracing_subscriber::{EnvFilter, fmt, prelude::*};
pub fn install(path: &std::path::Path) {
    let log = std::fs::create_dir_all(path)
        .and_then(|()| DiagnosticLog::open(path.join("diagnostics.log")));
    let opened = log
        .as_ref()
        .map(|log| log.path().display().to_string())
        .map_err(|error| format!("{error:#}"));
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_env("STUDY_LOG").unwrap_or_else(|_| EnvFilter::new("info")))
        .with(fmt::layer().with_writer(std::io::stderr))
        .with(
            log.ok()
                .map(|log| fmt::layer().with_ansi(false).with_writer(Mutex::new(log))),
        )
        .init();
    match opened {
        Ok(path) => tracing::info!(path, "writing the diagnostic log"),
        Err(error) => tracing::warn!(error, "cannot open diagnostic log"),
    }
    std::panic::set_hook(Box::new(|panic| {
        tracing::error!(%panic, backtrace = %Backtrace::force_capture(), "the app panicked");
    }));
}
