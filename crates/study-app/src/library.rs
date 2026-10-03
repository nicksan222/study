//! Projects and the sources filed under them.

use std::io::Write;
use std::path::{Path, PathBuf};

use study_core::db::{JobTarget, NewBytes, Project, Source};
use study_core::processing::plan_for;
use study_core::{
    Day, Document, Failure, JobKind, ProjectId, Result, SourceId, SourceKind, SourceOrigin, bail,
    mime,
};

use crate::App;

impl App {
    /// Every project, newest first.
    pub fn projects(&self) -> Result<Vec<Project>> {
        self.with(|database| database.list_projects())
    }

    /// A new, empty project.
    pub fn create_project(&self, name: &str) -> Result<Project> {
        self.with(|database| database.create_project(name))
    }

    /// Returns `false` when no project has this `id`.
    pub fn rename_project(&self, id: ProjectId, name: &str) -> Result<bool> {
        self.with(|database| database.rename_project(id, name))
    }

    /// Sets the day of the project's exam, or clears it. `false` when the project is gone.
    pub fn set_exam(&self, id: ProjectId, exam_on: Option<Day>) -> Result<bool> {
        self.with(|database| database.set_exam(id, exam_on))
    }

    /// Deletes a project with its sessions and study material; its sources stay, unassigned.
    pub fn delete_project(&self, id: ProjectId) -> Result<bool> {
        self.delete(|database| database.delete_project(id))
    }

    /// Every source with its project name, newest first.
    pub fn sources(&self) -> Result<Vec<Source>> {
        self.with(|database| database.list_sources())
    }

    /// One source with its project name; `None` when it is gone.
    pub fn source(&self, id: SourceId) -> Result<Option<Source>> {
        self.with(|database| database.source(id))
    }

    /// Imports files into the Library, optionally inside a project, and queues what reads
    /// them. Each file succeeds or fails on its own; the result says which.
    pub fn import_files(
        &self,
        paths: &[PathBuf],
        project: Option<ProjectId>,
    ) -> Vec<Result<Source>> {
        paths
            .iter()
            .map(|path| self.import_file(path, project))
            .collect()
    }

    /// Imports one file and queues its reading. Without background work, the file waits and
    /// is read once work starts.
    pub fn import_file(&self, path: &Path, project: Option<ProjectId>) -> Result<Source> {
        let (source, _) = self.queue_reads(|database, readable| {
            database.import_source_to_read(path, project, readable)
        })?;
        Ok(source)
    }

    /// Stores a note typed in Study as a source, and queues its reading when work runs;
    /// otherwise it is read once work starts.
    pub fn create_note(
        &self,
        project: Option<ProjectId>,
        title: &str,
        text: &str,
    ) -> Result<Source> {
        let text = text.trim();
        if text.is_empty() {
            bail!("a note needs some text");
        }
        let note = NewBytes {
            name: title,
            bytes: text.as_bytes(),
            kind: SourceKind::Note,
            mime: mime::MARKDOWN,
            origin: SourceOrigin::Note,
            project_id: project,
            uri: None,
        };
        let (source, _) =
            self.queue_reads(|database, readable| database.store_source(note, readable))?;
        Ok(source)
    }

    /// Stores `url` as a link source and queues the job that fetches what it holds (a
    /// video's sound track, or else the page itself) and then reads it; the source keeps its
    /// id. Nothing is fetched here: an address no fetcher takes fails at once, a page that
    /// cannot be fetched fails its job. Needs background work running.
    pub fn add_link(&self, project: Option<ProjectId>, url: &str) -> Result<Source> {
        let address = self
            .running()?
            .pipeline
            .fetchers()
            .address(url)
            .map_err(Failure::into_error)?;
        let (source, _) = self.queue(|database| database.add_link(project, &address))?;
        Ok(source)
    }

    /// The text read from a source, once it has been read.
    pub fn source_document(&self, id: SourceId) -> Result<Option<Document>> {
        Ok(self
            .with(|database| database.document_of(id))?
            .map(|(_, document)| document))
    }

    /// Corrects the text of block `ordinal` of what was read from a source, such as a
    /// misheard word in a transcript, and queues re-indexing so search and answers use the
    /// correction. Returns `false`, changing nothing, when the block no longer reads
    /// `before` (the source was read again or deleted meanwhile). Reads of the source
    /// already queued or running are cancelled, so none started before the correction
    /// replaces it; reading the source again afterwards replaces corrections with a fresh
    /// read.
    pub fn correct_block(
        &self,
        id: SourceId,
        ordinal: usize,
        before: &str,
        after: &str,
    ) -> Result<bool> {
        let running = self.workers_running();
        let corrected = self.with(|database| {
            // Without background work, the missing passages are queued once it starts.
            let next = if running {
                plan_for(database, JobTarget::Source(id))?
                    .and_then(|plan| plan.after(JobKind::Extract))
            } else {
                None
            };
            database.correct_block(id, ordinal, before, after, next)
        })?;
        // Stops the reads the correction cancelled, and runs what it queued.
        self.stop_ended()?;
        Ok(corrected.is_some())
    }

    /// Moves a source into a project, or out of any with `None`.
    pub fn set_source_project(&self, id: SourceId, project: Option<ProjectId>) -> Result<bool> {
        self.with(|database| database.set_source_project(id, project))
    }

    /// Deletes a source and its jobs. Messages that showed it keep its name.
    pub fn delete_source(&self, id: SourceId) -> Result<bool> {
        self.delete(|database| database.delete_source(id))
    }

    /// Streams a source's bytes into `destination`.
    pub fn export_source(&self, id: SourceId, destination: impl Write) -> Result<u64> {
        self.with(|database| database.export_source(id, destination))
    }
}
