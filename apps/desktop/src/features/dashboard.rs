//! What the Home dashboard shows, read in one go: the projects and their most recent sessions,
//! the files in the Library, what the pipelines are doing, and what this computer can run
//! (with whether the transcription model is on disk, as Settings checks it).

use crate::features::media::{AttachmentInfo, attachment_info};
use std::cmp::Reverse;
use std::collections::HashMap;
use study_app::benchmark::Report;
use study_app::views::{ChatSession, JobOverview, JobStatus, Project, Source};
use study_app::{App, LocalModel};
use study_core::ProjectId;

/// Sessions listed under "pick up where you left off".
const RECENT_SESSIONS: usize = 5;
/// Files shown with a preview.
const RECENT_FILES: usize = 6;
/// Jobs read to count and to list what is running or needs attention.
const JOBS: usize = 300;

/// A session to pick up, with the project it is in.
#[derive(Clone, Debug)]
pub struct RecentSession {
    pub session: ChatSession,
    pub project_name: String,
}

/// A file recently added to the Library.
#[derive(Clone, Debug)]
pub struct RecentFile {
    pub item: Source,
    /// `None` when there is nothing to draw, such as for a recording.
    pub info: Option<AttachmentInfo>,
}

/// Everything Home shows.
#[derive(Clone, Debug, Default)]
pub struct Snapshot {
    pub projects: Vec<Project>,
    pub session_count: usize,
    /// The most recently active first.
    pub recent_sessions: Vec<RecentSession>,
    pub file_count: usize,
    /// The Library's size on disk.
    pub file_bytes: i64,
    pub recent_files: Vec<RecentFile>,
    pub jobs: Vec<JobOverview>,
    /// Flashcards due now in every project.
    pub due_cards: usize,
    /// This computer's measurements; `None` until the first launch has measured it.
    pub report: Option<Report>,
    /// Whether the speech-to-text model is on disk, so transcription can run here.
    pub transcription_installed: bool,
}

impl Snapshot {
    /// How many of the jobs read are in `status`.
    pub fn count(&self, status: JobStatus) -> usize {
        self.jobs
            .iter()
            .filter(|overview| overview.job.status == status)
            .count()
    }

    /// The project a new session most likely belongs in: the one with the latest activity.
    pub fn busiest_project(&self) -> Option<ProjectId> {
        self.recent_sessions
            .first()
            .map(|entry| entry.session.project_id)
            .or_else(|| self.projects.first().map(|project| project.id))
    }
}

/// Reads everything the dashboard shows. Blocks on the app and builds a few previews,
/// so call it off the UI thread.
pub fn load(app: &App) -> study_core::Result<Snapshot> {
    let projects = app.projects()?;
    let names: HashMap<ProjectId, &str> = projects
        .iter()
        .map(|project| (project.id, project.name.as_str()))
        .collect();
    let mut recent_sessions: Vec<RecentSession> = app
        .all_sessions()?
        .into_iter()
        .map(|session| RecentSession {
            project_name: names
                .get(&session.project_id)
                .copied()
                .unwrap_or_default()
                .to_owned(),
            session,
        })
        .collect();
    let session_count = recent_sessions.len();
    recent_sessions.sort_by_key(|entry| Reverse((entry.session.updated_at, entry.session.id)));
    recent_sessions.truncate(RECENT_SESSIONS);

    let files = app.sources()?;
    let file_bytes = files.iter().map(|item| item.size_bytes.max(0)).sum();
    let recent_files = files
        .iter()
        .take(RECENT_FILES)
        .map(|item| RecentFile {
            info: study_app::has_preview(item.kind, Some(&item.mime))
                .then(|| attachment_info(app, item)),
            item: item.clone(),
        })
        .collect();

    Ok(Snapshot {
        projects,
        session_count,
        recent_sessions,
        file_count: files.len(),
        file_bytes,
        recent_files,
        jobs: app.job_overviews(JOBS)?,
        due_cards: app.due_count(None)?,
        report: app.machine_report()?,
        transcription_installed: app.model_installed(LocalModel::Transcription),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::TempApp;

    #[test]
    fn the_seeded_workspace_fills_every_part_of_the_dashboard() -> study_core::Result<()> {
        let app = TempApp::new();
        assert!(app.seed_demo()?);
        let snapshot = load(&app)?;
        assert_eq!(snapshot.projects.len(), 5);
        assert_eq!(snapshot.session_count, 14);
        assert_eq!(snapshot.recent_sessions.len(), RECENT_SESSIONS);
        // Most recently active first.
        let times: Vec<_> = snapshot
            .recent_sessions
            .iter()
            .map(|entry| entry.session.updated_at)
            .collect();
        assert!(times.windows(2).all(|pair| pair[0] >= pair[1]));
        assert_eq!(snapshot.recent_files.len(), RECENT_FILES);
        assert!(snapshot.file_bytes > 0);
        assert_eq!(snapshot.count(JobStatus::Failed), 2);
        assert!(snapshot.report.is_none());
        assert_eq!(
            snapshot.busiest_project(),
            Some(snapshot.recent_sessions[0].session.project_id)
        );
        Ok(())
    }
}
