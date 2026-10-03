//! Runs [`Rewriter`] as a job for a message with a version waiting to be written, once the
//! message's files are read (the job waits for them), and again whenever the user retries.
//! The text read from the message's files goes to the model as numbered sources.

use study_ai::agent::AgentRuntime;
use study_core::Context as _;
use study_core::db::{Database, Job, NewJob, Rewrite, VersionOrigin};
use study_core::jobs::{BoxFuture, JobHandler, Lane, off_thread, wrong_target};
use study_core::processing::{Excerpt, citations};
use study_core::{
    Citation, Failure, JobKind, MessageId, ProjectId, SourceId, VersionId, cited_markers,
    renumber_citations,
};

use super::{Rewriter, Rewriting};
use crate::search::Retriever;

/// Most characters of the message's files a rewrite reads.
const FILES_BUDGET: usize = 16_000;

/// Writes the versions the student asked for.
pub struct RewriteHandler {
    runtime: AgentRuntime,
    retriever: Retriever,
}

/// A version to write, as read from the database.
struct Pending {
    version: VersionId,
    how: Rewrite,
    text: String,
    files: Vec<SourceId>,
    project: ProjectId,
    /// What the text cites, numbered as its markers say; empty when it cites nothing.
    cited: Vec<Excerpt>,
}

impl RewriteHandler {
    /// Runs [`Rewriter`] on `runtime`, reading files through `retriever`.
    pub fn new(runtime: AgentRuntime, retriever: Retriever) -> Self {
        Self { runtime, retriever }
    }

    /// Writes the version waiting on message `id`, unless it was dropped.
    async fn rewrite(&self, id: MessageId) -> Result<(), Failure> {
        let agent = self.runtime.required::<Rewriter>().await?;
        let pending = self
            .runtime
            .blocking(move |database| pending(database, id))
            .await?;
        let Some(Pending {
            version,
            how,
            text,
            files,
            project,
            cited,
        }) = pending
        else {
            return Ok(());
        };
        // A text that cites is revised from the passages it cites, so its markers still
        // resolve. Otherwise the message's files are searched, which runs the search model;
        // it holds no connection meanwhile, and a message without files has nothing to search.
        let excerpts = if !cited.is_empty() {
            cited
        } else if files.is_empty() {
            Vec::new()
        } else {
            let retriever = self.retriever.clone();
            let query = text.clone();
            off_thread(move || retriever.retrieve(&query, project, &files, FILES_BUDGET, 0))
                .await??
        };
        let rewriting = Rewriting {
            how,
            text,
            excerpts,
        };
        let text = agent.run(&rewriting).await.map_err(Failure::from)?;
        let citations = citations(
            &rewriting.excerpts,
            cited_markers(&text, rewriting.excerpts.len() as u32),
        );
        self.runtime
            .blocking(move |database| database.finish_version(version, &text, &citations))
            .await?;
        Ok(())
    }
}

/// The version waiting on message `id`, once it is marked as being written; `None` when
/// there is none, or it is not a rewrite.
fn pending(database: &Database, id: MessageId) -> study_core::Result<Option<Pending>> {
    let Some(pending) = database.begin_version(id, JobKind::Rewrite)? else {
        return Ok(None);
    };
    let how = match (pending.origin, pending.instruction) {
        (VersionOrigin::Improve, _) => Rewrite::Improve,
        (VersionOrigin::Summarize, _) => Rewrite::Summarize,
        (VersionOrigin::Instruction, Some(instruction)) => Rewrite::Instruction(instruction),
        // Only answers and the student's own text are not rewrites; their jobs are not this one.
        _ => return Ok(None),
    };
    let message = database
        .message(id)?
        .context("a version belongs to a message")?;
    let files = message
        .parts
        .iter()
        .filter_map(|part| part.content.source_id)
        .collect();
    let project = database
        .session(message.session_id)?
        .context("a message belongs to a session")?
        .project_id;
    let (cited, text) = cited_sources(&pending.citations, pending.source_text);
    Ok(Some(Pending {
        version: pending.id,
        how,
        text,
        files,
        project,
        cited,
    }))
}

/// The passages a text cites as numbered sources, with the text to rewrite. The passages
/// are numbered densely in the order of their stored markers, and the markers in the text
/// follow: an answer that cited only excerpts 2 and 5 reads `[1]` and `[2]`. A passage whose
/// source was deleted cannot be given, so its marker leaves the text.
fn cited_sources(citations: &[Citation], text: String) -> (Vec<Excerpt>, String) {
    let mut given: Vec<(u32, Excerpt)> = citations
        .iter()
        .filter_map(|citation| {
            Some((
                citation.marker,
                Excerpt {
                    source_id: citation.source_id?,
                    source_name: citation.source_name.clone(),
                    anchor: citation.anchor.clone(),
                    text: citation.quote.clone(),
                },
            ))
        })
        .collect();
    given.sort_by_key(|(marker, _)| *marker);
    if citations.is_empty() {
        return (Vec::new(), text);
    }
    let kept: Vec<u32> = given.iter().map(|(marker, _)| *marker).collect();
    let text = renumber_citations(&text, &kept);
    (
        given.into_iter().map(|(_, excerpt)| excerpt).collect(),
        text,
    )
}

impl JobHandler for RewriteHandler {
    fn kind(&self) -> JobKind {
        JobKind::Rewrite
    }

    fn lane(&self) -> Lane {
        Lane::Llm
    }

    fn run(&self, job: Job) -> BoxFuture<'_, Result<Vec<NewJob>, Failure>> {
        Box::pin(async move {
            let Some(message) = job.target.message() else {
                return Err(wrong_target(&job));
            };
            self.rewrite(message).await?;
            Ok(Vec::new())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use study_core::Anchor;

    fn cited(marker: u32, source: Option<i64>) -> Citation {
        Citation {
            marker,
            source_id: source.map(SourceId::new),
            source_name: format!("file{marker}.txt"),
            anchor: Anchor::Page { page: 1 },
            quote: format!("passage {marker}"),
        }
    }

    #[test]
    fn passages_numbered_as_the_markers_say_are_given_with_the_text_as_it_is() {
        let (excerpts, text) = cited_sources(
            &[cited(1, Some(1)), cited(2, Some(2))],
            "A [1] and B [2].".into(),
        );
        assert_eq!(excerpts.len(), 2);
        assert_eq!(excerpts[1].text, "passage 2");
        assert_eq!(text, "A [1] and B [2].");
    }

    #[test]
    fn sparse_markers_are_renumbered_with_their_passages() {
        let (excerpts, text) = cited_sources(
            &[cited(2, Some(2)), cited(5, Some(5))],
            "A [2] and B [5].".into(),
        );
        assert_eq!(excerpts[0].text, "passage 2");
        assert_eq!(excerpts[1].text, "passage 5");
        assert_eq!(text, "A [1] and B [2].");
    }

    #[test]
    fn a_marker_whose_source_is_gone_leaves_the_text() {
        let (excerpts, text) = cited_sources(
            &[cited(1, None), cited(2, Some(2))],
            "A [1] and B [2].".into(),
        );
        assert_eq!(excerpts.len(), 1);
        assert_eq!(text, "A and B [1].");
        let (excerpts, text) = cited_sources(&[], "Plain.".into());
        assert!(excerpts.is_empty());
        assert_eq!(text, "Plain.");
    }
}
