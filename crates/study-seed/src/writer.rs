//! Sample data: five courses as a student would have them, so every screen has something
//! real to show. What they say is in `courses.rs`; this writes it. There are two samples,
//! [`Sample`], over the same courses and writers.
//!
//! Each session holds a note and its attachments: lectures transcribed minute by minute,
//! slides and scans read page by page, articles saved from the web section by section. From
//! the read ones come answers to notes that ask the assistant, and finished
//! flashcards and diagrams, each citing the passages it rests on. Material belongs to the
//! project, so what a later session makes of the same kind updates it. Some flashcards were
//! reviewed over the last days, so a streak shows and some cards are due; some courses have
//! an exam coming. A quiz over cell biology has answered questions of both kinds and the
//! next one written.
//!
//! The development sample also shows every status: files read with other outcomes (failed,
//! stopped, never read), sessions added after a piece was made leaving it out of date, some
//! pieces never made, and one update (cell biology's diagram) declined by its writer for
//! having too little to go on. The showcase has none of these: every file is read and every
//! course has up-to-date flashcards and a diagram.
//!
//! Only finished, failed, and stopped work is seeded. A queued job would run as soon as the
//! app opens, so work that was in progress is seeded as stopped instead, ready to start from
//! the Pipelines page. Every audio file is a real recording, so starting one transcribes
//! speech. In both samples, finished reads leave their documents queued for indexing (the
//! passages are written by the pipeline, not here), so search finds them once background
//! work starts; the showcase's only unfinished work is that indexing.

use crate::courses::{COURSES, QUIZ_COURSE, conversations, practice_questions};
use crate::files::sample as sample_file;
use std::ops::Deref;
use std::path::Path;
use study_core::db::{
    Answered, Database, JobTarget, MessageRole, NewJob, NewPart, Place, read_nothing,
    unix_timestamp,
};
use study_core::processing::{ExtractorKind, ProcessingPreferences};
use study_core::{
    Anchor, ArtifactBody, ArtifactKind, Block, BlockKind, Citation, Document, DocumentMeta,
    ErrorKind, Flashcard, JobKind, JobStatus, MessageId, ProjectId, QuestionStatus, Rating, Result,
    SessionId, SourceId, SourceKind,
};

const HOUR: i64 = 3600;
const DAY: i64 = 24 * HOUR;

/// Which sample to write. Both share the courses, content and writers.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Sample {
    /// For development: every status shows, so failed, stopped and declined work, outdated
    /// material and unread files are there to look at.
    Development,
    /// For showing the app: every read finishes and all material is up to date, so nothing
    /// looks broken and nothing waits to run.
    Showcase,
}

/// How one seeded read ended.
pub(crate) enum Outcome {
    /// Read, into these blocks: a transcript's segments, a document's pages, an article's
    /// sections.
    Done {
        blocks: &'static [&'static str],
    },
    Failed {
        kind: ErrorKind,
        error: &'static str,
    },
    Cancelled,
}

/// An article saved from the web: its title, its address, and the anchor of each section
/// it was read into, in order.
pub(crate) struct Web {
    pub title: &'static str,
    pub url: &'static str,
    pub sections: &'static [&'static str],
}

pub(crate) struct Attachment {
    pub file: &'static str,
    /// How it is read; `None` for a file the samples never read.
    pub extractor: Option<ExtractorKind>,
    /// `None` for a file no pipeline works on.
    pub outcome: Option<Outcome>,
    /// Seconds the attempt took; for a recording read, how long it is.
    pub took: i64,
    /// Where an article came from, for one saved from the web.
    pub web: Option<Web>,
}

impl Attachment {
    /// A file read into `blocks` by `extractor`, in `took` seconds.
    pub fn read(
        file: &'static str,
        extractor: ExtractorKind,
        blocks: &'static [&'static str],
        took: i64,
    ) -> Self {
        Self {
            file,
            extractor: Some(extractor),
            outcome: Some(Outcome::Done { blocks }),
            took,
            web: None,
        }
    }

    /// An article from the web, read section by section.
    pub fn article(web: Web, blocks: &'static [&'static str]) -> Self {
        assert_eq!(web.sections.len(), blocks.len(), "{}", web.title);
        Self {
            file: "article.html",
            extractor: Some(ExtractorKind::Web),
            outcome: Some(Outcome::Done { blocks }),
            took: 3,
            web: Some(web),
        }
    }

    /// A file whose read was stopped.
    pub fn stopped(file: &'static str, extractor: ExtractorKind) -> Self {
        Self {
            file,
            extractor: Some(extractor),
            outcome: Some(Outcome::Cancelled),
            took: 20,
            web: None,
        }
    }

    /// A file no pipeline reads.
    pub fn unread(file: &'static str) -> Self {
        Self {
            file,
            extractor: None,
            outcome: None,
            took: 0,
            web: None,
        }
    }

    /// What the student sees it called: an article by its title, a file by its name.
    fn name(&self) -> &'static str {
        self.web.as_ref().map_or(self.file, |web| web.title)
    }

    /// The blocks it was read into; none when it was not read.
    fn blocks(&self) -> &'static [&'static str] {
        match self.outcome {
            Some(Outcome::Done { blocks }) => blocks,
            _ => &[],
        }
    }
}

/// A passage cited: the attachment it is in, and its block there.
pub(crate) type Passage = (usize, usize);

/// What a piece of finished material holds.
pub(crate) enum MadeBody {
    /// Flashcards: question, answer, and the passages each rests on.
    Cards(&'static [(&'static str, &'static str, &'static [u32])]),
    /// A Mermaid flowchart whose cards cite `[n]`.
    Diagram(&'static str),
}

/// A piece of a project's material, finished once the session's attachments are read, from
/// every file the project has read so far; marker `[n]` cites `cites[n - 1]`, a passage of
/// the session's attachments.
pub(crate) struct Made {
    pub kind: ArtifactKind,
    pub body: MadeBody,
    pub cites: &'static [Passage],
}

pub(crate) struct Conversation {
    pub project: &'static str,
    pub title: &'static str,
    pub text: &'static str,
    pub hours_ago: i64,
    pub attachments: Vec<Attachment>,
    /// The assistant's answer and the passages it cites as `[1]`, `[2]`…. Only a `text`
    /// that mentions the assistant gets one.
    pub answer: Option<(&'static str, &'static [Passage])>,
    /// Notes in the thread under the first attachment.
    pub thread: &'static [&'static str],
    /// Material finished after the session, each the update of its kind.
    pub made: Vec<Made>,
    /// An update its writer declined: its kind, the one attachment it was asked to use, and
    /// what the writer said was missing.
    pub declined: Option<(ArtifactKind, usize, &'static str)>,
}

/// What seeding a session left behind: what was read, and the source of every attachment, in
/// order.
struct Seeded {
    read: Vec<Read>,
    sources: Vec<Option<SourceId>>,
}

/// What a read attachment became: its source and what was read from it.
struct Read {
    source: SourceId,
    attachment: usize,
    document: Document,
}

/// The document `attachment` was read into, block by block: a transcript's segments spread
/// over the recording, a document's pages (a picture is one page), or an article's
/// sections.
fn sample_document(attachment: &Attachment) -> Document {
    let extractor = attachment
        .extractor
        .expect("an attachment that was read names its extractor");
    let texts = attachment.blocks();
    let count = texts.len() as u64;
    let length_ms = u64::try_from(attachment.took).unwrap_or(0) * 1000;
    let picture = study_core::sniff(attachment.file, &[]).is_raster();
    let blocks: Vec<Block> = texts
        .iter()
        .enumerate()
        .map(|(index, text)| {
            let at = index as u64;
            let (kind, anchor) = match (extractor, &attachment.web) {
                (ExtractorKind::Transcription, _) => (
                    BlockKind::Segment,
                    Anchor::Time {
                        start_ms: length_ms * at / count,
                        end_ms: length_ms * (at + 1) / count,
                    },
                ),
                (ExtractorKind::Web, Some(web)) => (
                    BlockKind::Paragraph,
                    Anchor::Url {
                        url: web.url.to_owned(),
                        fragment: Some(web.sections[index].to_owned()),
                    },
                ),
                _ => (
                    BlockKind::Paragraph,
                    Anchor::Page {
                        page: if picture { 1 } else { index as u32 + 1 },
                    },
                ),
            };
            Block {
                kind,
                text: (*text).to_owned(),
                anchor,
            }
        })
        .collect();
    let (duration_ms, page_count) = match extractor {
        ExtractorKind::Transcription => (Some(length_ms), None),
        ExtractorKind::Vision if picture => (None, Some(1)),
        ExtractorKind::Vision => (None, Some(count as u32)),
        _ => (None, None),
    };
    Document {
        blocks,
        meta: DocumentMeta {
            extractor: Some(extractor),
            extractor_version: 1,
            duration_ms,
            page_count,
            ..DocumentMeta::default()
        },
    }
}

/// The passages `cites` names, as citations `[1]`, `[2]`… of what was `read` from
/// `conversation`'s attachments.
fn citations(conversation: &Conversation, read: &[Read], cites: &[Passage]) -> Vec<Citation> {
    cites
        .iter()
        .enumerate()
        .map(|(index, &(attachment, block))| {
            let read = read
                .iter()
                .find(|read| read.attachment == attachment)
                .expect("a cited attachment was read");
            let block = &read.document.blocks[block];
            Citation {
                marker: index as u32 + 1,
                source_id: Some(read.source),
                source_name: conversation.attachments[attachment].name().to_owned(),
                anchor: block.anchor.clone(),
                quote: block.text.clone(),
            }
        })
        .collect()
}

/// Writes `sample` into `database` if it has no projects, and says whether it did.
pub(crate) fn write(database: &Database, sample: Sample) -> Result<bool> {
    Seeder { database }.seed(sample)
}

/// The writers below, over one database.
struct Seeder<'a> {
    database: &'a Database,
}

impl Deref for Seeder<'_> {
    type Target = Database;

    fn deref(&self) -> &Database {
        self.database
    }
}

impl Seeder<'_> {
    fn seed(&self, sample: Sample) -> Result<bool> {
        if !self.list_projects()?.is_empty() {
            return Ok(false);
        }
        let files = tempfile::tempdir()?;
        for (name, exam_in) in COURSES {
            let project = self.create_project(name)?;
            if let Some(days) = exam_in {
                self.set_exam_in_days(project.id, days)?;
            }
        }
        let scripted = conversations(sample);
        // Development writes material as each session ends, so a later session leaves it out
        // of date; the showcase writes it once all sessions are in.
        let mut later = Vec::new();
        for conversation in &scripted {
            let seeded = self.seed_conversation(files.path(), conversation)?;
            match sample {
                Sample::Development => self.seed_conversation_material(conversation, &seeded)?,
                Sample::Showcase => later.push((conversation, seeded)),
            }
        }
        for (conversation, seeded) in later {
            self.seed_conversation_material(conversation, &seeded)?;
        }
        self.seed_reviews(sample)?;
        self.seed_practice(QUIZ_COURSE, sample)?;
        Ok(true)
    }

    /// A session of `conversation`'s project with its note, attachments read as scripted,
    /// answer and thread, dated `hours_ago`.
    fn seed_conversation(&self, directory: &Path, conversation: &Conversation) -> Result<Seeded> {
        let project = self.seeded_project(conversation.project)?;
        let session = self.create_session(project, conversation.title)?;
        let mut parts = vec![NewPart::Text(conversation.text.to_owned())];
        for (index, attachment) in conversation.attachments.iter().enumerate() {
            // Each in a folder of its own, so two articles never share a name.
            let folder = directory.join(format!("{}-{index}", session.id.get()));
            std::fs::create_dir_all(&folder)?;
            let path = folder.join(attachment.file);
            std::fs::write(
                &path,
                sample_file(attachment.file, attachment.name(), attachment.blocks()),
            )?;
            parts.push(NewPart::File(path));
        }
        // Each attachment is read when it is scripted with an outcome, in order.
        let next = std::cell::Cell::new(0);
        let scripted = |_: SourceKind, _: &str| {
            let attachment = &conversation.attachments[next.get()];
            next.set(next.get() + 1);
            attachment.outcome.is_some()
        };
        let message = self.post_message(session.id, MessageRole::User, &parts, &scripted)?;

        let posted = unix_timestamp() - conversation.hours_ago * HOUR;
        let mut read = Vec::new();
        for (index, (part, attachment)) in message
            .parts
            .iter()
            .zip(&conversation.attachments)
            .enumerate()
        {
            let source = part.content.source_id.expect("an attachment is a source");
            if let Some(web) = &attachment.web {
                // Saved from the web: named for its page, and opening where it came from.
                self.mark_saved_from_web(source, web.title, web.url)?;
            }
            let (Some(job), Some(outcome)) = (part.jobs.first(), &attachment.outcome) else {
                continue;
            };
            let finished = posted + attachment.took.min(600);
            let (status, failure) = match outcome {
                Outcome::Done { .. } => {
                    let document = sample_document(attachment);
                    let stored = self.save_document(source, &document)?;
                    self.enqueue_job(&NewJob::new(JobKind::Index, JobTarget::Document(stored)))?;
                    read.push(Read {
                        source,
                        attachment: index,
                        document,
                    });
                    (JobStatus::Succeeded, None)
                }
                Outcome::Failed { kind, error } => (JobStatus::Failed, Some((*kind, *error))),
                Outcome::Cancelled => (JobStatus::Cancelled, None),
            };
            self.settle_job(job.id, status, failure, posted, finished)?;
        }
        if let Some((answer, cites)) = conversation.answer {
            let cited = citations(conversation, &read, cites);
            self.seed_answer(session.id, message.id, answer, &cited, posted)?;
        }
        self.date_message(message.id, posted)?;
        for reply in self.list_messages(session.id)? {
            if reply.reply_to == Some(message.id) {
                self.date_message(reply.id, posted)?;
            }
        }
        if let Some(root) = message.parts.first() {
            for (minutes, note) in (10..).step_by(10).zip(conversation.thread) {
                let reply = self.post_message(
                    Place::Thread(root.id),
                    MessageRole::User,
                    &[NewPart::Text((*note).to_owned())],
                    &read_nothing,
                )?;
                self.date_message(reply.id, posted + minutes * 60)?;
            }
        }
        self.date_session(session.id, posted)?;
        let sources = message
            .parts
            .iter()
            .map(|part| part.content.source_id)
            .collect();
        Ok(Seeded { read, sources })
    }

    /// The material `conversation` makes from what it read, each piece the update of its
    /// kind in the project, and then the update it declined.
    fn seed_conversation_material(
        &self,
        conversation: &Conversation,
        seeded: &Seeded,
    ) -> Result<()> {
        let project = self.seeded_project(conversation.project)?;
        let posted = unix_timestamp() - conversation.hours_ago * HOUR;
        for (place, made) in (1..).zip(&conversation.made) {
            let cited = citations(conversation, &seeded.read, made.cites);
            let written = posted + place * 10 * 60;
            self.seed_material(project, made, &cited, written)?;
        }
        if let Some((kind, attachment, why)) = conversation.declined {
            let source = seeded.sources[attachment].expect("an attachment is a source");
            let (artifact, job) = self.request_update(project, kind, &[source])?;
            let job = job.expect("an update is queued");
            let at = posted + HOUR;
            self.settle_job(
                job,
                JobStatus::Failed,
                Some((ErrorKind::NotEnough, why)),
                at,
                at + 40,
            )?;
            self.date_artifact(artifact, at)?;
        }
        Ok(())
    }

    fn seeded_project(&self, name: &str) -> Result<ProjectId> {
        Ok(self
            .list_projects()?
            .into_iter()
            .find(|project| project.name == name)
            .expect("seeded project")
            .id)
    }

    /// The files of `project` that were read and that the default plan offers `kind` from:
    /// what material is written from, by the same rule the app counts outdated by.
    fn offering_read(&self, project: ProjectId, kind: ArtifactKind) -> Result<Vec<SourceId>> {
        let offering = self.sources_offering(project, kind, &ProcessingPreferences::default())?;
        let mut read = Vec::new();
        for source in offering {
            if self.document_of(source)?.is_some() {
                read.push(source);
            }
        }
        Ok(read)
    }

    /// `made`, the update of its kind in `project`, finished at `at` from the files
    /// read so far and citing `cited`.
    fn seed_material(
        &self,
        project: ProjectId,
        made: &Made,
        cited: &[Citation],
        at: i64,
    ) -> Result<()> {
        let sources = self.offering_read(project, made.kind)?;
        let (artifact, job) = self.request_update(project, made.kind, &sources)?;
        let job = job.expect("an update is queued");
        let body = match made.body {
            MadeBody::Diagram(mermaid) => ArtifactBody::Diagram {
                mermaid: mermaid.to_owned(),
            },
            MadeBody::Cards(cards) => ArtifactBody::Flashcards {
                cards: cards
                    .iter()
                    .map(|&(front, back, cites)| Flashcard {
                        front: front.to_owned(),
                        back: back.to_owned(),
                        cites: cites.to_vec(),
                    })
                    .collect(),
            },
        };
        self.begin_artifact(artifact)?;
        self.finish_artifact(artifact, &body, cited)?;
        self.settle_job(job, JobStatus::Succeeded, None, at - 50, at)?;
        self.date_artifact(artifact, at)?;
        Ok(())
    }

    /// Reviews over the last days, so a streak shows and some cards are due again; each
    /// sample's arm says how.
    fn seed_reviews(&self, sample: Sample) -> Result<()> {
        let now = unix_timestamp();
        let reviews: &[(&str, std::ops::Range<usize>, i64, Rating)] = match sample {
            // Two groups of the mitosis cards went well on consecutive days and the first again
            // yesterday; the eigenvalue cards were forgotten four days ago, so they are due.
            Sample::Development => &[
                ("Cell biology", 0..4, 3, Rating::Good),
                ("Cell biology", 4..8, 2, Rating::Easy),
                ("Cell biology", 0..4, 1, Rating::Good),
                ("Linear algebra", 0..5, 4, Rating::Again),
            ],
            // A streak over six days; the eigenvalue cards were forgotten and a few others are
            // due again, and the rest are scheduled for later.
            Sample::Showcase => &[
                ("Cell biology", 0..4, 6, Rating::Easy),
                ("Cell biology", 4..8, 5, Rating::Easy),
                ("Cell biology", 8..12, 4, Rating::Good),
                ("Linear algebra", 0..5, 4, Rating::Again),
                ("Linear algebra", 5..10, 2, Rating::Easy),
                ("Roman history", 0..8, 3, Rating::Easy),
                ("Organic chemistry", 0..8, 2, Rating::Easy),
                ("Microeconomics", 0..4, 4, Rating::Good),
                ("Microeconomics", 4..8, 1, Rating::Easy),
            ],
        };
        for (project, cards, days_ago, rating) in reviews.iter().cloned() {
            let set = self
                .list_material(self.seeded_project(project)?)?
                .into_iter()
                .filter_map(|piece| piece.current)
                .find(|artifact| artifact.kind == ArtifactKind::Flashcards)
                .expect("seeded flashcards");
            for card in &self.cards_of(set.id)?[cards] {
                self.review_card(card.id, rating, now - days_ago * DAY)?;
            }
        }
        Ok(())
    }

    /// The practice of the project called `name`, taking
    /// [`practice_questions`] in turn: each is written and, when it has one, answered and
    /// graded. The last ones wait for an answer, and every job the practice queued is
    /// finished.
    fn seed_practice(&self, name: &str, sample: Sample) -> Result<()> {
        let project = self.seeded_project(name)?;
        // The passages the questions cite: those the mitosis diagram cites, the recording
        // `[1]` and the slides `[2]`.
        let passages = self
            .list_material(project)?
            .into_iter()
            .filter_map(|piece| piece.current)
            .find(|artifact| artifact.kind == ArtifactKind::Diagram)
            .map(|diagram| diagram.citations)
            .unwrap_or_default();
        let practice = self.project_practice(project)?;
        for (written, answer) in practice_questions(sample) {
            let cited: Vec<Citation> = passages
                .iter()
                .filter(|passage| written.body.cites().contains(&passage.marker))
                .cloned()
                .collect();
            let next = self
                .practice(practice)?
                .and_then(|practice| {
                    practice
                        .questions
                        .into_iter()
                        .find(|question| question.status == QuestionStatus::Pending)
                })
                .expect("a practice keeps a question to write");
            self.begin_question(next.id)?;
            self.finish_question(next.id, &written, &cited)?;
            let Some((answer, grade)) = answer else {
                continue;
            };
            if let Answered::Grading(_) = self.answer_question(next.id, &answer)?
                && let Some((verdict, feedback)) = grade
            {
                self.begin_grade(next.id)?;
                self.finish_grade(next.id, verdict, feedback)?;
            }
        }
        let finished = unix_timestamp() - HOUR;
        self.settle_practice_jobs(practice, finished)
    }

    /// The finished answer to `question`, citing `cited`.
    fn seed_answer(
        &self,
        session: SessionId,
        question: MessageId,
        text: &str,
        cited: &[Citation],
        posted: i64,
    ) -> Result<()> {
        let answer = self
            .list_messages(session)?
            .into_iter()
            .find(|message| message.reply_to == Some(question))
            .expect("a question that mentions the assistant gets an answer");
        let job = answer.reply.expect("an answer has a reply job");
        let pending = self
            .begin_version(answer.id)?
            .expect("an answer waits to be written");
        self.finish_version(pending.id, text, cited)?;
        self.settle_job(
            job.id,
            JobStatus::Succeeded,
            None,
            posted + 200,
            posted + 208,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::{MadeBody, Outcome, Passage, Sample};
    use crate::courses::conversations;
    use std::collections::BTreeSet;
    use study_core::Result;
    use study_core::processing::ProcessingPreferences;
    use study_core::{ArtifactKind, ErrorKind, JobKind, JobStatus, SourceKind};

    #[test]
    fn seeding_fills_an_empty_database_once() -> Result<()> {
        let (_dir, db) = study_core::db::Database::temporary()?;
        assert!(crate::demo(&db)?);
        assert!(!crate::demo(&db)?);

        let scripted = conversations(Sample::Development);
        let attachments = || scripted.iter().flat_map(|c| &c.attachments);
        let outcomes = |pick: fn(&Outcome) -> bool| {
            attachments()
                .filter(|a| a.outcome.as_ref().is_some_and(pick))
                .count()
        };
        let done = outcomes(|o| matches!(o, Outcome::Done { .. }));
        let made: usize = scripted.iter().map(|c| c.made.len()).sum();

        let projects = db.list_projects()?;
        assert_eq!(projects.len(), 5);
        assert_eq!(projects.iter().filter(|p| p.exam_on.is_some()).count(), 3);
        let jobs = db.list_job_overviews(500)?;
        let count = |kind, status| {
            jobs.iter()
                .filter(|o| o.job.kind == kind && o.job.status == status)
                .count()
        };
        assert_eq!(count(JobKind::Extract, JobStatus::Succeeded), done);
        assert_eq!(
            count(JobKind::Extract, JobStatus::Failed),
            outcomes(|o| matches!(o, Outcome::Failed { .. }))
        );
        assert_eq!(
            count(JobKind::Extract, JobStatus::Cancelled),
            outcomes(|o| matches!(o, Outcome::Cancelled))
        );
        // Every document read waits to be indexed once background work starts.
        assert_eq!(count(JobKind::Index, JobStatus::Queued), done);
        assert_eq!(count(JobKind::Reply, JobStatus::Succeeded), 5);
        assert_eq!(count(JobKind::Artifact, JobStatus::Succeeded), made);
        // One piece was declined for having too little to go on.
        let declined: Vec<_> = jobs
            .iter()
            .filter(|o| o.job.kind == JobKind::Artifact && o.job.status == JobStatus::Failed)
            .collect();
        assert_eq!(declined.len(), 1);
        assert_eq!(declined[0].job.error_kind, Some(ErrorKind::NotEnough));
        // Five questions written and one open answer graded.
        assert_eq!(count(JobKind::Question, JobStatus::Succeeded), 5);
        assert_eq!(count(JobKind::Grade, JobStatus::Succeeded), 1);
        // Only the practice's jobs name it, so the pipelines page can open it.
        for overview in &jobs {
            let practice_job = matches!(overview.job.kind, JobKind::Question | JobKind::Grade);
            assert_eq!(overview.practice_id.is_some(), practice_job, "{overview:?}");
        }

        // Articles are saved from the web, and open where they came from.
        let web: Vec<_> = db
            .list_sources()?
            .into_iter()
            .filter(|source| source.kind == SourceKind::Web)
            .collect();
        assert_eq!(web.len(), attachments().filter(|a| a.web.is_some()).count());
        assert!(web.iter().all(|source| source.uri.is_some()));

        // Every finished piece cites real passages, each quoting what was read.
        for project in &projects {
            for artifact in db
                .list_material(project.id)?
                .into_iter()
                .filter_map(|piece| piece.current)
            {
                assert!(!artifact.citations.is_empty(), "{}", artifact.title);
                for citation in &artifact.citations {
                    let (_, document) = db
                        .document_of(citation.source_id.expect("a seeded source"))?
                        .expect("a read source");
                    assert!(
                        document
                            .blocks
                            .iter()
                            .any(|block| block.text == citation.quote),
                        "{}: {}",
                        artifact.title,
                        citation.quote
                    );
                }
            }
        }
        let biology = projects.iter().find(|p| p.name == "Cell biology").unwrap();
        // Every kind is made for cell biology, its diagram with an update that was declined.
        let pieces = db.list_material(biology.id)?;
        let current: Vec<ArtifactKind> = pieces
            .iter()
            .filter_map(|piece| piece.current.as_ref().map(|current| current.kind))
            .collect();
        for kind in ArtifactKind::ALL {
            assert!(current.contains(kind), "{kind:?}");
        }
        let declined = pieces
            .iter()
            .find_map(|piece| piece.update.as_ref())
            .expect("the declined update");
        assert_eq!(declined.kind, ArtifactKind::Diagram);
        assert!(
            declined
                .job
                .as_ref()
                .is_some_and(|job| job.status.is_stopped())
        );

        // Sessions added after linear algebra's flashcards were made leave them out of date.
        let algebra = projects
            .iter()
            .find(|p| p.name == "Linear algebra")
            .unwrap();
        let cards = db
            .list_material(algebra.id)?
            .into_iter()
            .filter_map(|piece| piece.current)
            .find(|artifact| artifact.kind == ArtifactKind::Flashcards)
            .expect("linear algebra's flashcards");
        let read = db
            .project_material(algebra.id)?
            .sources
            .into_iter()
            .filter(|source| db.document_of(*source).unwrap().is_some())
            .collect::<Vec<_>>();
        let changes = db.material_changes(cards.id, &read)?.unwrap();
        assert_eq!((changes.files, changes.notes), (0, 2));

        // Some cards are due again, and there is a streak of reviews.
        assert!(db.count_due_cards(None, study_core::db::unix_timestamp(), 0)? > 0);
        assert!(!db.review_times(None, 0)?.is_empty());

        // The mitosis recording has notes in its thread.
        let threaded: Vec<usize> = db
            .list_all_sessions()?
            .iter()
            .map(|session| db.list_messages(session.id))
            .collect::<Result<Vec<_>>>()?
            .iter()
            .flatten()
            .flat_map(|message| &message.parts)
            .map(|part| part.thread.replies)
            .filter(|replies| *replies > 0)
            .collect();
        assert_eq!(threaded, [2]);

        // The practice has answered questions of both kinds and two waiting.
        let practices = db.practices()?;
        assert_eq!(practices.len(), 1);
        let score = practices[0].score;
        assert_eq!(
            (score.asked, score.answered, score.correct, score.partly),
            (5, 3, 1, 1)
        );
        // Each written question cites the passage it rests on, as a writer's would.
        let practice = db.practice(practices[0].id)?.expect("the seeded practice");
        for question in practice.questions.iter().filter(|q| q.written.is_some()) {
            assert_eq!(question.citations.len(), 1, "{question:?}");
        }
        Ok(())
    }

    /// Every seeded answer and piece of material cites each of its passages once, by markers
    /// `[1]`, `[2]`… with none missing or out of range, and each passage is a block that was
    /// read.
    #[test]
    fn seeded_cites_are_distinct_used_and_read() {
        for sample in [Sample::Development, Sample::Showcase] {
            cites_are_distinct_used_and_read(sample);
        }
    }

    fn cites_are_distinct_used_and_read(sample: Sample) {
        fn markers(text: &str) -> BTreeSet<usize> {
            text.split('[')
                .skip(1)
                .filter_map(|rest| rest.split_once(']')?.0.parse().ok())
                .collect()
        }
        for conversation in conversations(sample) {
            let mut citing: Vec<(&str, BTreeSet<usize>, &[Passage])> = Vec::new();
            if let Some((answer, cites)) = conversation.answer {
                citing.push(("the answer", markers(answer), cites));
            }
            for made in &conversation.made {
                let used = match made.body {
                    MadeBody::Diagram(text) => markers(text),
                    MadeBody::Cards(cards) => cards
                        .iter()
                        .flat_map(|(_, _, cites)| cites.iter().map(|&marker| marker as usize))
                        .collect(),
                };
                citing.push((made.kind.code(), used, made.cites));
            }
            for (what, used, cites) in citing {
                let title = conversation.title;
                assert_eq!(
                    used,
                    (1..=cites.len()).collect(),
                    "{title}, {what}: markers"
                );
                let distinct: BTreeSet<&Passage> = cites.iter().collect();
                assert_eq!(
                    distinct.len(),
                    cites.len(),
                    "{title}, {what}: a passage twice"
                );
                for &(attachment, block) in cites {
                    let read = conversation
                        .attachments
                        .get(attachment)
                        .map_or(0, |attachment| attachment.blocks().len());
                    assert!(block < read, "{title}, {what}: ({attachment}, {block})");
                }
            }
        }
    }

    /// The showcase shows nothing failed, stopped, declined or out of date; every job
    /// has succeeded except Index, which is left queued for the app to run at start; every
    /// course has every kind of material.
    #[test]
    fn the_showcase_shows_nothing_wrong() -> Result<()> {
        let (_dir, db) = study_core::db::Database::temporary()?;
        assert!(crate::showcase(&db)?);
        assert!(!crate::showcase(&db)?);

        let jobs = db.list_job_overviews(1000)?;
        assert!(!jobs.is_empty());
        // The one thing left to do is indexing, which the pipeline does at start.
        for overview in &jobs {
            let job = &overview.job;
            let expected = if job.kind == JobKind::Index {
                JobStatus::Queued
            } else {
                JobStatus::Succeeded
            };
            assert_eq!(job.status, expected, "{overview:?}");
        }
        let projects = db.list_projects()?;
        assert_eq!(projects.len(), 5);
        for project in &projects {
            let pieces = db.list_material(project.id)?;
            for piece in &pieces {
                assert!(piece.update.is_none(), "{}: a pending update", project.name);
            }
            for kind in ArtifactKind::ALL {
                let current = pieces
                    .iter()
                    .filter_map(|piece| piece.current.as_ref())
                    .find(|artifact| artifact.kind == *kind)
                    .unwrap_or_else(|| panic!("{}: no {kind:?}", project.name));
                let offered =
                    db.sources_offering(project.id, *kind, &ProcessingPreferences::default())?;
                let changes = db.material_changes(current.id, &offered)?.unwrap();
                assert_eq!(
                    (changes.files, changes.notes),
                    (0, 0),
                    "{}: {kind:?} is out of date",
                    project.name
                );
            }
        }
        // Every file was read.
        for source in db.list_sources()? {
            assert!(db.document_of(source.id)?.is_some(), "{}", source.name);
        }
        // A quiz mostly answered right.
        let practices = db.practices()?;
        let score = practices[0].score;
        assert_eq!((score.answered, score.correct), (4, 4));
        // Cards are due, but few.
        let due = db.count_due_cards(None, study_core::db::unix_timestamp(), 0)?;
        assert!((8..=16).contains(&due), "{due} cards due");
        Ok(())
    }
}
