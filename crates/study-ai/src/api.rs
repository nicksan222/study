//! [`ApiConfig`]: everything an HTTP API provider is set up with.

use std::time::Duration;

/// Where an HTTP API provider sends requests, with which model, and how patiently. Each
/// provider publishes its defaults as one of these; how it authenticates is its own.
#[derive(Clone, Debug)]
pub struct ApiConfig {
    /// API root, such as `https://api.openai.com/v1`.
    pub base_url: String,
    /// The model asked for, as the provider names it.
    pub model: String,
    /// For a whole request, including the upload.
    pub timeout: Duration,
}
