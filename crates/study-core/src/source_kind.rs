//! What kind of thing a source is. This is the only place in Study that decides it: sources
//! are sniffed once when they arrive, and extractors, jobs and the UI read the stored kind.
//!
//! To add a kind, in this file:
//! 1. add the variant to [`SourceKind`];
//! 2. map its media types in `from_mime`, and its extensions in `EXTENSIONS` (the one
//!    extension table in the workspace);
//! 3. if it is a zip container, such as an office format, add it to `generic_zip` in [`sniff`];
//! 4. give it a sample file name in the tests' `sample_name` (exhaustive, so the compiler asks);
//! 5. store its code as a row of `codes_source_kind`, as `db::migrations` says.

use std::path::Path;

/// Media types other code names, so the sniffer, the routes and the readers share one
/// spelling of each.
pub mod mime {
    /// A Word document.
    pub const DOCX: &str =
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    /// A PowerPoint deck.
    pub const PPTX: &str =
        "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    /// A web page.
    pub const HTML: &str = "text/html";
    /// Markdown text.
    pub const MARKDOWN: &str = "text/markdown";
    /// A list of addresses, one per line (RFC 2483): what a link holds before it is fetched.
    pub const URI_LIST: &str = "text/uri-list";
}

crate::text_enum! {
    /// The broad kind of a source, which decides how it is read and shown.
    pub enum SourceKind {
        Audio = "audio",
        Video = "video",
        Image = "image",
        Pdf = "pdf",
        /// Plain text and Markdown.
        Text = "text",
        /// Source code and markup, including HTML.
        Code = "code",
        /// Word-processor documents and e-books.
        Document = "document",
        Spreadsheet = "spreadsheet",
        Slides = "slides",
        Archive = "archive",
        /// A page fetched from a URL.
        Web = "web",
        /// A note typed in Study.
        Note = "note",
        /// An address added but not brought in yet; its Fetch job replaces it with what the
        /// address holds.
        Link = "link",
        Other = "other",
    }
}

crate::text_enum! {
    /// How a source arrived.
    pub enum SourceOrigin {
        /// Imported into the Library.
        Import = "import",
        /// Attached to a session message.
        Attachment = "attachment",
        /// Recorded with the microphone in a session.
        Recording = "recording",
        /// Typed in Study.
        Note = "note",
        /// Fetched from an address on the web.
        Web = "web",
    }
}

/// A sniffed kind and media type.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Detected {
    pub kind: SourceKind,
    pub mime: &'static str,
}

/// Raster formats Study decodes itself, for thumbnails and reading pages.
const RASTER: [&str; 6] = [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "image/bmp",
    "image/tiff",
];

impl Detected {
    const OTHER: Self = Self {
        kind: SourceKind::Other,
        mime: "application/octet-stream",
    };

    /// Whether this is a raster image Study can decode, as opposed to, say, SVG or HEIC.
    pub fn is_raster(self) -> bool {
        is_raster(self.mime)
    }
}

/// Whether a stored media type is a raster image Study can decode.
pub fn is_raster(mime: &str) -> bool {
    RASTER.contains(&mime)
}

/// Decides a source's kind from its file name and its first bytes (8 KiB is plenty).
///
/// Content wins over the name: a PNG called `notes.pdf` is an image. When the content has no
/// recognizable signature, the extension decides; when there is no known extension either,
/// readable UTF-8 is text and anything else is [`SourceKind::Other`].
pub fn sniff(name: &str, head: &[u8]) -> Detected {
    let by_name = by_extension(name);
    if let Some(found) = infer::get(head) {
        let by_content = from_mime(found.mime_type());
        // A zip container is also every office format and e-book; the name says which.
        let generic_zip = by_content.kind == SourceKind::Archive
            && found.mime_type() == "application/zip"
            && by_name.is_some_and(|named| {
                matches!(
                    named.kind,
                    SourceKind::Document | SourceKind::Spreadsheet | SourceKind::Slides
                )
            });
        if !generic_zip && by_content.kind != SourceKind::Other {
            return by_content;
        }
    }
    if let Some(named) = by_name {
        return named;
    }
    if looks_like_text(head) {
        return Detected {
            kind: SourceKind::Text,
            mime: "text/plain",
        };
    }
    Detected::OTHER
}

/// The kind a media type belongs to.
fn from_mime(mime: &'static str) -> Detected {
    let kind = match mime {
        "application/pdf" => SourceKind::Pdf,
        "application/msword"
        | mime::DOCX
        | "application/vnd.oasis.opendocument.text"
        | "application/rtf"
        | "application/epub+zip" => SourceKind::Document,
        "application/vnd.ms-excel"
        | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        | "application/vnd.oasis.opendocument.spreadsheet" => SourceKind::Spreadsheet,
        "application/vnd.ms-powerpoint"
        | mime::PPTX
        | "application/vnd.oasis.opendocument.presentation" => SourceKind::Slides,
        "application/zip"
        | "application/gzip"
        | "application/x-tar"
        | "application/x-7z-compressed"
        | "application/vnd.rar"
        | "application/x-bzip2"
        | "application/x-xz" => SourceKind::Archive,
        mime::HTML | "text/xml" | "application/xml" => SourceKind::Code,
        _ if mime.starts_with("image/") => SourceKind::Image,
        _ if mime.starts_with("audio/") => SourceKind::Audio,
        _ if mime.starts_with("video/") => SourceKind::Video,
        _ if mime.starts_with("text/") => SourceKind::Text,
        _ => SourceKind::Other,
    };
    Detected { kind, mime }
}

/// The one extension table: each extension with its kind and media type. A name's extension
/// finds its first row, for content without a signature (text formats, some audio) and for
/// telling zip-based formats apart; a media type finds its first row too, so the plain
/// extension of each comes first. Rows after the first for an extension are other spellings
/// of its media type, as `infer` reports them.
const EXTENSIONS: &[(&str, SourceKind, &str)] = {
    use SourceKind::*;
    &[
        ("jpg", Image, "image/jpeg"),
        ("jpeg", Image, "image/jpeg"),
        ("jfif", Image, "image/jpeg"),
        ("png", Image, "image/png"),
        ("webp", Image, "image/webp"),
        ("gif", Image, "image/gif"),
        ("bmp", Image, "image/bmp"),
        ("tif", Image, "image/tiff"),
        ("tiff", Image, "image/tiff"),
        ("svg", Image, "image/svg+xml"),
        ("heic", Image, "image/heic"),
        ("heic", Image, "image/heif"),
        ("avif", Image, "image/avif"),
        ("pdf", Pdf, "application/pdf"),
        ("txt", Text, "text/plain"),
        ("log", Text, "text/plain"),
        ("md", Text, mime::MARKDOWN),
        ("markdown", Text, mime::MARKDOWN),
        ("csv", Spreadsheet, "text/csv"),
        ("tsv", Spreadsheet, "text/tab-separated-values"),
        ("json", Code, "application/json"),
        ("toml", Code, "application/toml"),
        ("yaml", Code, "application/yaml"),
        ("yml", Code, "application/yaml"),
        ("xml", Code, "application/xml"),
        ("html", Code, mime::HTML),
        ("htm", Code, mime::HTML),
        ("css", Code, "text/css"),
        ("rs", Code, "text/plain"),
        ("py", Code, "text/plain"),
        ("js", Code, "text/plain"),
        ("ts", Code, "text/plain"),
        ("tsx", Code, "text/plain"),
        ("jsx", Code, "text/plain"),
        ("go", Code, "text/plain"),
        ("c", Code, "text/plain"),
        ("h", Code, "text/plain"),
        ("cpp", Code, "text/plain"),
        ("java", Code, "text/plain"),
        ("kt", Code, "text/plain"),
        ("swift", Code, "text/plain"),
        ("rb", Code, "text/plain"),
        ("sql", Code, "text/plain"),
        ("sh", Code, "text/plain"),
        ("ipynb", Code, "application/x-ipynb+json"),
        ("wav", Audio, "audio/wav"),
        ("wav", Audio, "audio/x-wav"),
        ("mp3", Audio, "audio/mpeg"),
        ("flac", Audio, "audio/flac"),
        ("flac", Audio, "audio/x-flac"),
        ("ogg", Audio, "audio/ogg"),
        ("oga", Audio, "audio/ogg"),
        ("opus", Audio, "audio/opus"),
        ("m4a", Audio, "audio/mp4"),
        ("m4a", Audio, "audio/m4a"),
        ("alac", Audio, "audio/mp4"),
        ("aac", Audio, "audio/aac"),
        ("aif", Audio, "audio/aiff"),
        ("aiff", Audio, "audio/aiff"),
        ("aiff", Audio, "audio/x-aiff"),
        ("caf", Audio, "audio/x-caf"),
        ("amr", Audio, "audio/amr"),
        ("wma", Audio, "audio/x-ms-wma"),
        ("mka", Audio, "audio/x-matroska"),
        ("mp4", Video, "video/mp4"),
        ("m4v", Video, "video/mp4"),
        ("m4v", Video, "video/x-m4v"),
        ("mov", Video, "video/quicktime"),
        ("mkv", Video, "video/x-matroska"),
        ("webm", Video, "video/webm"),
        ("avi", Video, "video/x-msvideo"),
        ("3gp", Video, "video/3gpp"),
        ("wmv", Video, "video/x-ms-wmv"),
        ("doc", Document, "application/msword"),
        ("docx", Document, mime::DOCX),
        ("odt", Document, "application/vnd.oasis.opendocument.text"),
        ("rtf", Document, "application/rtf"),
        ("epub", Document, "application/epub+zip"),
        ("pages", Document, "application/vnd.apple.pages"),
        ("xls", Spreadsheet, "application/vnd.ms-excel"),
        (
            "xlsx",
            Spreadsheet,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ),
        (
            "ods",
            Spreadsheet,
            "application/vnd.oasis.opendocument.spreadsheet",
        ),
        ("ppt", Slides, "application/vnd.ms-powerpoint"),
        ("pptx", Slides, mime::PPTX),
        (
            "odp",
            Slides,
            "application/vnd.oasis.opendocument.presentation",
        ),
        ("key", Slides, "application/vnd.apple.keynote"),
        ("zip", Archive, "application/zip"),
        ("tar", Archive, "application/x-tar"),
        ("gz", Archive, "application/gzip"),
        ("tgz", Archive, "application/gzip"),
        ("7z", Archive, "application/x-7z-compressed"),
        ("rar", Archive, "application/vnd.rar"),
        ("bz2", Archive, "application/x-bzip2"),
        ("xz", Archive, "application/x-xz"),
    ]
};

/// What the extension of `name` says it is, from [`EXTENSIONS`].
fn by_extension(name: &str) -> Option<Detected> {
    let extension = Path::new(name).extension()?.to_str()?.to_ascii_lowercase();
    EXTENSIONS
        .iter()
        .find(|&&(known, ..)| known == extension)
        .map(|&(_, kind, mime)| Detected { kind, mime })
}

/// The extension a source is handed to the system viewer under, or `None` when it must not
/// be: a safety check, not a way of deciding its kind. It is an allowlist by kind. Media and
/// documents get the plain extension of their media type from `EXTENSIONS`, and text of
/// any kind (code and markup included) opens as `.txt`, so nothing opens as a program or a
/// script. SVG is refused, as a browser runs its scripts, and so is any media type the table
/// does not know.
pub fn viewer_extension(kind: SourceKind, mime: &str) -> Option<&'static str> {
    use SourceKind::*;
    match kind {
        Text | Code | Note => Some("txt"),
        Audio | Video | Image | Pdf | Document | Spreadsheet | Slides => EXTENSIONS
            .iter()
            .find(|&&(_, known_kind, known)| known_kind == kind && known == mime)
            .map(|&(extension, ..)| extension)
            .filter(|&extension| extension != "svg"),
        Web | Archive | Link | Other => None,
    }
}

/// UTF-8 without NUL bytes. The last few bytes may be a character cut off by the sniff window.
fn looks_like_text(head: &[u8]) -> bool {
    if head.is_empty() || head.contains(&0) {
        return false;
    }
    match std::str::from_utf8(head) {
        Ok(_) => true,
        Err(error) => error.error_len().is_none() && head.len() - error.valid_up_to() < 4,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";
    const PDF: &[u8] = b"%PDF-1.7\n";
    const WAV: &[u8] = b"RIFF\x24\0\0\0WAVEfmt ";

    #[test]
    fn content_wins_over_the_name() {
        assert_eq!(
            sniff("notes.pdf", PNG),
            Detected {
                kind: SourceKind::Image,
                mime: "image/png"
            }
        );
        assert_eq!(sniff("scan", PDF).kind, SourceKind::Pdf);
        assert_eq!(sniff("lecture.bin", WAV).kind, SourceKind::Audio);
    }

    #[test]
    fn the_name_decides_when_content_has_no_signature() {
        assert_eq!(sniff("notes.md", b"# Title").mime, "text/markdown");
        assert_eq!(sniff("data.csv", b"a,b\n1,2").kind, SourceKind::Spreadsheet);
        assert_eq!(sniff("main.rs", b"fn main() {}").kind, SourceKind::Code);
        assert_eq!(sniff("Lecture.MP3", b"").kind, SourceKind::Audio);
    }

    #[test]
    fn office_files_are_not_mistaken_for_archives() {
        let zip = b"PK\x03\x04\x14\0\0\0\0\0";
        assert_eq!(sniff("slides.pptx", zip).kind, SourceKind::Slides);
        assert_eq!(sniff("bundle.zip", zip).kind, SourceKind::Archive);
        assert_eq!(sniff("mystery", zip).kind, SourceKind::Archive);
    }

    #[test]
    fn unknown_names_fall_back_to_the_content() {
        assert_eq!(
            sniff("README", "plain words, perché".as_bytes()).kind,
            SourceKind::Text
        );
        let cut = &"é".as_bytes()[..1];
        assert_eq!(
            sniff("README", &[b"ok ".as_slice(), cut].concat()).kind,
            SourceKind::Text
        );
        assert_eq!(sniff("blob", &[0, 1, 2, 3]), Detected::OTHER);
        assert_eq!(sniff("empty", b""), Detected::OTHER);
    }

    /// A file name `sniff` reads as `kind` from the name alone, or `None` for the kinds that
    /// come from how a source arrived rather than from its file.
    fn sample_name(kind: SourceKind) -> Option<&'static str> {
        use SourceKind::*;
        match kind {
            Audio => Some("a.mp3"),
            Video => Some("a.mp4"),
            Image => Some("a.png"),
            Pdf => Some("a.pdf"),
            Text => Some("a.txt"),
            Code => Some("a.rs"),
            Document => Some("a.docx"),
            Spreadsheet => Some("a.xlsx"),
            Slides => Some("a.pptx"),
            Archive => Some("a.zip"),
            // Web and Note come from `SourceOrigin`, Link from `Database::add_link`; none is
            // sniffed.
            Web | Note | Link => None,
            // The fallback, covered by `unknown_names_fall_back_to_the_content`.
            Other => None,
        }
    }

    #[test]
    fn every_file_kind_is_reachable_by_extension() {
        for kind in SourceKind::ALL {
            if let Some(name) = sample_name(*kind) {
                assert_eq!(
                    sniff(name, b"").kind,
                    *kind,
                    "`{name}` should sniff as {kind}"
                );
            }
        }
    }

    #[test]
    fn every_extension_mime_maps_back_to_its_kind() {
        for name in SourceKind::ALL.iter().filter_map(|kind| sample_name(*kind)) {
            let named = by_extension(name).unwrap();
            // `text/plain` code and `text/csv` sheets are only told apart by their names.
            if !named.mime.starts_with("text/") {
                assert_eq!(from_mime(named.mime).kind, named.kind, "{name}");
            }
        }
    }

    #[test]
    fn programs_and_scripts_never_reach_the_viewer_as_such() {
        let viewed = |name: &str, head: &[u8]| {
            let detected = sniff(name, head);
            viewer_extension(detected.kind, detected.mime)
        };
        assert_eq!(viewed("setup.exe", b"MZ\x90\0\x03\0\0\0"), None);
        assert_eq!(viewed("setup.exe", b""), None);
        assert_eq!(viewed("install.sh", b"#!/bin/sh\nrm -rf ~\n"), Some("txt"));
        assert_eq!(
            viewed("page.html", b"<script>alert(1)</script>"),
            Some("txt")
        );
        assert_eq!(viewed("notes.md", b"# Notes"), Some("txt"));
    }

    #[test]
    fn the_viewer_gets_the_plain_extension_of_a_kind_it_shows() {
        assert_eq!(
            viewer_extension(SourceKind::Pdf, "application/pdf"),
            Some("pdf")
        );
        assert_eq!(
            viewer_extension(SourceKind::Document, mime::DOCX),
            Some("docx")
        );
        assert_eq!(
            viewer_extension(SourceKind::Image, "image/jpeg"),
            Some("jpg")
        );
        // What `infer` calls a recording, not only what the table does.
        assert_eq!(
            viewer_extension(SourceKind::Audio, "audio/x-wav"),
            Some("wav")
        );
        assert_eq!(viewer_extension(SourceKind::Image, "image/svg+xml"), None);
        assert_eq!(
            viewer_extension(SourceKind::Archive, "application/zip"),
            None
        );
        assert_eq!(viewer_extension(SourceKind::Web, mime::HTML), None);
        assert_eq!(viewer_extension(SourceKind::Link, mime::URI_LIST), None);
        assert_eq!(viewer_extension(SourceKind::Audio, "audio/x-unknown"), None);
        assert_eq!(
            viewer_extension(SourceKind::Pdf, "image/jpeg"),
            None,
            "a mismatch"
        );
    }

    #[test]
    fn every_viewable_media_type_in_the_table_round_trips() {
        let mut checked = 0;
        for &(_, kind, mime) in EXTENSIONS {
            // Text of every kind opens as `.txt` instead.
            let Some(extension) = viewer_extension(kind, mime).filter(|_| kind != SourceKind::Code)
            else {
                continue;
            };
            let named = by_extension(&format!("a.{extension}")).unwrap();
            assert_eq!(named.kind, kind, "{mime} as .{extension}");
            checked += 1;
        }
        assert!(checked > 0);
        // Other spellings of a media type follow its canonical row, so a name still sniffs
        // as the canonical type.
        for (name, mime) in [
            ("a.wav", "audio/wav"),
            ("a.flac", "audio/flac"),
            ("a.m4a", "audio/mp4"),
            ("a.aiff", "audio/aiff"),
            ("a.heic", "image/heic"),
            ("a.m4v", "video/mp4"),
        ] {
            assert_eq!(by_extension(name).unwrap().mime, mime, "{name}");
        }
    }

    #[test]
    fn only_formats_study_decodes_are_raster() {
        assert!(sniff("a.png", PNG).is_raster());
        assert!(!sniff("a.svg", b"<svg/>").is_raster());
        assert!(!sniff("a.heic", b"").is_raster());
    }
}
