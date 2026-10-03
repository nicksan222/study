//! Element ids of the Pipelines page. Per-job ids pair a name with the job's database id.

/// Base of the sidebar's filters; each adds its place in `Filter::ALL`.
pub const FILTER: usize = 6000;
pub const RETRY_LOAD: usize = 6100;
pub const STOP: &str = "stop";
pub const START: &str = "start";
pub const SETTINGS: &str = "settings";
/// A job's row.
pub const ROW: &str = "job-row";
/// Opens where a job's work shows.
pub const OPEN: &str = "job-open";
