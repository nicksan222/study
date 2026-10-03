//! Study material and reviewing it: making notes, flashcards and diagrams from
//! everything in a project, and spaced repetition over the flashcards.

use study_core::db::{Artifact, CardChange, Changes, Database, DueCard, Material, unix_timestamp};
use study_core::{
    ArtifactId, ArtifactKind, CardId, ErrorKind, Memory, ProjectId, Rating, Result,
    ReviewPreferences, SourceId, err,
};

use crate::App;

impl App {
    /// Queues writing `project`'s `kind` of material, or its update, from everything in the
    /// project: the files that offer `kind`, and the notes typed in its sessions, revising
    /// the current text when there is one, which stays until the update is done. Notes
    /// alone are enough. While an update is still being written it is the one returned, and
    /// nothing more is queued. When there is nothing to write from, the error is
    /// [`ErrorKind::Unsupported`].
    pub fn update_material(&self, project: ProjectId, kind: ArtifactKind) -> Result<ArtifactId> {
        self.running()?;
        let sources = self.sources_offering(project, kind)?;
        let (id, _) = self.queue(|database| {
            if sources.is_empty() && !has_notes(database, project)? {
                return Err(
                    err!("nothing in this project offers this kind of study material")
                        .with_kind(ErrorKind::Unsupported),
                );
            }
            database.request_update(project, kind, &sources)
        })?;
        Ok(id)
    }

    /// Whether [`update_material`](Self::update_material) has anything to write `kind` from:
    /// a file of `project` whose plan offers it, or notes typed in its sessions. A page asks
    /// before it offers Make or Update.
    pub fn can_update_material(&self, project: ProjectId, kind: ArtifactKind) -> Result<bool> {
        if !self.sources_offering(project, kind)?.is_empty() {
            return Ok(true);
        }
        self.with(|database| has_notes(database, project))
    }

    /// What `project` has gained or lost since material `id` was asked for, to say it is
    /// outdated; `None` when it is gone, or not material. The files counted are those the
    /// project offers for its kind now.
    pub fn material_changes(&self, id: ArtifactId) -> Result<Option<Changes>> {
        let Some(piece) = self.artifact(id)? else {
            return Ok(None);
        };
        let offered = self.sources_offering(piece.project_id, piece.kind)?;
        self.with(|database| database.material_changes(id, &offered))
    }

    /// Deletes `project`'s `kind` of material and any update under way, with their cards and
    /// review history, and stops the work on them.
    pub fn delete_material(&self, project: ProjectId, kind: ArtifactKind) -> Result<bool> {
        self.delete(|database| database.delete_material(project, kind))
    }

    /// The one rule for what material can come from: the sources of `project` that the
    /// user's processing plan reads and whose plan offers `kind`. It goes by the plan alone,
    /// not the running pipeline, so what can be made is known before background work starts.
    fn sources_offering(&self, project: ProjectId, kind: ArtifactKind) -> Result<Vec<SourceId>> {
        let processing = self.processing()?;
        Ok(self
            .sources()?
            .into_iter()
            .filter(|source| source.project_id == Some(project))
            .filter(|source| {
                let plan = processing.plan(source.kind, &source.mime);
                plan.reads() && plan.enhancers.contains(&kind)
            })
            .map(|source| source.id)
            .collect())
    }

    /// A project's study material: each piece with its current text and any update.
    pub fn material(&self, project: ProjectId) -> Result<Vec<Material>> {
        self.with(|database| database.list_material(project))
    }

    /// One piece of study material; `None` when it is gone.
    pub fn artifact(&self, id: ArtifactId) -> Result<Option<Artifact>> {
        self.with(|database| database.artifact(id))
    }

    /// Rewrites, deletes or adds card `index` of a finished flashcard set (see
    /// [`CardChange`]). `false` when there is no such set or card.
    pub fn set_card(&self, artifact: ArtifactId, index: usize, change: CardChange) -> Result<bool> {
        self.with(|database| database.set_card(artifact, index, &change))
    }

    /// Deletes one artifact that is not a piece of a project's material, such as a set of
    /// mistakes, with its cards and their review history.
    pub fn delete_artifact(&self, id: ArtifactId) -> Result<bool> {
        self.delete(|database| database.delete_artifact(id))
    }

    /// When each review since `since` happened, in `project` or everywhere, oldest first.
    pub fn review_times(&self, project: Option<ProjectId>, since: i64) -> Result<Vec<i64>> {
        self.with(|database| database.review_times(project, since))
    }

    /// How many cards come due by `until`, in `project` or everywhere, including those due
    /// now.
    pub fn due_by(&self, project: Option<ProjectId>, until: i64) -> Result<usize> {
        self.with(|database| database.count_due_cards(project, until, new_cards_left(database)?))
    }

    /// Cards due now, in `project` or everywhere: those already reviewed, most overdue
    /// first, then new ones up to what is left of today's number ([`ReviewPreferences`]).
    pub fn due_cards(&self, project: Option<ProjectId>, limit: usize) -> Result<Vec<DueCard>> {
        self.with(|database| {
            database.due_cards(project, unix_timestamp(), limit, new_cards_left(database)?)
        })
    }

    /// How many cards are due now, in `project` or everywhere, new ones counted up to what
    /// is left of today's number.
    pub fn due_count(&self, project: Option<ProjectId>) -> Result<usize> {
        self.with(|database| {
            database.count_due_cards(project, unix_timestamp(), new_cards_left(database)?)
        })
    }

    /// Records how well a card was remembered and reschedules it; returns its new memory,
    /// or `None` when the card is gone.
    pub fn review(&self, card: CardId, rating: Rating) -> Result<Option<Memory>> {
        self.with(|database| database.review_card(card, rating, unix_timestamp()))
    }
}

/// Whether notes have been typed in `project`'s sessions, which material can be written from.
fn has_notes(database: &Database, project: ProjectId) -> Result<bool> {
    Ok(!database.project_material(project)?.notes.trim().is_empty())
}

/// How many cards never reviewed may still come today: the student's daily number, less
/// those first reviewed since midnight on this computer's clock.
fn new_cards_left(database: &Database) -> Result<usize> {
    let per_day = ReviewPreferences::load(database)?.new_cards_per_day as usize;
    let taken = database.new_cards_since(start_of_today())?;
    Ok(per_day.saturating_sub(taken))
}

/// When today began on this computer's clock, in seconds since the Unix epoch; a day ago
/// when the local midnight cannot be told (a time-zone gap).
fn start_of_today() -> i64 {
    chrono::Local::now()
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .and_then(|midnight| midnight.and_local_timezone(chrono::Local).earliest())
        .map_or(unix_timestamp() - 86_400, |midnight| midnight.timestamp())
}
