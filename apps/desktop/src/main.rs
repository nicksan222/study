//! The Study desktop app: installs logging, then hands over to [`study::run`].

use std::{backtrace::Backtrace, process::ExitCode, sync::Mutex};

use study::DiagnosticLog;
use tracing::Level;
use tracing_subscriber::{EnvFilter, filter::filter_fn, fmt, prelude::*};

fn main() -> ExitCode {
    install_logging();
    study::run()
}

/// Sends every log line, and every panic, to stderr and to the diagnostic log, which keeps
/// the last ones.
fn install_logging() {
    let log = DiagnosticLog::open_default();
    let opened = log
        .as_ref()
        .map(|log| log.path().display().to_string())
        .map_err(|error| format!("{error:#}"));
    // `STUDY_LOG` takes an env-filter directive such as `debug` or `study_core=trace`.
    let chosen = std::env::var_os("STUDY_LOG").is_some();
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_env("STUDY_LOG").unwrap_or_else(|_| EnvFilter::new("info")))
        // The diagram layout logs every phase of every layout at info, under targets of its
        // own; only its warnings matter unless `STUDY_LOG` asks for more.
        .with(filter_fn(move |meta| {
            chosen
                || *meta.level() <= Level::WARN
                || !meta
                    .module_path()
                    .is_some_and(|path| path.starts_with("rust_sugiyama"))
        }))
        .with(fmt::layer().with_writer(std::io::stderr))
        .with(
            log.ok()
                .map(|log| fmt::layer().with_ansi(false).with_writer(Mutex::new(log))),
        )
        .init();
    // Replaces the default hook: the stderr layer already reports the panic.
    std::panic::set_hook(Box::new(|panic| {
        tracing::error!(%panic, backtrace = %Backtrace::force_capture(), "the app panicked");
    }));
    match opened {
        Ok(path) => tracing::info!(path, "writing the diagnostic log"),
        Err(error) => tracing::warn!(error, "cannot open the diagnostic log"),
    }
}
