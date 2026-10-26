//! The kinds of processor, one [`text_enum!`](crate::text_enum!) per family, and what an
//! extractor or refiner requires set up. A kind is what the routes name and what documents record; the
//! implementation behind it lives in `study-pipeline`, one per kind.

use crate::{ArtifactKind, JobKind, Requirement};

crate::text_enum! {
    /// What reads a source into its document.
    pub enum ExtractorKind {
        /// Speech-to-text, on this computer.
        Transcription = "transcription",
        /// Pages seen by a language model that reads images: their text, and what their
        /// figures, charts, tables and handwriting show, written out for a student.
        Vision = "vision",
        /// DOCX and PPTX, read from their XML.
        Office = "office",
        /// HTML, by its sections.
        Web = "web",
        /// Plain text, by lines.
        Text = "text",
    }
}

impl ExtractorKind {
    /// What must be set up before it can read. Exhaustive, so a new kind must decide here.
    pub const fn requirement(self) -> Option<Requirement> {
        match self {
            Self::Transcription => Some(Requirement::Transcription),
            Self::Vision => Some(Requirement::LanguageModels),
            Self::Office | Self::Web | Self::Text => None,
        }
    }

    /// Whether a document it read can stand in for identical bytes from another source.
    /// Not a web page's: its anchors name the address it came from. Exhaustive, so a new
    /// kind must decide here.
    pub const fn reusable(self) -> bool {
        match self {
            Self::Web => false,
            Self::Transcription | Self::Vision | Self::Office | Self::Text => true,
        }
    }
}

crate::text_enum! {
    /// What reworks a document after it was read, before it is stored.
    pub enum RefinerKind {
        /// A language model corrects a transcript: misheard words, punctuation, terms.
        Transcript = "transcript",
        /// Trims blocks and drops empty ones.
        Whitespace = "whitespace",
    }
}

impl RefinerKind {
    /// What must be set up before it can rework a document. Exhaustive, so a new kind must
    /// decide here.
    pub const fn requirement(self) -> Option<Requirement> {
        match self {
            Self::Transcript => Some(Requirement::LanguageModels),
            Self::Whitespace => None,
        }
    }
}

crate::text_enum! {
    /// What brings in what a link holds.
    pub enum FetcherKind {
        /// A video's sound track, through `yt-dlp`.
        Video = "video",
        /// A web page's HTML.
        Page = "page",
    }
}

/// Any processor a route can switch on or off: what a user's override names.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum Processor {
    Extractor(ExtractorKind),
    Refiner(RefinerKind),
    /// An automatic stage after reading, such as [`JobKind::Embed`].
    Stage(JobKind),
    /// Material the user can ask for.
    Enhancer(ArtifactKind),
}

impl Processor {
    /// A stable code, such as `extractor.vision`: the processor part of a stored switch's key.
    pub(crate) fn code(self) -> String {
        match self {
            Self::Extractor(kind) => format!("extractor.{}", kind.code()),
            Self::Refiner(kind) => format!("refiner.{}", kind.code()),
            Self::Stage(kind) => format!("stage.{}", kind.code()),
            Self::Enhancer(kind) => format!("enhancer.{}", kind.code()),
        }
    }
}
