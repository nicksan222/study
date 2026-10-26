//! Explicit domain-to-protobuf mappings. No serialized domain object crosses the wire.
use super::{FromDomain, FromWire, IntoWire};
use study_core as c;
use study_core::db as d;
use study_rpc::v1 as p;

impl FromDomain<c::ProjectId> for p::ProjectId {
    fn from_domain(v: c::ProjectId) -> Self {
        Self { value: v.get() }
    }
}
impl FromDomain<c::SourceId> for p::SourceId {
    fn from_domain(v: c::SourceId) -> Self {
        Self { value: v.get() }
    }
}
impl FromDomain<c::SessionId> for p::SessionId {
    fn from_domain(v: c::SessionId) -> Self {
        Self { value: v.get() }
    }
}
impl FromDomain<c::MessageId> for p::MessageId {
    fn from_domain(v: c::MessageId) -> Self {
        Self { value: v.get() }
    }
}
impl FromDomain<c::PartId> for p::PartId {
    fn from_domain(v: c::PartId) -> Self {
        Self { value: v.get() }
    }
}
impl FromDomain<c::VersionId> for p::VersionId {
    fn from_domain(v: c::VersionId) -> Self {
        Self { value: v.get() }
    }
}
impl FromDomain<c::DocumentId> for p::DocumentId {
    fn from_domain(v: c::DocumentId) -> Self {
        Self { value: v.get() }
    }
}
impl FromDomain<c::JobId> for p::JobId {
    fn from_domain(v: c::JobId) -> Self {
        Self { value: v.get() }
    }
}
impl FromDomain<c::RecordingId> for p::RecordingId {
    fn from_domain(v: c::RecordingId) -> Self {
        Self { value: v.get() }
    }
}
impl FromDomain<c::ArtifactId> for p::ArtifactId {
    fn from_domain(v: c::ArtifactId) -> Self {
        Self { value: v.get() }
    }
}
impl FromDomain<c::CardId> for p::CardId {
    fn from_domain(v: c::CardId) -> Self {
        Self { value: v.get() }
    }
}
impl FromDomain<c::PracticeId> for p::PracticeId {
    fn from_domain(v: c::PracticeId) -> Self {
        Self { value: v.get() }
    }
}
impl FromDomain<c::QuestionId> for p::QuestionId {
    fn from_domain(v: c::QuestionId) -> Self {
        Self { value: v.get() }
    }
}
impl FromDomain<c::SourceKind> for p::SourceKind {
    fn from_domain(v: c::SourceKind) -> Self {
        match v {
            c::SourceKind::Audio => Self::Audio,
            c::SourceKind::Video => Self::Video,
            c::SourceKind::Image => Self::Image,
            c::SourceKind::Pdf => Self::Pdf,
            c::SourceKind::Text => Self::Text,
            c::SourceKind::Code => Self::Code,
            c::SourceKind::Document => Self::Document,
            c::SourceKind::Spreadsheet => Self::Spreadsheet,
            c::SourceKind::Slides => Self::Slides,
            c::SourceKind::Archive => Self::Archive,
            c::SourceKind::Web => Self::Web,
            c::SourceKind::Note => Self::Note,
            c::SourceKind::Link => Self::Link,
            c::SourceKind::Other => Self::Other,
        }
    }
}
impl FromWire<p::SourceKind> for c::SourceKind {
    type Error = tonic::Status;
    fn from_wire(v: p::SourceKind) -> Result<Self, Self::Error> {
        match v {
            p::SourceKind::Audio => Ok(Self::Audio),
            p::SourceKind::Video => Ok(Self::Video),
            p::SourceKind::Image => Ok(Self::Image),
            p::SourceKind::Pdf => Ok(Self::Pdf),
            p::SourceKind::Text => Ok(Self::Text),
            p::SourceKind::Code => Ok(Self::Code),
            p::SourceKind::Document => Ok(Self::Document),
            p::SourceKind::Spreadsheet => Ok(Self::Spreadsheet),
            p::SourceKind::Slides => Ok(Self::Slides),
            p::SourceKind::Archive => Ok(Self::Archive),
            p::SourceKind::Web => Ok(Self::Web),
            p::SourceKind::Note => Ok(Self::Note),
            p::SourceKind::Link => Ok(Self::Link),
            p::SourceKind::Other => Ok(Self::Other),
            p::SourceKind::Unspecified => Err(super::invalid("SourceKind is required")),
        }
    }
}
impl FromDomain<c::SourceOrigin> for p::SourceOrigin {
    fn from_domain(v: c::SourceOrigin) -> Self {
        match v {
            c::SourceOrigin::Import => Self::Import,
            c::SourceOrigin::Attachment => Self::Attachment,
            c::SourceOrigin::Recording => Self::Recording,
            c::SourceOrigin::Note => Self::Note,
            c::SourceOrigin::Web => Self::Web,
        }
    }
}
impl FromWire<p::SourceOrigin> for c::SourceOrigin {
    type Error = tonic::Status;
    fn from_wire(v: p::SourceOrigin) -> Result<Self, Self::Error> {
        match v {
            p::SourceOrigin::Import => Ok(Self::Import),
            p::SourceOrigin::Attachment => Ok(Self::Attachment),
            p::SourceOrigin::Recording => Ok(Self::Recording),
            p::SourceOrigin::Note => Ok(Self::Note),
            p::SourceOrigin::Web => Ok(Self::Web),
            p::SourceOrigin::Unspecified => Err(super::invalid("SourceOrigin is required")),
        }
    }
}
impl FromDomain<c::JobKind> for p::JobKind {
    fn from_domain(v: c::JobKind) -> Self {
        match v {
            c::JobKind::Extract => Self::Extract,
            c::JobKind::Index => Self::Index,
            c::JobKind::Embed => Self::Embed,
            c::JobKind::Title => Self::Title,
            c::JobKind::Reply => Self::Reply,
            c::JobKind::Artifact => Self::Artifact,
            c::JobKind::Question => Self::Question,
            c::JobKind::Grade => Self::Grade,
            c::JobKind::Fetch => Self::Fetch,
            c::JobKind::Rewrite => Self::Rewrite,
        }
    }
}
impl FromWire<p::JobKind> for c::JobKind {
    type Error = tonic::Status;
    fn from_wire(v: p::JobKind) -> Result<Self, Self::Error> {
        match v {
            p::JobKind::Extract => Ok(Self::Extract),
            p::JobKind::Index => Ok(Self::Index),
            p::JobKind::Embed => Ok(Self::Embed),
            p::JobKind::Title => Ok(Self::Title),
            p::JobKind::Reply => Ok(Self::Reply),
            p::JobKind::Artifact => Ok(Self::Artifact),
            p::JobKind::Question => Ok(Self::Question),
            p::JobKind::Grade => Ok(Self::Grade),
            p::JobKind::Fetch => Ok(Self::Fetch),
            p::JobKind::Rewrite => Ok(Self::Rewrite),
            p::JobKind::Unspecified => Err(super::invalid("JobKind is required")),
        }
    }
}
impl FromDomain<c::Requirement> for p::Requirement {
    fn from_domain(v: c::Requirement) -> Self {
        match v {
            c::Requirement::Transcription => Self::Transcription,
            c::Requirement::SearchModel => Self::SearchModel,
            c::Requirement::LanguageModels => Self::LanguageModels,
        }
    }
}
impl FromWire<p::Requirement> for c::Requirement {
    type Error = tonic::Status;
    fn from_wire(v: p::Requirement) -> Result<Self, Self::Error> {
        match v {
            p::Requirement::Transcription => Ok(Self::Transcription),
            p::Requirement::SearchModel => Ok(Self::SearchModel),
            p::Requirement::LanguageModels => Ok(Self::LanguageModels),
            p::Requirement::Unspecified => Err(super::invalid("Requirement is required")),
        }
    }
}
impl FromDomain<c::JobStatus> for p::JobStatus {
    fn from_domain(v: c::JobStatus) -> Self {
        match v {
            c::JobStatus::Blocked => Self::Blocked,
            c::JobStatus::Queued => Self::Queued,
            c::JobStatus::Waiting => Self::Waiting,
            c::JobStatus::Running => Self::Running,
            c::JobStatus::Succeeded => Self::Succeeded,
            c::JobStatus::Failed => Self::Failed,
            c::JobStatus::Cancelled => Self::Cancelled,
        }
    }
}
impl FromWire<p::JobStatus> for c::JobStatus {
    type Error = tonic::Status;
    fn from_wire(v: p::JobStatus) -> Result<Self, Self::Error> {
        match v {
            p::JobStatus::Blocked => Ok(Self::Blocked),
            p::JobStatus::Queued => Ok(Self::Queued),
            p::JobStatus::Waiting => Ok(Self::Waiting),
            p::JobStatus::Running => Ok(Self::Running),
            p::JobStatus::Succeeded => Ok(Self::Succeeded),
            p::JobStatus::Failed => Ok(Self::Failed),
            p::JobStatus::Cancelled => Ok(Self::Cancelled),
            p::JobStatus::Unspecified => Err(super::invalid("JobStatus is required")),
        }
    }
}
impl FromDomain<c::ArtifactKind> for p::ArtifactKind {
    fn from_domain(v: c::ArtifactKind) -> Self {
        match v {
            c::ArtifactKind::Flashcards => Self::Flashcards,
            c::ArtifactKind::Diagram => Self::Diagram,
        }
    }
}
impl FromWire<p::ArtifactKind> for c::ArtifactKind {
    type Error = tonic::Status;
    fn from_wire(v: p::ArtifactKind) -> Result<Self, Self::Error> {
        match v {
            p::ArtifactKind::Flashcards => Ok(Self::Flashcards),
            p::ArtifactKind::Diagram => Ok(Self::Diagram),
            p::ArtifactKind::Unspecified => Err(super::invalid("ArtifactKind is required")),
        }
    }
}
impl FromDomain<c::ArtifactStatus> for p::ArtifactStatus {
    fn from_domain(v: c::ArtifactStatus) -> Self {
        match v {
            c::ArtifactStatus::Pending => Self::Pending,
            c::ArtifactStatus::Writing => Self::Writing,
            c::ArtifactStatus::Complete => Self::Complete,
        }
    }
}
impl FromWire<p::ArtifactStatus> for c::ArtifactStatus {
    type Error = tonic::Status;
    fn from_wire(v: p::ArtifactStatus) -> Result<Self, Self::Error> {
        match v {
            p::ArtifactStatus::Pending => Ok(Self::Pending),
            p::ArtifactStatus::Writing => Ok(Self::Writing),
            p::ArtifactStatus::Complete => Ok(Self::Complete),
            p::ArtifactStatus::Unspecified => Err(super::invalid("ArtifactStatus is required")),
        }
    }
}
impl FromDomain<c::BlockKind> for p::BlockKind {
    fn from_domain(v: c::BlockKind) -> Self {
        match v {
            c::BlockKind::Paragraph => Self::Paragraph,
            c::BlockKind::Heading => Self::Heading,
            c::BlockKind::ListItem => Self::ListItem,
            c::BlockKind::Table => Self::Table,
            c::BlockKind::Code => Self::Code,
            c::BlockKind::Segment => Self::Segment,
        }
    }
}
impl FromWire<p::BlockKind> for c::BlockKind {
    type Error = tonic::Status;
    fn from_wire(v: p::BlockKind) -> Result<Self, Self::Error> {
        match v {
            p::BlockKind::Paragraph => Ok(Self::Paragraph),
            p::BlockKind::Heading => Ok(Self::Heading),
            p::BlockKind::ListItem => Ok(Self::ListItem),
            p::BlockKind::Table => Ok(Self::Table),
            p::BlockKind::Code => Ok(Self::Code),
            p::BlockKind::Segment => Ok(Self::Segment),
            p::BlockKind::Unspecified => Err(super::invalid("BlockKind is required")),
        }
    }
}
impl FromDomain<c::QuestionKind> for p::QuestionKind {
    fn from_domain(v: c::QuestionKind) -> Self {
        match v {
            c::QuestionKind::Choice => Self::Choice,
            c::QuestionKind::Open => Self::Open,
        }
    }
}
impl FromWire<p::QuestionKind> for c::QuestionKind {
    type Error = tonic::Status;
    fn from_wire(v: p::QuestionKind) -> Result<Self, Self::Error> {
        match v {
            p::QuestionKind::Choice => Ok(Self::Choice),
            p::QuestionKind::Open => Ok(Self::Open),
            p::QuestionKind::Unspecified => Err(super::invalid("QuestionKind is required")),
        }
    }
}
impl FromDomain<c::QuestionStatus> for p::QuestionStatus {
    fn from_domain(v: c::QuestionStatus) -> Self {
        match v {
            c::QuestionStatus::Pending => Self::Pending,
            c::QuestionStatus::Writing => Self::Writing,
            c::QuestionStatus::Ready => Self::Ready,
            c::QuestionStatus::Answered => Self::Answered,
            c::QuestionStatus::Graded => Self::Graded,
        }
    }
}
impl FromWire<p::QuestionStatus> for c::QuestionStatus {
    type Error = tonic::Status;
    fn from_wire(v: p::QuestionStatus) -> Result<Self, Self::Error> {
        match v {
            p::QuestionStatus::Pending => Ok(Self::Pending),
            p::QuestionStatus::Writing => Ok(Self::Writing),
            p::QuestionStatus::Ready => Ok(Self::Ready),
            p::QuestionStatus::Answered => Ok(Self::Answered),
            p::QuestionStatus::Graded => Ok(Self::Graded),
            p::QuestionStatus::Unspecified => Err(super::invalid("QuestionStatus is required")),
        }
    }
}
impl FromDomain<c::Verdict> for p::Verdict {
    fn from_domain(v: c::Verdict) -> Self {
        match v {
            c::Verdict::Correct => Self::Correct,
            c::Verdict::Partly => Self::Partly,
            c::Verdict::Incorrect => Self::Incorrect,
        }
    }
}
impl FromWire<p::Verdict> for c::Verdict {
    type Error = tonic::Status;
    fn from_wire(v: p::Verdict) -> Result<Self, Self::Error> {
        match v {
            p::Verdict::Correct => Ok(Self::Correct),
            p::Verdict::Partly => Ok(Self::Partly),
            p::Verdict::Incorrect => Ok(Self::Incorrect),
            p::Verdict::Unspecified => Err(super::invalid("Verdict is required")),
        }
    }
}
impl FromDomain<c::Language> for p::Language {
    fn from_domain(v: c::Language) -> Self {
        match v {
            c::Language::English => Self::English,
            c::Language::Italian => Self::Italian,
        }
    }
}
impl FromWire<p::Language> for c::Language {
    type Error = tonic::Status;
    fn from_wire(v: p::Language) -> Result<Self, Self::Error> {
        match v {
            p::Language::English => Ok(Self::English),
            p::Language::Italian => Ok(Self::Italian),
            p::Language::Unspecified => Err(super::invalid("Language is required")),
        }
    }
}
impl FromDomain<c::ErrorKind> for p::ErrorKind {
    fn from_domain(v: c::ErrorKind) -> Self {
        match v {
            c::ErrorKind::Transient => Self::Transient,
            c::ErrorKind::RateLimited => Self::RateLimited,
            c::ErrorKind::Auth => Self::Auth,
            c::ErrorKind::Config => Self::Config,
            c::ErrorKind::ModelUnavailable => Self::ModelUnavailable,
            c::ErrorKind::Unsupported => Self::Unsupported,
            c::ErrorKind::InvalidInput => Self::InvalidInput,
            c::ErrorKind::NotEnough => Self::NotEnough,
            c::ErrorKind::NotFound => Self::NotFound,
            c::ErrorKind::Cancelled => Self::Cancelled,
            c::ErrorKind::Internal => Self::Internal,
        }
    }
}
impl FromWire<p::ErrorKind> for c::ErrorKind {
    type Error = tonic::Status;
    fn from_wire(v: p::ErrorKind) -> Result<Self, Self::Error> {
        match v {
            p::ErrorKind::Transient => Ok(Self::Transient),
            p::ErrorKind::RateLimited => Ok(Self::RateLimited),
            p::ErrorKind::Auth => Ok(Self::Auth),
            p::ErrorKind::Config => Ok(Self::Config),
            p::ErrorKind::ModelUnavailable => Ok(Self::ModelUnavailable),
            p::ErrorKind::Unsupported => Ok(Self::Unsupported),
            p::ErrorKind::InvalidInput => Ok(Self::InvalidInput),
            p::ErrorKind::NotEnough => Ok(Self::NotEnough),
            p::ErrorKind::NotFound => Ok(Self::NotFound),
            p::ErrorKind::Cancelled => Ok(Self::Cancelled),
            p::ErrorKind::Internal => Ok(Self::Internal),
            p::ErrorKind::Unspecified => Err(super::invalid("ErrorKind is required")),
        }
    }
}
impl FromDomain<c::processing::ExtractorKind> for p::ExtractorKind {
    fn from_domain(v: c::processing::ExtractorKind) -> Self {
        match v {
            c::processing::ExtractorKind::Transcription => Self::Transcription,
            c::processing::ExtractorKind::Vision => Self::Vision,
            c::processing::ExtractorKind::Office => Self::Office,
            c::processing::ExtractorKind::Web => Self::Web,
            c::processing::ExtractorKind::Text => Self::Text,
        }
    }
}
impl FromWire<p::ExtractorKind> for c::processing::ExtractorKind {
    type Error = tonic::Status;
    fn from_wire(v: p::ExtractorKind) -> Result<Self, Self::Error> {
        match v {
            p::ExtractorKind::Transcription => Ok(Self::Transcription),
            p::ExtractorKind::Vision => Ok(Self::Vision),
            p::ExtractorKind::Office => Ok(Self::Office),
            p::ExtractorKind::Web => Ok(Self::Web),
            p::ExtractorKind::Text => Ok(Self::Text),
            p::ExtractorKind::Unspecified => Err(super::invalid("ExtractorKind is required")),
        }
    }
}
impl FromDomain<c::processing::RefinerKind> for p::RefinerKind {
    fn from_domain(v: c::processing::RefinerKind) -> Self {
        match v {
            c::processing::RefinerKind::Transcript => Self::Transcript,
            c::processing::RefinerKind::Whitespace => Self::Whitespace,
        }
    }
}
impl FromWire<p::RefinerKind> for c::processing::RefinerKind {
    type Error = tonic::Status;
    fn from_wire(v: p::RefinerKind) -> Result<Self, Self::Error> {
        match v {
            p::RefinerKind::Transcript => Ok(Self::Transcript),
            p::RefinerKind::Whitespace => Ok(Self::Whitespace),
            p::RefinerKind::Unspecified => Err(super::invalid("RefinerKind is required")),
        }
    }
}
impl FromDomain<c::processing::FetcherKind> for p::FetcherKind {
    fn from_domain(v: c::processing::FetcherKind) -> Self {
        match v {
            c::processing::FetcherKind::Video => Self::Video,
            c::processing::FetcherKind::Page => Self::Page,
        }
    }
}
impl FromWire<p::FetcherKind> for c::processing::FetcherKind {
    type Error = tonic::Status;
    fn from_wire(v: p::FetcherKind) -> Result<Self, Self::Error> {
        match v {
            p::FetcherKind::Video => Ok(Self::Video),
            p::FetcherKind::Page => Ok(Self::Page),
            p::FetcherKind::Unspecified => Err(super::invalid("FetcherKind is required")),
        }
    }
}
impl FromDomain<d::TitleSource> for p::TitleSource {
    fn from_domain(v: d::TitleSource) -> Self {
        match v {
            d::TitleSource::Provisional => Self::Provisional,
            d::TitleSource::Generated => Self::Generated,
            d::TitleSource::User => Self::User,
        }
    }
}
impl FromWire<p::TitleSource> for d::TitleSource {
    type Error = tonic::Status;
    fn from_wire(v: p::TitleSource) -> Result<Self, Self::Error> {
        match v {
            p::TitleSource::Provisional => Ok(Self::Provisional),
            p::TitleSource::Generated => Ok(Self::Generated),
            p::TitleSource::User => Ok(Self::User),
            p::TitleSource::Unspecified => Err(super::invalid("TitleSource is required")),
        }
    }
}
impl FromDomain<d::MessageRole> for p::MessageRole {
    fn from_domain(v: d::MessageRole) -> Self {
        match v {
            d::MessageRole::User => Self::User,
            d::MessageRole::Assistant => Self::Assistant,
        }
    }
}
impl FromWire<p::MessageRole> for d::MessageRole {
    type Error = tonic::Status;
    fn from_wire(v: p::MessageRole) -> Result<Self, Self::Error> {
        match v {
            p::MessageRole::User => Ok(Self::User),
            p::MessageRole::Assistant => Ok(Self::Assistant),
            p::MessageRole::Unspecified => Err(super::invalid("MessageRole is required")),
        }
    }
}
impl FromDomain<d::MessageStatus> for p::MessageStatus {
    fn from_domain(v: d::MessageStatus) -> Self {
        match v {
            d::MessageStatus::Pending => Self::Pending,
            d::MessageStatus::Writing => Self::Writing,
            d::MessageStatus::Complete => Self::Complete,
        }
    }
}
impl FromWire<p::MessageStatus> for d::MessageStatus {
    type Error = tonic::Status;
    fn from_wire(v: p::MessageStatus) -> Result<Self, Self::Error> {
        match v {
            p::MessageStatus::Pending => Ok(Self::Pending),
            p::MessageStatus::Writing => Ok(Self::Writing),
            p::MessageStatus::Complete => Ok(Self::Complete),
            p::MessageStatus::Unspecified => Err(super::invalid("MessageStatus is required")),
        }
    }
}
impl FromDomain<d::VersionOrigin> for p::VersionOrigin {
    fn from_domain(v: d::VersionOrigin) -> Self {
        match v {
            d::VersionOrigin::Typed => Self::Typed,
            d::VersionOrigin::Edited => Self::Edited,
            d::VersionOrigin::Answer => Self::Answer,
            d::VersionOrigin::Improve => Self::Improve,
            d::VersionOrigin::Summarize => Self::Summarize,
            d::VersionOrigin::Instruction => Self::Instruction,
        }
    }
}
impl FromWire<p::VersionOrigin> for d::VersionOrigin {
    type Error = tonic::Status;
    fn from_wire(v: p::VersionOrigin) -> Result<Self, Self::Error> {
        match v {
            p::VersionOrigin::Typed => Ok(Self::Typed),
            p::VersionOrigin::Edited => Ok(Self::Edited),
            p::VersionOrigin::Answer => Ok(Self::Answer),
            p::VersionOrigin::Improve => Ok(Self::Improve),
            p::VersionOrigin::Summarize => Ok(Self::Summarize),
            p::VersionOrigin::Instruction => Ok(Self::Instruction),
            p::VersionOrigin::Unspecified => Err(super::invalid("VersionOrigin is required")),
        }
    }
}
impl FromDomain<d::SearchKind> for p::SearchKind {
    fn from_domain(v: d::SearchKind) -> Self {
        match v {
            d::SearchKind::Project => Self::Project,
            d::SearchKind::Session => Self::Session,
            d::SearchKind::Message => Self::Message,
            d::SearchKind::Source => Self::Source,
        }
    }
}
impl FromWire<p::SearchKind> for d::SearchKind {
    type Error = tonic::Status;
    fn from_wire(v: p::SearchKind) -> Result<Self, Self::Error> {
        match v {
            p::SearchKind::Project => Ok(Self::Project),
            p::SearchKind::Session => Ok(Self::Session),
            p::SearchKind::Message => Ok(Self::Message),
            p::SearchKind::Source => Ok(Self::Source),
            p::SearchKind::Unspecified => Err(super::invalid("SearchKind is required")),
        }
    }
}
impl FromDomain<c::Rating> for p::Rating {
    fn from_domain(v: c::Rating) -> Self {
        match v {
            c::Rating::Again => Self::Again,
            c::Rating::Hard => Self::Hard,
            c::Rating::Good => Self::Good,
            c::Rating::Easy => Self::Easy,
        }
    }
}
impl FromWire<p::Rating> for c::Rating {
    type Error = tonic::Status;
    fn from_wire(v: p::Rating) -> Result<Self, Self::Error> {
        match v {
            p::Rating::Again => Ok(Self::Again),
            p::Rating::Hard => Ok(Self::Hard),
            p::Rating::Good => Ok(Self::Good),
            p::Rating::Easy => Ok(Self::Easy),
            p::Rating::Unspecified => Err(super::invalid("Rating is required")),
        }
    }
}
impl FromDomain<c::Memory> for p::Memory {
    fn from_domain(v: c::Memory) -> Self {
        Self {
            stability: v.stability,
            difficulty: v.difficulty,
            reps: v.reps,
            lapses: v.lapses,
            last_review: v.last_review,
            due: v.due,
        }
    }
}
impl FromDomain<d::Project> for p::Project {
    fn from_domain(v: d::Project) -> Self {
        Self {
            id: Some(v.id.wire()),
            name: v.name,
            exam_on: v.exam_on.map(IntoWire::wire),
            created_at: v.created_at,
            updated_at: v.updated_at,
        }
    }
}
impl FromDomain<d::ChatSession> for p::ChatSession {
    fn from_domain(v: d::ChatSession) -> Self {
        Self {
            id: Some(v.id.wire()),
            project_id: Some(v.project_id.wire()),
            title: v.title,
            title_source: p::TitleSource::from_domain(v.title_source) as i32,
            created_at: v.created_at,
            updated_at: v.updated_at,
        }
    }
}
impl FromDomain<d::Source> for p::Source {
    fn from_domain(v: d::Source) -> Self {
        Self {
            id: Some(v.id.wire()),
            name: v.name,
            kind: p::SourceKind::from_domain(v.kind) as i32,
            mime: v.mime,
            origin: p::SourceOrigin::from_domain(v.origin) as i32,
            project_id: v.project_id.map(IntoWire::wire),
            project_name: v.project_name,
            size_bytes: v.size_bytes,
            sha256: v.sha256.to_vec(),
            uri: v.uri,
            created_at: v.created_at,
        }
    }
}
impl FromDomain<c::Document> for p::Document {
    fn from_domain(v: c::Document) -> Self {
        Self {
            blocks: v.blocks.into_iter().map(IntoWire::wire).collect(),
            meta: Some(v.meta.wire()),
        }
    }
}
impl FromDomain<c::Block> for p::Block {
    fn from_domain(v: c::Block) -> Self {
        Self {
            kind: p::BlockKind::from_domain(v.kind) as i32,
            text: v.text,
            anchor: Some(v.anchor.wire()),
        }
    }
}
impl FromDomain<c::DocumentMeta> for p::DocumentMeta {
    fn from_domain(v: c::DocumentMeta) -> Self {
        Self {
            extractor: v.extractor.map(|v| p::ExtractorKind::from_domain(v) as i32),
            extractor_version: v.extractor_version,
            provider: v.provider,
            duration_ms: v.duration_ms,
            page_count: v.page_count,
            refiners: v.refiners.into_iter().map(IntoWire::wire).collect(),
            waiting_for: v
                .waiting_for
                .into_iter()
                .map(|v| p::RefinerKind::from_domain(v) as i32)
                .collect(),
            corrected: v.corrected,
        }
    }
}
impl FromDomain<c::Stamp> for p::Stamp {
    fn from_domain(v: c::Stamp) -> Self {
        Self {
            refiner: p::RefinerKind::from_domain(v.refiner) as i32,
            version: v.version,
        }
    }
}
impl FromDomain<c::Citation> for p::Citation {
    fn from_domain(v: c::Citation) -> Self {
        Self {
            marker: v.marker,
            source_id: v.source_id.map(IntoWire::wire),
            source_name: v.source_name,
            anchor: Some(v.anchor.wire()),
            quote: v.quote,
        }
    }
}
impl FromDomain<d::ChatMessage> for p::ChatMessage {
    fn from_domain(v: d::ChatMessage) -> Self {
        Self {
            id: Some(v.id.wire()),
            session_id: Some(v.session_id.wire()),
            role: p::MessageRole::from_domain(v.role) as i32,
            status: p::MessageStatus::from_domain(v.status) as i32,
            reply_to: v.reply_to.map(IntoWire::wire),
            thread_root: v.thread_root.map(IntoWire::wire),
            recording_ms: v.recording_ms,
            recorded_in: v.recorded_in.map(IntoWire::wire),
            created_at: v.created_at,
            parts: v.parts.into_iter().map(IntoWire::wire).collect(),
            versions: v.versions.into_iter().map(IntoWire::wire).collect(),
            active_version: v.active_version.map(IntoWire::wire),
            citations: v.citations.into_iter().map(IntoWire::wire).collect(),
            reply: v.reply.map(IntoWire::wire),
        }
    }
}
impl FromDomain<d::MessagePart> for p::MessagePart {
    fn from_domain(v: d::MessagePart) -> Self {
        Self {
            id: Some(v.id.wire()),
            content: Some(v.content.wire()),
            jobs: v.jobs.into_iter().map(IntoWire::wire).collect(),
            document: v.document.map(IntoWire::wire),
            thread: Some(v.thread.wire()),
        }
    }
}
impl FromDomain<d::PartContent> for p::PartContent {
    fn from_domain(v: d::PartContent) -> Self {
        Self {
            source_id: v.source_id.map(IntoWire::wire),
            name: v.name,
            kind: p::SourceKind::from_domain(v.kind) as i32,
        }
    }
}
impl FromDomain<d::ThreadSummary> for p::ThreadSummary {
    fn from_domain(v: d::ThreadSummary) -> Self {
        Self {
            replies: v.replies as u64,
            last_reply_at: v.last_reply_at,
        }
    }
}
impl FromDomain<d::Thread> for p::Thread {
    fn from_domain(v: d::Thread) -> Self {
        Self {
            session_id: Some(v.session_id.wire()),
            message_id: Some(v.message_id.wire()),
            opened_at: v.opened_at,
            root: Some(v.root.wire()),
            replies: v.replies.into_iter().map(IntoWire::wire).collect(),
        }
    }
}
impl FromDomain<d::MessageVersion> for p::MessageVersion {
    fn from_domain(v: d::MessageVersion) -> Self {
        Self {
            id: Some(v.id.wire()),
            number: v.number,
            origin: p::VersionOrigin::from_domain(v.origin) as i32,
            instruction: v.instruction,
            status: p::MessageStatus::from_domain(v.status) as i32,
            text: v.text,
            based_on: v.based_on.map(IntoWire::wire),
            created_at: v.created_at,
        }
    }
}
impl FromDomain<d::Recording> for p::Recording {
    fn from_domain(v: d::Recording) -> Self {
        Self {
            id: Some(v.id.wire()),
            session_id: Some(v.session_id.wire()),
            started_at: v.started_at,
            updated_at: v.updated_at,
            samples: v.samples,
        }
    }
}
impl FromDomain<d::Artifact> for p::Artifact {
    fn from_domain(v: d::Artifact) -> Self {
        Self {
            id: Some(v.id.wire()),
            project_id: Some(v.project_id.wire()),
            kind: p::ArtifactKind::from_domain(v.kind) as i32,
            title: v.title,
            notes: v.notes,
            status: p::ArtifactStatus::from_domain(v.status) as i32,
            body: v.body.map(IntoWire::wire),
            sources: v.sources.into_iter().map(IntoWire::wire).collect(),
            citations: v.citations.into_iter().map(IntoWire::wire).collect(),
            job: v.job.map(IntoWire::wire),
            mistakes: v.mistakes,
            practice_id: v.practice_id.map(IntoWire::wire),
            created_at: v.created_at,
            updated_at: v.updated_at,
        }
    }
}
impl FromDomain<d::Material> for p::Material {
    fn from_domain(v: d::Material) -> Self {
        Self {
            current: v.current.map(IntoWire::wire),
            update: v.update.map(IntoWire::wire),
        }
    }
}
impl FromDomain<d::Changes> for p::Changes {
    fn from_domain(v: d::Changes) -> Self {
        Self {
            files: v.files as u64,
            notes: v.notes as u64,
        }
    }
}
impl FromDomain<c::Flashcard> for p::Flashcard {
    fn from_domain(v: c::Flashcard) -> Self {
        Self {
            front: v.front,
            back: v.back,
            cites: v.cites,
        }
    }
}
impl FromDomain<d::Card> for p::Card {
    fn from_domain(v: d::Card) -> Self {
        Self {
            id: Some(v.id.wire()),
            artifact_id: Some(v.artifact_id.wire()),
            front: v.front,
            back: v.back,
            memory: Some(v.memory.wire()),
        }
    }
}
impl FromDomain<d::DueCard> for p::DueCard {
    fn from_domain(v: d::DueCard) -> Self {
        Self {
            card: Some(v.card.wire()),
            artifact_title: v.artifact_title,
            project_id: Some(v.project_id.wire()),
        }
    }
}
impl FromDomain<d::PracticeScore> for p::PracticeScore {
    fn from_domain(v: d::PracticeScore) -> Self {
        Self {
            asked: v.asked,
            answered: v.answered,
            correct: v.correct,
            partly: v.partly,
            incorrect: v.incorrect,
        }
    }
}
impl FromDomain<d::PracticeSummary> for p::PracticeSummary {
    fn from_domain(v: d::PracticeSummary) -> Self {
        Self {
            id: Some(v.id.wire()),
            project_id: Some(v.project_id.wire()),
            score: Some(v.score.wire()),
            created_at: v.created_at,
            updated_at: v.updated_at,
        }
    }
}
impl FromDomain<d::Practice> for p::Practice {
    fn from_domain(v: d::Practice) -> Self {
        Self {
            id: Some(v.id.wire()),
            project_id: Some(v.project_id.wire()),
            score: Some(v.score.wire()),
            questions: v.questions.into_iter().map(IntoWire::wire).collect(),
            created_at: v.created_at,
            updated_at: v.updated_at,
        }
    }
}
impl FromDomain<d::PracticeQuestion> for p::PracticeQuestion {
    fn from_domain(v: d::PracticeQuestion) -> Self {
        Self {
            id: Some(v.id.wire()),
            practice_id: Some(v.practice_id.wire()),
            ordinal: v.ordinal,
            kind: p::QuestionKind::from_domain(v.kind) as i32,
            status: p::QuestionStatus::from_domain(v.status) as i32,
            written: v.written.map(IntoWire::wire),
            answer: v.answer.map(IntoWire::wire),
            verdict: v.verdict.map(|v| p::Verdict::from_domain(v) as i32),
            feedback: v.feedback,
            citations: v.citations.into_iter().map(IntoWire::wire).collect(),
            job: v.job.map(IntoWire::wire),
            created_at: v.created_at,
            answered_at: v.answered_at,
            graded_at: v.graded_at,
        }
    }
}
impl FromDomain<c::WrittenQuestion> for p::WrittenQuestion {
    fn from_domain(v: c::WrittenQuestion) -> Self {
        Self {
            gist: v.gist,
            body: Some(v.body.wire()),
        }
    }
}
impl FromDomain<d::JobOverview> for p::JobOverview {
    fn from_domain(v: d::JobOverview) -> Self {
        Self {
            job: Some(v.job.wire()),
            subject: v.subject,
            source_kind: v.source_kind.map(|v| p::SourceKind::from_domain(v) as i32),
            source_id: v.source_id.map(IntoWire::wire),
            session_id: v.session_id.map(IntoWire::wire),
            session_title: v.session_title,
            project_id: v.project_id.map(IntoWire::wire),
            project_name: v.project_name,
            practice_id: v.practice_id.map(IntoWire::wire),
        }
    }
}
impl FromDomain<d::SearchHit> for p::SearchHit {
    fn from_domain(v: d::SearchHit) -> Self {
        Self {
            kind: p::SearchKind::from_domain(v.kind) as i32,
            title: v.title,
            context: v.context,
            excerpt: v.excerpt,
            file_kind: v.file_kind.map(|v| p::SourceKind::from_domain(v) as i32),
            at: v.at,
            target: Some(v.target.wire()),
        }
    }
}
impl FromDomain<crate::search::SearchResults> for p::SearchResults {
    fn from_domain(v: crate::search::SearchResults) -> Self {
        Self {
            hits: v.hits.into_iter().map(IntoWire::wire).collect(),
            semantic: v.semantic,
        }
    }
}
impl FromDomain<study_ai::hardware::Report> for p::Report {
    fn from_domain(v: study_ai::hardware::Report) -> Self {
        let plan = Some(v.plan().wire());
        Self {
            plan,
            system: Some(v.system.wire()),
            compute: Some(v.compute.wire()),
            elapsed_secs: v.elapsed_secs,
        }
    }
}
impl FromDomain<study_ai::hardware::SystemInfo> for p::SystemInfo {
    fn from_domain(v: study_ai::hardware::SystemInfo) -> Self {
        Self {
            os: v.os,
            os_version: v.os_version,
            arch: v.arch,
            cpu_brand: v.cpu_brand,
            physical_cores: v.physical_cores.map(|v| v as u64),
            logical_cores: v.logical_cores as u64,
            total_memory_bytes: v.total_memory_bytes,
            available_memory_bytes: v.available_memory_bytes,
            simd: v.simd,
        }
    }
}
impl FromDomain<study_ai::hardware::ComputeScore> for p::ComputeScore {
    fn from_domain(v: study_ai::hardware::ComputeScore) -> Self {
        Self {
            matmul_gflops: v.matmul_gflops,
            memory_bandwidth_gbps: v.memory_bandwidth_gbps,
        }
    }
}
impl FromDomain<c::Day> for p::Day {
    fn from_domain(v: c::Day) -> Self {
        Self {
            year: v.year(),
            month: v.month(),
            day: v.day(),
        }
    }
}
impl FromWire<p::Day> for c::Day {
    type Error = tonic::Status;
    fn from_wire(v: p::Day) -> Result<Self, Self::Error> {
        Self::new(v.year, v.month, v.day).ok_or_else(|| super::invalid("invalid calendar day"))
    }
}
impl FromDomain<c::Anchor> for p::Anchor {
    fn from_domain(v: c::Anchor) -> Self {
        use p::anchor::Kind;
        Self {
            kind: Some(match v {
                c::Anchor::Time { start_ms, end_ms } => {
                    Kind::Time(p::TimeAnchor { start_ms, end_ms })
                }
                c::Anchor::Page { page } => Kind::Page(page),
                c::Anchor::Text {
                    line_start,
                    line_end,
                    start,
                    end,
                } => Kind::Text(p::TextAnchor {
                    line_start,
                    line_end,
                    start,
                    end,
                }),
                c::Anchor::Slide { index } => Kind::Slide(index),
                c::Anchor::Paragraph { index } => Kind::Paragraph(index),
                c::Anchor::Url { url, fragment } => Kind::Url(p::UrlAnchor { url, fragment }),
            }),
        }
    }
}
impl FromDomain<c::ArtifactBody> for p::ArtifactBody {
    fn from_domain(v: c::ArtifactBody) -> Self {
        Self {
            kind: Some(match v {
                c::ArtifactBody::Flashcards { cards } => {
                    p::artifact_body::Kind::Flashcards(p::Flashcards {
                        cards: cards.into_iter().map(IntoWire::wire).collect(),
                    })
                }
                c::ArtifactBody::Diagram { mermaid } => p::artifact_body::Kind::Mermaid(mermaid),
            }),
        }
    }
}
impl FromDomain<c::PracticeBody> for p::PracticeBody {
    fn from_domain(v: c::PracticeBody) -> Self {
        Self {
            kind: Some(match v {
                c::PracticeBody::Choice {
                    question,
                    choices,
                    answer,
                    explanation,
                    cites,
                } => p::practice_body::Kind::Choice(p::ChoiceQuestion {
                    question,
                    choices,
                    answer,
                    explanation,
                    cites,
                }),
                c::PracticeBody::Open {
                    question,
                    reference,
                    cites,
                } => p::practice_body::Kind::Open(p::OpenQuestion {
                    question,
                    reference,
                    cites,
                }),
            }),
        }
    }
}
impl FromDomain<c::PracticeAnswer> for p::PracticeAnswer {
    fn from_domain(v: c::PracticeAnswer) -> Self {
        Self {
            kind: Some(match v {
                c::PracticeAnswer::Choice(v) => p::practice_answer::Kind::Choice(v),
                c::PracticeAnswer::Open(v) => p::practice_answer::Kind::Open(v),
            }),
        }
    }
}
impl FromWire<p::PracticeAnswer> for c::PracticeAnswer {
    type Error = tonic::Status;
    fn from_wire(v: p::PracticeAnswer) -> Result<Self, Self::Error> {
        Ok(match super::required(v.kind, "answer.kind")? {
            p::practice_answer::Kind::Choice(v) => Self::Choice(v),
            p::practice_answer::Kind::Open(v) => Self::Open(v),
        })
    }
}
impl FromDomain<d::Asked> for p::Asked {
    fn from_domain(v: d::Asked) -> Self {
        Self {
            result: Some(match v {
                d::Asked::Queued(v) => p::asked::Result::Queued(v.wire()),
                d::Asked::Busy => p::asked::Result::Busy(p::Empty {}),
                d::Asked::Unavailable => p::asked::Result::Unavailable(p::Empty {}),
            }),
        }
    }
}
impl FromDomain<d::Answered> for p::Answered {
    fn from_domain(v: d::Answered) -> Self {
        Self {
            result: Some(match v {
                d::Answered::Graded(v) => {
                    p::answered::Result::Graded(p::Verdict::from_domain(v) as i32)
                }
                d::Answered::Grading(v) => p::answered::Result::Grading(v.wire()),
            }),
        }
    }
}
impl FromDomain<d::JobTarget> for p::JobTarget {
    fn from_domain(v: d::JobTarget) -> Self {
        Self {
            kind: Some(match v {
                d::JobTarget::Source(v) => p::job_target::Kind::Source(v.wire()),
                d::JobTarget::Document(v) => p::job_target::Kind::Document(v.wire()),
                d::JobTarget::Session(v) => p::job_target::Kind::Session(v.wire()),
                d::JobTarget::Message(v) => p::job_target::Kind::Message(v.wire()),
                d::JobTarget::Artifact(v) => p::job_target::Kind::Artifact(v.wire()),
                d::JobTarget::Question(v) => p::job_target::Kind::Question(v.wire()),
            }),
        }
    }
}
impl FromDomain<d::Job> for p::Job {
    fn from_domain(v: d::Job) -> Self {
        Self {
            id: Some(v.id.wire()),
            kind: p::JobKind::from_domain(v.kind) as i32,
            target: Some(v.target.wire()),
            args: v.args.map(|v| p::JobOptions {
                force: v.get("force").and_then(|v| v.as_bool()).unwrap_or(false),
            }),
            status: p::JobStatus::from_domain(v.status) as i32,
            attempts: v.attempts,
            error_kind: v.error_kind.map(|v| p::ErrorKind::from_domain(v) as i32),
            error: v.error,
            created_at: v.created_at,
            updated_at: v.updated_at,
            started_at: v.started_at,
            finished_at: v.finished_at,
            waiting_for: v.waiting_for.map(|v| p::Requirement::from_domain(v) as i32),
            needs: v.needs.map(|v| p::Requirement::from_domain(v) as i32),
        }
    }
}
impl FromDomain<d::SearchTarget> for p::SearchTarget {
    fn from_domain(v: d::SearchTarget) -> Self {
        Self {
            kind: Some(match v {
                d::SearchTarget::Project(v) => p::search_target::Kind::Project(v.wire()),
                d::SearchTarget::Session {
                    project_id,
                    session_id,
                } => p::search_target::Kind::Session(p::SessionTarget {
                    project_id: Some(project_id.wire()),
                    session_id: Some(session_id.wire()),
                }),
                d::SearchTarget::Source {
                    source_id,
                    anchor,
                    session_id,
                } => p::search_target::Kind::Source(p::SourceTarget {
                    source_id: Some(source_id.wire()),
                    anchor: anchor.map(IntoWire::wire),
                    session_id: session_id.map(IntoWire::wire),
                }),
            }),
        }
    }
}
impl FromDomain<crate::Preview> for p::Preview {
    fn from_domain(v: crate::Preview) -> Self {
        Self {
            kind: Some(match v {
                crate::Preview::Picture(v) => p::preview::Kind::Picture(v),
                crate::Preview::Text(v) => p::preview::Kind::Text(v),
                crate::Preview::Unavailable => p::preview::Kind::Unavailable(p::Empty {}),
            }),
        }
    }
}
impl FromDomain<c::processing::Processor> for p::Processor {
    fn from_domain(v: c::processing::Processor) -> Self {
        Self {
            kind: Some(match v {
                c::processing::Processor::Extractor(v) => {
                    p::processor::Kind::Extractor(p::ExtractorKind::from_domain(v) as i32)
                }
                c::processing::Processor::Refiner(v) => {
                    p::processor::Kind::Refiner(p::RefinerKind::from_domain(v) as i32)
                }
                c::processing::Processor::Stage(v) => {
                    p::processor::Kind::Stage(p::JobKind::from_domain(v) as i32)
                }
                c::processing::Processor::Enhancer(v) => {
                    p::processor::Kind::Enhancer(p::ArtifactKind::from_domain(v) as i32)
                }
            }),
        }
    }
}
impl FromWire<p::Processor> for c::processing::Processor {
    type Error = tonic::Status;
    fn from_wire(v: p::Processor) -> Result<Self, Self::Error> {
        Ok(match super::required(v.kind, "processor.kind")? {
            p::processor::Kind::Extractor(v) => Self::Extractor(super::enumeration::<
                p::ExtractorKind,
                c::processing::ExtractorKind,
            >(v)?),
            p::processor::Kind::Refiner(v) => Self::Refiner(super::enumeration::<
                p::RefinerKind,
                c::processing::RefinerKind,
            >(v)?),
            p::processor::Kind::Stage(v) => {
                Self::Stage(super::enumeration::<p::JobKind, c::JobKind>(v)?)
            }
            p::processor::Kind::Enhancer(v) => {
                Self::Enhancer(super::enumeration::<p::ArtifactKind, c::ArtifactKind>(v)?)
            }
        })
    }
}
impl FromDomain<study_ai::chat::provider::chatgpt::ChatGptAccount> for p::ChatGptAccount {
    fn from_domain(v: study_ai::chat::provider::chatgpt::ChatGptAccount) -> Self {
        Self {
            subject: v.subject,
            email: v.email,
            sharing: v.sharing,
        }
    }
}
impl FromDomain<study_ai::catalog::Plan> for p::Plan {
    fn from_domain(v: study_ai::catalog::Plan) -> Self {
        Self {
            transcription: match v.transcription {
                study_ai::catalog::Placement::Local => p::Placement::Local,
                study_ai::catalog::Placement::NotHere(
                    study_ai::catalog::Reason::NotEnoughMemory,
                ) => p::Placement::NotEnoughMemory,
                study_ai::catalog::Placement::NotHere(study_ai::catalog::Reason::TooSlow) => {
                    p::Placement::TooSlow
                }
            } as i32,
            transcription_instances: v.transcription_instances.map(|v| v.as_usize() as u32),
        }
    }
}
