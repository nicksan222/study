//! Desktop composition root and GPUI Kit presentation layer.
//!
//! - `app`: app-wide setup, the diagnostic log and the preferences no feature owns.
//! - `features`: glue between the pages and `study-app`, the small rules and actions the
//!   pages share that are not presentation.
//! - `ui`: the GPUI presentation layer, the window and the screens drawn in it.
//!
//! The modules are private, so the compiler reports what nothing uses; the binary needs only
//! [`run`] and the [`DiagnosticLog`] it installs first.

mod app;
mod features;
#[cfg(test)]
mod testing;
mod ui;

pub use app::diagnostics::DiagnosticLog;
pub use ui::run;
