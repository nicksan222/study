//! Measures the machine Study runs on. A run probes the hardware and OS ([`system`]) and
//! times synthetic kernels, such as matrix throughput and memory bandwidth ([`compute`]). It
//! takes a couple of seconds and downloads nothing. What the numbers mean for each model is
//! decided by [`crate::catalog`], through [`Report::plan`].
//!
//! | Module | Holds |
//! |---|---|
//! | [`system`] | [`SystemInfo`] and [`system::probe`]: what the OS reports (CPU, cores, memory, SIMD) |
//! | [`compute`] | [`ComputeConfig`], [`ComputeScore`] and [`compute::measure`]: the timed kernels |
//! | `report` | [`Report`], [`run`], [`measure_once`] and its [`Measurement`], and saving the report as a preference |
//!
//! The kernels spend their time inside candle's matrix multiply and `memcpy`, both built
//! optimized even in development builds, so the numbers mean the same in every profile.
//!
//! ```no_run
//! # async fn example(store: study_core::db::Store) -> study_core::Result<()> {
//! // The first time: measures and saves the report. Every later time: returns the saved one.
//! let measured = study_ai::hardware::measure_once(store).await?;
//! let plan = measured.report.plan();
//! # Ok(())
//! # }
//! ```

pub mod compute;
mod report;
pub mod system;

pub use compute::{ComputeConfig, ComputeScore};
pub use report::{Measurement, Report, measure_once, run};
pub use system::SystemInfo;
