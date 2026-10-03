//! Which icon each kind of source is drawn with, so every list of files reads the same.
//! The kind itself is decided once, by `study_core::sniff`, when a source arrives. Kinds are
//! told apart by a monochrome glyph and a word, never by a colour (`DESIGN.md`, the No
//! Rainbow Rule).

use gpui_kit::assets::IconName;
use study_core::SourceKind;

/// How a source kind is drawn.
pub trait KindStyle {
    /// The icon a file of this kind is listed with.
    fn icon(self) -> IconName;
}

impl KindStyle for SourceKind {
    fn icon(self) -> IconName {
        match self {
            Self::Image => IconName::Images,
            Self::Pdf | Self::Text | Self::Document | Self::Note | Self::Web => IconName::FileText,
            Self::Audio => IconName::AudioLines,
            Self::Video => IconName::Video,
            Self::Spreadsheet => IconName::FileSpreadsheet,
            Self::Slides => IconName::Presentation,
            Self::Archive => IconName::FileArchive,
            Self::Link => IconName::Globe,
            Self::Code => IconName::FileCode,
            Self::Other => IconName::File,
        }
    }
}
