//! Sample data for development: three courses as a student would have them, so every screen
//! has something real to show. What they say is in `seed_courses.rs`; this writes it.
//!
//! Each session holds a note and its attachments: lectures transcribed minute by minute,
//! slides and scans read page by page, articles saved from the web section by section, and
//! files read with other outcomes (failed, stopped, never read). From the read ones come
//! answers to notes that ask the assistant, and finished notes, flashcards and
//! diagrams, each citing the passages it rests on. Material belongs to the project, so what
//! a later session makes of the same kind updates it, and sessions added after a piece was
//! made leave it out of date. Every status shows: some pieces are up to date, some outdated,
//! some never made, and one update (cell biology's diagram) was declined by its writer for
//! having too little to go on, which leaves the diagram before it shown. Some
//! flashcards were reviewed over the last days, so a streak shows and some cards are due;
//! two courses have an exam coming. A quiz over cell biology has a few answered questions of
//! both kinds and the next ones written.
//!
//! Only finished, failed, and stopped work is seeded. A queued job would run as soon as the
//! app opens, so work that was in progress is seeded as stopped instead, ready to start from
//! the Pipelines page. Every audio file is a real recording, so starting one transcribes
//! speech. Finished reads leave their documents queued for indexing, so search finds them
//! once background work starts.

use super::seed_courses::{COURSES, QUIZ_COURSE, conversations, practice_questions};
use super::seed_files::sample;
use super::{
    Answered, Database, JobTarget, MessageRole, NewJob, NewPart, Place, read_nothing,
    unix_timestamp,
};
use crate::processing::ExtractorKind;
use crate::{
    Anchor, ArtifactBody, ArtifactKind, Block, BlockKind, Citation, Document, DocumentMeta,
    ErrorKind, Flashcard, JobId, JobKind, JobStatus, MessageId, ProjectId, QuestionStatus, Rating,
    Result, SessionId, SourceId, SourceKind,
};
use rusqlite::params;
use std::path::Path;

const HOUR: i64 = 3600;
const DAY: i64 = 24 * HOUR;

/// How one seeded read ended.
pub(super) enum Outcome {
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
pub(super) struct Web {
    pub title: &'static str,
    pub url: &'static str,
    pub sections: &'static [&'static str],
}

pub(super) struct Attachment {
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
pub(super) type Passage = (usize, usize);

/// What a piece of finished material holds.
pub(super) enum MadeBody {
    /// Notes, in Markdown citing `[n]`.
    Text(&'static str),
    /// Flashcards: question, answer, and the passages each rests on.
    Cards(&'static [(&'static str, &'static str, &'static [u32])]),
    /// A Mermaid flowchart whose cards cite `[n]`.
    Diagram(&'static str),
}

/// A piece of a project's material, finished once the session's attachments are read, from
/// every file the project has read so far; marker `[n]` cites `cites[n - 1]`, a passage of
/// the session's attachments.
pub(super) struct Made {
    pub kind: ArtifactKind,
    pub body: MadeBody,
    pub cites: &'static [Passage],
}

pub(super) struct Conversation {
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
    let picture = crate::sniff(attachment.file, &[]).is_raster();
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

impl Database {
    /// Fills an empty database with sample courses, sessions, files, study material and a
    /// quiz. Returns `false`, changing nothing, when there are already projects.
    pub fn seed_demo(&self) -> Result<bool> {
        if !self.list_projects()?.is_empty() {
            return Ok(false);
        }
        let files = tempfile::tempdir()?;
        for (name, exam_in) in COURSES {
            let project = self.create_project(name)?;
            if let Some(days) = exam_in {
                self.connection.execute(
                    "UPDATE projects SET exam_on = date('now', ?1) WHERE id = ?2",
                    params![format!("+{days} days"), project.id],
                )?;
            }
        }
        for conversation in conversations() {
            self.seed_conversation(files.path(), &conversation)?;
        }
        self.seed_reviews()?;
        self.seed_practice(QUIZ_COURSE)?;
        Ok(true)
    }

    /// A session of `conversation`'s project with its note, attachments read as scripted,
    /// answer, material and thread, dated `hours_ago`.
    fn seed_conversation(&self, directory: &Path, conversation: &Conversation) -> Result<()> {
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
                sample(attachment.file, attachment.name(), attachment.blocks()),
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
            .skip(1)
            .zip(&conversation.attachments)
            .enumerate()
        {
            let source = part.content.source_id().expect("an attachment is a source");
            if let Some(web) = &attachment.web {
                // Saved from the web: named for its page, and opening where it came from.
                self.connection.execute(
                    "UPDATE sources SET name = ?1, kind = ?2, mime = 'text/html', origin = 'web',
                         uri = ?3
                     WHERE id = ?4",
                    params![web.title, SourceKind::Web, web.url, source],
                )?;
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
            self.finish_seeded_job(job.id, status, failure, posted, finished)?;
        }
        if let Some((answer, cites)) = conversation.answer {
            let cited = citations(conversation, &read, cites);
            self.seed_answer(message.id, answer, &cited, posted)?;
        }
        for (place, made) in (1..).zip(&conversation.made) {
            let cited = citations(conversation, &read, made.cites);
            let written = posted + place * 10 * 60;
            self.seed_material(project, made, &cited, written)?;
        }
        if let Some((kind, attachment, why)) = conversation.declined {
            let source = message.parts[attachment + 1]
                .content
                .source_id()
                .expect("an attachment is a source");
            let (artifact, job) = self.request_update(project, kind, &[source])?;
            let job = job.expect("an update is queued");
            let at = posted + HOUR;
            self.finish_seeded_job(
                job,
                JobStatus::Failed,
                Some((ErrorKind::NotEnough, why)),
                at,
                at + 40,
            )?;
            self.date_artifact(artifact.get(), at)?;
        }
        self.connection.execute(
            "UPDATE messages SET created_at = ?1 WHERE id = ?2 OR reply_to = ?2",
            params![posted, message.id],
        )?;
        if let Some(root) = message.parts.get(1) {
            for (minutes, note) in (10..).step_by(10).zip(conversation.thread) {
                let reply = self.post_message(
                    Place::Thread(root.id),
                    MessageRole::User,
                    &[NewPart::Text((*note).to_owned())],
                    &read_nothing,
                )?;
                self.connection.execute(
                    "UPDATE messages SET created_at = ?1 WHERE id = ?2",
                    params![posted + minutes * 60, reply.id],
                )?;
            }
        }
        self.connection.execute(
            "UPDATE sessions SET created_at = ?1, updated_at = ?1 WHERE id = ?2",
            params![posted, session.id],
        )?;
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

    /// Marks seeded job `id` as ended with `status` (and `failure`), between `started` and
    /// `finished`.
    fn finish_seeded_job(
        &self,
        id: JobId,
        status: JobStatus,
        failure: Option<(ErrorKind, &str)>,
        started: i64,
        finished: i64,
    ) -> Result<()> {
        self.connection.execute(
            "UPDATE jobs
             SET status = ?1, attempts = 1, error_kind = ?2, error = ?3,
                 created_at = ?4, started_at = ?4, finished_at = ?5, updated_at = ?5
             WHERE id = ?6",
            params![
                status,
                failure.map(|(kind, _)| kind),
                failure.map(|(_, error)| error),
                started,
                finished,
                id
            ],
        )?;
        Ok(())
    }

    /// Dates artifact `id` as made at `at`.
    fn date_artifact(&self, id: i64, at: i64) -> Result<()> {
        self.connection.execute(
            "UPDATE artifacts SET created_at = ?1, updated_at = ?1 WHERE id = ?2",
            params![at, id],
        )?;
        Ok(())
    }

    /// The files of `project` that were read, which material is written from.
    fn read_sources(&self, project: ProjectId) -> Result<Vec<SourceId>> {
        let mut read = Vec::new();
        for source in self.project_material(project)?.sources {
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
        let sources = self.read_sources(project)?;
        let (artifact, job) = self.request_update(project, made.kind, &sources)?;
        let job = job.expect("an update is queued");
        let body = match made.body {
            MadeBody::Text(text) => ArtifactBody::Text {
                text: text.to_owned(),
            },
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
        self.finish_seeded_job(job, JobStatus::Succeeded, None, at - 50, at)?;
        self.date_artifact(artifact.get(), at)?;
        Ok(())
    }

    /// Reviews over the last days: two groups of the mitosis cards went well on consecutive
    /// days, and the first again yesterday, so a streak shows; the eigenvalue cards were
    /// forgotten four days ago, so they are due again.
    fn seed_reviews(&self) -> Result<()> {
        let now = unix_timestamp();
        let reviews: [(&str, std::ops::Range<usize>, i64, Rating); 4] = [
            ("Cell biology", 0..4, 3, Rating::Good),
            ("Cell biology", 4..8, 2, Rating::Easy),
            ("Cell biology", 0..4, 1, Rating::Good),
            ("Linear algebra", 0..5, 4, Rating::Again),
        ];
        for (project, cards, days_ago, rating) in reviews {
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
    fn seed_practice(&self, name: &str) -> Result<()> {
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
        for (written, answer) in practice_questions() {
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
        self.connection.execute(
            "UPDATE jobs SET status = ?1, attempts = 1, started_at = ?2, finished_at = ?2,
                 updated_at = ?2
             WHERE question_id IN (SELECT id FROM practice_questions WHERE practice_id = ?3)",
            params![JobStatus::Succeeded, finished, practice],
        )?;
        Ok(())
    }

    /// The finished answer to `question`, citing `cited`.
    fn seed_answer(
        &self,
        question: MessageId,
        text: &str,
        cited: &[Citation],
        posted: i64,
    ) -> Result<()> {
        let session: SessionId = self.connection.query_row(
            "SELECT session_id FROM messages WHERE id = ?1",
            params![question],
            |row| row.get(0),
        )?;
        let answer = self
            .list_messages(session)?
            .into_iter()
            .find(|message| message.reply_to == Some(question))
            .expect("a question that mentions the assistant gets an answer");
        let job = answer.reply.expect("an answer has a reply job");
        self.begin_reply(answer.id)?;
        self.finish_reply(answer.id, text, cited)?;
        self.finish_seeded_job(
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
    use super::super::seed_courses::conversations;
    use super::{MadeBody, Outcome, Passage};
    use crate::Result;
    use crate::{ArtifactKind, ErrorKind, JobKind, JobStatus, SourceKind};
    use std::collections::BTreeSet;

    #[test]
    fn seeding_fills_an_empty_database_once() -> Result<()> {
        let (_dir, db) = crate::db::Database::temporary()?;
        assert!(db.seed_demo()?);
        assert!(!db.seed_demo()?);

        let scripted = conversations();
        let attachments = || scripted.iter().flat_map(|c| &c.attachments);
        let outcomes = |pick: fn(&Outcome) -> bool| {
            attachments()
                .filter(|a| a.outcome.as_ref().is_some_and(pick))
                .count()
        };
        let done = outcomes(|o| matches!(o, Outcome::Done { .. }));
        let made: usize = scripted.iter().map(|c| c.made.len()).sum();

        let projects = db.list_projects()?;
        assert_eq!(projects.len(), 3);
        assert_eq!(projects.iter().filter(|p| p.exam_on.is_some()).count(), 2);
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
        assert_eq!(count(JobKind::Reply, JobStatus::Succeeded), 3);
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

        // Sessions added after linear algebra's notes were made leave them out of date.
        let algebra = projects
            .iter()
            .find(|p| p.name == "Linear algebra")
            .unwrap();
        let notes = db
            .list_material(algebra.id)?
            .into_iter()
            .filter_map(|piece| piece.current)
            .find(|artifact| artifact.kind == ArtifactKind::Notes)
            .expect("linear algebra's notes");
        let read = db
            .project_material(algebra.id)?
            .sources
            .into_iter()
            .filter(|source| db.document_of(*source).unwrap().is_some())
            .collect::<Vec<_>>();
        let changes = db.material_changes(notes.id, &read)?.unwrap();
        assert_eq!((changes.files, changes.notes), (0, 2));

        // Some cards are due again, and there is a streak of reviews.
        assert!(db.count_due_cards(None, crate::db::unix_timestamp(), 0)? > 0);
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
        fn markers(text: &str) -> BTreeSet<usize> {
            text.split('[')
                .skip(1)
                .filter_map(|rest| rest.split_once(']')?.0.parse().ok())
                .collect()
        }
        for conversation in conversations() {
            let mut citing: Vec<(&str, BTreeSet<usize>, &[Passage])> = Vec::new();
            if let Some((answer, cites)) = conversation.answer {
                citing.push(("the answer", markers(answer), cites));
            }
            for made in &conversation.made {
                let used = match made.body {
                    MadeBody::Text(text) | MadeBody::Diagram(text) => markers(text),
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
}
