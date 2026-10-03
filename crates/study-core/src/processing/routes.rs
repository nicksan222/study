//! [`ROUTES`]: the one table of what happens to each kind of source. For every
//! [`SourceKind`] (narrowed by media type where it matters) it says which extractors read it,
//! in the order they are tried, which refiners rework what they read, which automatic stages
//! follow, and which material the user can make from it. Each [`Step`] is on or off by
//! default; the user's [`ProcessingPreferences`](super::ProcessingPreferences) override that.
//!
//! Conventions; the ones a test can hold are held by one below:
//!
//! - The first route that covers a source is its route, so a narrow route of a kind comes
//!   before a [`Media::Any`] one of the same kind.
//! - Switches are per kind of source: routes of one kind agree on the default of every
//!   processor they share, and on what their first extractor needs.
//! - A processor a kind should not offer at all is left out of its routes; one it offers
//!   but should not run until asked is listed with [`off`], so Settings shows its switch.
//! - Refiners run in list order, and the whitespace tidy comes last: one that joins text
//!   (such as across line breaks) must see the lines as they were read.
//! - A stage comes after the stage it [`builds on`](JobKind::builds_on).
//!
//! A source kind with no route is stored but never read. Links are brought in by the
//! fetchers in [`FETCHERS`], in order.

use crate::{ArtifactKind, JobKind, Requirement, SourceKind, is_raster, mime};

use super::{ExtractorKind, FetcherKind, Processor, RefinerKind};

/// Which media types of a kind a route covers.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Media {
    /// Every one.
    Any,
    /// Raster images Study decodes ([`is_raster`]), not SVG or HEIC.
    Raster,
    /// Only `text/*` ones, such as CSV.
    Text,
    /// Exactly these, as [`mime`] spells them.
    Only(&'static [&'static str]),
}

impl Media {
    /// Whether it covers `mime`, as [`sniff`](crate::sniff) spells it (its canonical form,
    /// compared exactly).
    pub fn covers(self, mime: &str) -> bool {
        match self {
            Self::Any => true,
            Self::Raster => is_raster(mime),
            Self::Text => mime.starts_with("text/"),
            Self::Only(mimes) => mimes.contains(&mime),
        }
    }
}

/// One processor in a route, and whether it runs unless the user says otherwise.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Step<K> {
    pub kind: K,
    pub on: bool,
}

/// `kind`, on by default.
pub const fn on<K>(kind: K) -> Step<K> {
    Step { kind, on: true }
}

/// `kind`, offered but off until the user turns it on.
pub const fn off<K>(kind: K) -> Step<K> {
    Step { kind, on: false }
}

/// What happens to sources of one kind.
#[derive(Clone, Copy, Debug)]
pub struct Route {
    pub source: SourceKind,
    pub media: Media,
    /// Tried in order; the next is tried when one finds the source unsupported.
    pub extractors: &'static [Step<ExtractorKind>],
    /// Run in order on what was read.
    pub refiners: &'static [Step<RefinerKind>],
    /// Run in order after reading, each as its own job; only kinds that
    /// [`follow reading`](JobKind::follows_reading).
    pub stages: &'static [Step<JobKind>],
    /// Material the user can make from these sources.
    pub enhancers: &'static [Step<ArtifactKind>],
}

impl Route {
    /// Whether it is the route of a source of this kind and media type, when no route
    /// before it in [`ROUTES`] is.
    pub fn covers(&self, kind: SourceKind, mime: &str) -> bool {
        self.source == kind && self.media.covers(mime)
    }

    /// Every processor it lists, with its default, family by family in route order.
    pub fn processors(&self) -> impl Iterator<Item = (Processor, bool)> + '_ {
        fn tagged<K: Copy>(
            steps: &[Step<K>],
            processor: fn(K) -> Processor,
        ) -> impl Iterator<Item = (Processor, bool)> + '_ {
            steps
                .iter()
                .map(move |step| (processor(step.kind), step.on))
        }
        tagged(self.extractors, Processor::Extractor)
            .chain(tagged(self.refiners, Processor::Refiner))
            .chain(tagged(self.stages, Processor::Stage))
            .chain(tagged(self.enhancers, Processor::Enhancer))
    }
}

// Profiles shared by several routes: a new processor that suits all of them is added once.

const TIDY: &[Step<RefinerKind>] = &[on(RefinerKind::Whitespace)];
/// What was heard is corrected by a language model before it is tidied.
const HEARD: &[Step<RefinerKind>] = &[on(RefinerKind::Transcript), on(RefinerKind::Whitespace)];
/// Indentation is meaning in code.
const CODE_REFINERS: &[Step<RefinerKind>] = &[off(RefinerKind::Whitespace)];
const SEARCHABLE: &[Step<JobKind>] = &[on(JobKind::Index), on(JobKind::Embed)];
/// Material for lessons: everything.
const LESSON_MATERIAL: &[Step<ArtifactKind>] = &[
    on(ArtifactKind::Notes),
    on(ArtifactKind::Flashcards),
    on(ArtifactKind::Diagram),
];
/// Material for pictures: a diagram off by default, as one picture rarely holds enough
/// for one.
const PICTURE_MATERIAL: &[Step<ArtifactKind>] = &[
    on(ArtifactKind::Notes),
    on(ArtifactKind::Flashcards),
    off(ArtifactKind::Diagram),
];
/// Material for reference more than lesson, such as code and tables: drilling off by
/// default, while a diagram of how the parts fit is useful.
const REFERENCE_MATERIAL: &[Step<ArtifactKind>] = &[
    on(ArtifactKind::Notes),
    off(ArtifactKind::Flashcards),
    on(ArtifactKind::Diagram),
];

/// What happens to each kind of source; the first route that covers a source is its route.
pub const ROUTES: &[Route] = &[
    Route {
        source: SourceKind::Audio,
        media: Media::Any,
        extractors: &[on(ExtractorKind::Transcription)],
        refiners: HEARD,
        stages: SEARCHABLE,
        enhancers: LESSON_MATERIAL,
    },
    Route {
        source: SourceKind::Video,
        media: Media::Any,
        extractors: &[on(ExtractorKind::Transcription)],
        refiners: HEARD,
        stages: SEARCHABLE,
        enhancers: LESSON_MATERIAL,
    },
    Route {
        source: SourceKind::Pdf,
        media: Media::Any,
        extractors: &[on(ExtractorKind::Vision)],
        refiners: TIDY,
        stages: SEARCHABLE,
        enhancers: LESSON_MATERIAL,
    },
    Route {
        source: SourceKind::Image,
        media: Media::Raster,
        extractors: &[on(ExtractorKind::Vision)],
        refiners: TIDY,
        stages: SEARCHABLE,
        enhancers: PICTURE_MATERIAL,
    },
    Route {
        source: SourceKind::Document,
        media: Media::Only(&[mime::DOCX]),
        extractors: &[on(ExtractorKind::Office)],
        refiners: TIDY,
        stages: SEARCHABLE,
        enhancers: LESSON_MATERIAL,
    },
    Route {
        source: SourceKind::Slides,
        media: Media::Only(&[mime::PPTX]),
        extractors: &[on(ExtractorKind::Office)],
        refiners: TIDY,
        stages: SEARCHABLE,
        enhancers: LESSON_MATERIAL,
    },
    Route {
        source: SourceKind::Web,
        media: Media::Any,
        extractors: &[on(ExtractorKind::Web)],
        refiners: TIDY,
        stages: SEARCHABLE,
        enhancers: LESSON_MATERIAL,
    },
    // HTML files are sniffed as code: read as pages, otherwise treated as code.
    Route {
        source: SourceKind::Code,
        media: Media::Only(&[mime::HTML]),
        extractors: &[on(ExtractorKind::Web)],
        refiners: CODE_REFINERS,
        stages: SEARCHABLE,
        enhancers: REFERENCE_MATERIAL,
    },
    Route {
        source: SourceKind::Code,
        media: Media::Any,
        extractors: &[on(ExtractorKind::Text)],
        refiners: CODE_REFINERS,
        stages: SEARCHABLE,
        enhancers: REFERENCE_MATERIAL,
    },
    Route {
        source: SourceKind::Text,
        media: Media::Any,
        extractors: &[on(ExtractorKind::Text)],
        refiners: TIDY,
        stages: SEARCHABLE,
        enhancers: LESSON_MATERIAL,
    },
    Route {
        source: SourceKind::Note,
        media: Media::Any,
        extractors: &[on(ExtractorKind::Text)],
        refiners: TIDY,
        stages: SEARCHABLE,
        enhancers: LESSON_MATERIAL,
    },
    Route {
        source: SourceKind::Spreadsheet,
        media: Media::Text,
        extractors: &[on(ExtractorKind::Text)],
        refiners: TIDY,
        stages: SEARCHABLE,
        enhancers: REFERENCE_MATERIAL,
    },
];

/// The fetchers links are brought in with, in the order they are tried. `Page` accepts
/// every web address, so it stays last.
pub const FETCHERS: &[FetcherKind] = &[FetcherKind::Video, FetcherKind::Page];

/// The route of a source of this kind and media type; `None` when Study does not read it.
pub fn route(kind: SourceKind, mime: &str) -> Option<&'static Route> {
    ROUTES.iter().find(|route| route.covers(kind, mime))
}

/// The extractor a source of this kind is read with first, by kind alone: the first of its
/// first route. Routes of one kind may start with different extractors (an HTML file is read
/// as a page, other code as text) but agree on what it needs, so this is what labels a read
/// and what [`requirement`] goes by. `None` when Study does not read the kind.
pub fn first_extractor(source: SourceKind) -> Option<ExtractorKind> {
    let route = ROUTES.iter().find(|route| route.source == source)?;
    Some(route.extractors.first()?.kind)
}

/// What a job of `kind` needs set up: for a read, what `extractor`, the one it is read with
/// first, needs; otherwise what the job kind needs. A job's own plan names its extractor
/// (see `requirement_of`); without one, [`first_extractor`] gives the default.
pub fn requirement(kind: JobKind, extractor: Option<ExtractorKind>) -> Option<Requirement> {
    match kind {
        JobKind::Extract => extractor?.requirement(),
        _ => kind.requirement(),
    }
}

#[cfg(test)]
mod tests;
