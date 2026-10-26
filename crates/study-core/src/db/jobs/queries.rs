//! Reading jobs: one job, the jobs on a subject, the pipelines overview, and where a job's
//! news should go.

use super::super::messages::Scope;
use super::super::{Database, placeholders};
use super::{
    JOB_COLUMNS, JOB_SESSION, JOB_SOURCE, JOB_WIDTH, Job, JobOverview, JobScope, JobTarget, PENDING,
};
use crate::Result;
use crate::{JobId, JobKind, MessageId, PracticeId, QuestionId, SessionId, SourceId};
use rusqlite::{Connection, OptionalExtension as _, params, params_from_iter};
use std::collections::HashMap;

/// The reads of `sources` still under way, using the caller's transaction, so new work can
/// wait for them.
pub(in crate::db) fn pending_reads_of(
    connection: &Connection,
    sources: &[SourceId],
) -> Result<Vec<JobId>> {
    if sources.is_empty() {
        return Ok(Vec::new());
    }
    let reads = connection
        .prepare(&format!(
            "SELECT id FROM jobs WHERE kind = '{}' AND source_id IN ({})
             AND status IN {PENDING}",
            JobKind::Extract,
            placeholders(sources.len())
        ))?
        .query_map(params_from_iter(sources), |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(reads)
}

/// The jobs writing questions of `practice` still under way, using the caller's
/// transaction, so the next question can wait for them and see what they asked.
pub(in crate::db) fn pending_questions_of(
    connection: &Connection,
    practice: PracticeId,
) -> Result<Vec<JobId>> {
    let jobs = connection
        .prepare(&format!(
            "SELECT j.id FROM jobs j JOIN practice_questions q ON q.id = j.question_id
             WHERE j.kind = '{}' AND q.practice_id = ?1 AND j.status IN {PENDING}",
            JobKind::Question
        ))?
        .query_map(params![practice], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(jobs)
}

impl Database {
    /// One job, or `None` once its subject took it along.
    pub fn job(&self, id: JobId) -> Result<Option<Job>> {
        let job = self
            .connection
            .query_row(
                &format!("SELECT {JOB_COLUMNS} FROM jobs j WHERE j.id = ?1"),
                params![id],
                Job::from_row,
            )
            .optional()?;
        Ok(job)
    }

    /// Every job on `target`, oldest first.
    pub fn jobs_for(&self, target: JobTarget) -> Result<Vec<Job>> {
        let (column, id) = target.column();
        let mut statement = self.connection.prepare(&format!(
            "SELECT {JOB_COLUMNS} FROM jobs j WHERE j.{column} = ?1 ORDER BY j.id"
        ))?;
        let jobs = statement
            .query_map(params![id], Job::from_row)?
            .collect::<rusqlite::Result<_>>()?;
        Ok(jobs)
    }

    /// The sessions with a job of `kind` not ended yet on them, leaving out one that only
    /// waits for the user to set something up: nothing is under way there.
    pub fn sessions_with_pending(&self, kind: JobKind) -> Result<Vec<SessionId>> {
        let mut statement = self.connection.prepare(&format!(
            "SELECT DISTINCT session_id FROM jobs
             WHERE kind = ?1 AND session_id IS NOT NULL AND status IN {PENDING}
               AND status != 'waiting'"
        ))?;
        let sessions = statement
            .query_map(params![kind], |row| row.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        Ok(sessions)
    }

    /// The source and chat a job concerns, for announcing its progress.
    pub(crate) fn job_scope(&self, id: JobId) -> Result<JobScope> {
        let scope = self
            .connection
            .query_row(
                &format!("SELECT {JOB_SOURCE}, {JOB_SESSION} FROM jobs j WHERE j.id = ?1"),
                params![id],
                |row| {
                    Ok(JobScope {
                        source_id: row.get(0)?,
                        session_id: row.get(1)?,
                    })
                },
            )
            .optional()?;
        Ok(scope.unwrap_or_default())
    }

    /// The newest `limit` jobs with what each works on and where, for the pipelines overview.
    pub fn list_job_overviews(&self, limit: usize) -> Result<Vec<JobOverview>> {
        let mut statement = self.connection.prepare(&format!(
            "SELECT {JOB_COLUMNS}, src.name, src.kind, src.id, s.id, s.title, pr.id, pr.name,
                 a.title, pcp.name, pc.id
             FROM jobs j
             LEFT JOIN sources src ON src.id = {JOB_SOURCE}
             LEFT JOIN sessions s ON s.id = {JOB_SESSION}
             LEFT JOIN artifacts a ON a.id = j.artifact_id
             LEFT JOIN practice_questions q ON q.id = j.question_id
             LEFT JOIN practices pc ON pc.id = q.practice_id
             LEFT JOIN projects pcp ON pcp.id = pc.project_id
             LEFT JOIN projects pr ON pr.id = coalesce(src.project_id, s.project_id, a.project_id)
             ORDER BY j.id DESC
             LIMIT ?1"
        ))?;
        let overviews = statement
            .query_map(params![limit as i64], |row| {
                let source_name: Option<String> = row.get(JOB_WIDTH)?;
                let session_title: Option<String> = row.get(JOB_WIDTH + 4)?;
                let artifact_title: Option<String> = row.get(JOB_WIDTH + 7)?;
                let practice_title: Option<String> = row.get(JOB_WIDTH + 8)?;
                Ok(JobOverview {
                    job: Job::from_row(row)?,
                    subject: source_name
                        .or(artifact_title)
                        .or(practice_title)
                        .or_else(|| session_title.clone())
                        .unwrap_or_default(),
                    source_kind: row.get(JOB_WIDTH + 1)?,
                    source_id: row.get(JOB_WIDTH + 2)?,
                    session_id: row.get(JOB_WIDTH + 3)?,
                    session_title,
                    project_id: row.get(JOB_WIDTH + 5)?,
                    project_name: row.get(JOB_WIDTH + 6)?,
                    practice_id: row.get(JOB_WIDTH + 9)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(overviews)
    }

    /// Every job that reads a source (extraction), newest attempt last, by source.
    pub(in crate::db) fn extract_jobs_by_source(
        &self,
        sources: &[SourceId],
    ) -> Result<HashMap<SourceId, Vec<Job>>> {
        let mut grouped: HashMap<SourceId, Vec<Job>> = HashMap::new();
        if sources.is_empty() {
            return Ok(grouped);
        }
        let mut statement = self.connection.prepare(&format!(
            "SELECT {JOB_COLUMNS} FROM jobs j
             WHERE j.kind = '{}' AND j.source_id IN ({})
             ORDER BY j.id",
            JobKind::Extract,
            placeholders(sources.len())
        ))?;
        for job in statement.query_map(params_from_iter(sources), Job::from_row)? {
            let job = job?;
            if let JobTarget::Source(source) = job.target {
                grouped.entry(source).or_default().push(job);
            }
        }
        Ok(grouped)
    }

    /// The latest job writing a version, a reply or a rewrite, of each message in `scope`.
    pub(in crate::db) fn reply_jobs_in(&self, scope: Scope) -> Result<HashMap<MessageId, Job>> {
        let mut statement = self.connection.prepare(&format!(
            "SELECT {JOB_COLUMNS} FROM jobs j
             JOIN messages m ON m.id = j.message_id
             WHERE j.kind IN ('{}', '{}') AND {}
             ORDER BY j.id",
            JobKind::Reply,
            JobKind::Rewrite,
            scope.condition()
        ))?;
        let mut latest = HashMap::new();
        for job in statement.query_map(params![scope.key()], Job::from_row)? {
            let job = job?;
            if let JobTarget::Message(message) = job.target {
                latest.insert(message, job);
            }
        }
        Ok(latest)
    }

    /// The latest job of each question of `practice`: the one writing it, or grading its
    /// answer once answered.
    pub(in crate::db) fn question_jobs_of(
        &self,
        practice: PracticeId,
    ) -> Result<HashMap<QuestionId, Job>> {
        let mut statement = self.connection.prepare(&format!(
            "SELECT {JOB_COLUMNS} FROM jobs j
             JOIN practice_questions q ON q.id = j.question_id
             WHERE q.practice_id = ?1
             ORDER BY j.id"
        ))?;
        let mut latest = HashMap::new();
        for job in statement.query_map(params![practice], Job::from_row)? {
            let job = job?;
            if let JobTarget::Question(question) = job.target {
                latest.insert(question, job);
            }
        }
        Ok(latest)
    }
}
