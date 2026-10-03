//! Processing raw input, declared: the interface of every processor family, the kinds of
//! each, and [`ROUTES`], the one table of which processors each kind of source goes
//! through, each on or off by default and switchable by the user. The implementations live
//! in `study-pipeline` (one per kind), and the model providers they call in `study-ai`.
//!
//! | Family     | Kind              | Trait         | Runs                                                   |
//! |------------|-------------------|---------------|--------------------------------------------------------|
//! | Fetchers   | [`FetcherKind`]   | [`Fetcher`]   | As the Fetch job of a link source, in [`FETCHERS`] order |
//! | Extractors | [`ExtractorKind`] | [`Extractor`] | Inside the Extract stage, tried in route order         |
//! | Refiners   | [`RefinerKind`]   | [`Refiner`]   | Inside the Extract stage, in route order, best effort  |
//! | Stages     | [`JobKind`](crate::JobKind) | [`Stage`] | Reading, then what the route lists, each as its own job |
//! | Enhancers  | [`ArtifactKind`](crate::ArtifactKind) | [`Enhancer`] | When the user asks, as the Artifact job |
//!
//! | File            | What it holds                                                    |
//! |-----------------|------------------------------------------------------------------|
//! | `kinds.rs`      | The kind enums, what extractors and refiners require, and [`Processor`] |
//! | `interfaces.rs` | The traits and what flows between them                           |
//! | `fit.rs`        | [`fit_excerpts`]: the passages a model is shown within a budget, each cut at [`MAX_PASSAGE_CHARS`] |
//! | `routes.rs`     | [`ROUTES`] with [`Route`], [`Step`], [`Media`], [`on`] and [`off`]; [`route`], [`FETCHERS`], [`first_extractor`] and [`requirement`] |
//! | `material.rs`   | [`MaterialPreferences`]: how material is written as a whole, such as whether its passages are sifted first |
//! | `plan.rs`       | [`ProcessingPreferences`] (the user's [`Switch`]es over the routes' defaults) and the [`SourcePlan`] they give a source |
//! | `overrides.rs`  | Saving and loading [`ProcessingPreferences`], [`plan_for`] a job's target, and [`sources_missing_refiners`] |
//! | `registry.rs`   | [`Family`]: the kind each family's implementations are filed by  |
//!
//! # Changing what happens to a kind of source
//!
//! Edit its [`Route`] in `routes.rs`: list an extractor, refiner, stage or enhancer with
//! [`on`] or [`off`], or change a shared profile such as `LESSON_MATERIAL`. Settings shows
//! the switch and the pipeline follows. The conventions (route order, agreeing defaults,
//! refiner order) are at the top of `routes.rs`, each held by a test there.
//!
//! # Adding a processor: every place it touches
//!
//! Each step says what fails if it is forgotten; nothing is left to memory.
//!
//! | Step | Where | Caught by |
//! |---|---|---|
//! | Its kind | [`ExtractorKind`], [`RefinerKind`] or [`FetcherKind`] in `kinds.rs`, with what it requires (an extractor's `requirement`, whether it is `reusable`); [`JobKind`](crate::JobKind) for a stage (with `follows_reading` and `builds_on`); [`ArtifactKind`](crate::ArtifactKind) for an enhancer | the exhaustive `match`es |
//! | Its stored code | a row of `codes_extractor_kind` (extractors), `codes_job_kind` (stages) or `codes_artifact_kind` (enhancers), added as `db::migrations` says | `check_lists_match_the_rust_enums` |
//! | Where it runs | its steps in [`ROUTES`] (or [`FETCHERS`] for a fetcher, before `Page`) | `every_extractor_kind_reads_something`, `every_refiner_and_material_kind_is_in_some_route`, `every_fetcher_is_tried_once_and_page_last` |
//! | Its implementation | a file in its family's folder in `study-pipeline`, and one line in that set's `builtin` (for a stage, `Pipeline::stages`) | the `every_*_kind_has_*` tests there, and `every_stage_a_route_lists_has_an_implementation` |
//! | A model it calls | a provider in `study-ai` | — |
//! | Its name | a `Message` in `study-localization` (both catalogs), and its arm in the desktop's `processor_label` (settings) and, for material, `kind_label`/`kind_icon` (Study) | the exhaustive `match`es, `catalogs_follow_the_message_order_and_sections` |
//!
//! Material meant for every kind of file goes in the shared profiles of `routes.rs`
//! (`LESSON_MATERIAL`, `PICTURE_MATERIAL`, `REFERENCE_MATERIAL`), which every route uses.
//!
//! A new extractor often needs a new [`Anchor`](crate::Anchor) too: that is its variant,
//! `Anchor::through`, `continues_into` and `overlaps`, `anchor_label` in
//! `study-localization`, and `place` in `study-ai`'s agent kit, all exhaustive. A new
//! [`ArtifactBody`](crate::ArtifactBody) shape is described in `artifact.rs`.

mod fit;
mod interfaces;
mod kinds;
mod material;
mod overrides;
mod plan;
mod registry;
mod routes;

pub use fit::{MAX_PASSAGE_CHARS, fit_excerpts, shown_passage};
pub use futures::future::BoxFuture;
pub use interfaces::{
    Enhancer, EnhancerInput, Excerpt, Extractor, Fetched, Fetcher, Refiner, SourceInput, Stage,
    citations,
};
pub use kinds::{ExtractorKind, FetcherKind, Processor, RefinerKind};
pub use material::MaterialPreferences;
pub(crate) use overrides::requirement_of;
pub use overrides::{plan_for, sources_missing_refiners};
pub use plan::{ProcessingPreferences, SourcePlan, Switch};
pub use registry::Family;
pub use routes::{
    FETCHERS, Media, ROUTES, Route, Step, first_extractor, off, on, requirement, route,
};
