//! Failures the UI shows in its own words: what went wrong in detail goes to the log.

use std::fmt::Display;

/// Logs a failure with its full cause chain; the page explains it in its own words.
pub fn report(error: &dyn Display) {
    tracing::error!(error = %format!("{error:#}"), "an action failed");
}
