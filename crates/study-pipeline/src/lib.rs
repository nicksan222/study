//! The implementations of every processor kind `study-core` declares, and the
//! [`Pipeline`] that hands them to the jobs engine. What each kind of source goes through,
//! and what the user switched off, is decided in `study_core::processing`
//! (`ROUTES`, `ProcessingPreferences`); this crate only does the work, calling `study-ai`
//! for anything that needs a model.
//!
//! | Family     | Implementations of               | Set                  | Module              |
//! |------------|----------------------------------|----------------------|---------------------|
//! | Fetchers   | `Fetcher`, per `FetcherKind`     | [`FetcherSet`]       | `fetch/`            |
//! | Extractors | `Extractor`, per `ExtractorKind` | [`ExtractorSet`]     | `extract/`          |
//! | Refiners   | `Refiner`, per `RefinerKind`     | [`RefinerSet`]       | `refine/`           |
//! | Stages     | `Stage`, per stage `JobKind`     | [`Pipeline::stages`] | `stages/`, `index/` |
//! | Enhancers  | `Enhancer`, per `ArtifactKind`   | [`EnhancerSet`]      | `enhance/`          |
//!
//! Each set is a [`ProcessorSet`] of its family: one implementation per kind, filed by the
//! kind it reports (see [`Family`](study_core::processing::Family)), with a test that
//! fails while a kind has none. A family's module adds only what is its own, such as
//! `builtin` and how the family runs. [`ProcessorSet`] lives in `set.rs`, and the
//! [`Pipeline`] in `pipeline.rs`; its [`handlers`](Pipeline::handlers) run the stages, the
//! fetchers (as the `Fetch` job of a link source) and the enhancers (as the `Artifact`
//! job).
//!
//! Adding a processor is a kind in `study-core`, a file in its family's folder here, and
//! one line in its set's `builtin` (for a stage, in [`Pipeline::stages`]); each family's
//! module docs say which sibling to copy, and `study_core::processing` lists every other
//! place it touches.

mod enhance;
mod extract;
mod fetch;
mod index;
mod pipeline;
mod refine;
mod set;
mod stages;

pub use enhance::{EnhancerSet, Sifter};
pub use extract::{
    ExtractorSet, TextExtractor, TranscriptionExtractor, VisionExtractor, WebExtractor,
};
pub use fetch::FetcherSet;
pub use index::{EmbedderSlot, QueryVector, excerpts_of_sources};
pub use pipeline::Pipeline;
pub use refine::RefinerSet;
pub use set::ProcessorSet;
pub use stages::{EmbedStage, IndexStage, StageHandler};
