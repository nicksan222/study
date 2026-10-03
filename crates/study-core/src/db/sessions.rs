//! Sessions: the logs of notes, files and answers inside a study project. Their messages
//! are in `messages`.

use super::{Database, MAX_TITLE_CHARS, trimmed, unix_timestamp};
use crate::Result;
use crate::{ProjectId, SessionId};
use rusqlite::{OptionalExtension as _, Row, params};

/// The columns [`ChatSession::from_row`] maps; add `WHERE`/`ORDER BY`.
pub(super) const SELECT_SESSION: &str =
    "SELECT id, project_id, title, title_source, created_at, updated_at FROM sessions";

/// A stored session.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ChatSession {
    pub id: SessionId,
    pub project_id: ProjectId,
    pub title: String,
    pub title_source: TitleSource,
    pub created_at: i64,
    pub updated_at: i64,
}

crate::text_enum! {
    /// Where a session's title came from, which decides whether it may still be replaced.
    pub enum TitleSource {
        /// A stand-in, such as the first line of the first message, until a model names it.
        Provisional = "provisional",
        /// Written by a model; replaced only when the user asks for a new one.
        Generated = "generated",
        /// Typed by the user; never replaced.
        User = "user",
    }
}

impl ChatSession {
    /// Maps a row of [`SELECT_SESSION`].
    pub(super) fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get(0)?,
            project_id: row.get(1)?,
            title: row.get(2)?,
            title_source: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        })
    }
}

impl Database {
    /// A project's sessions, most recently active first.
    pub fn list_sessions(&self, project_id: ProjectId) -> Result<Vec<ChatSession>> {
        let mut statement = self.connection.prepare(&format!(
            "{SELECT_SESSION} WHERE project_id = ?1 ORDER BY updated_at DESC, id DESC"
        ))?;
        let sessions = statement
            .query_map(params![project_id], ChatSession::from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(sessions)
    }

    /// Every session in every project, most recently active first.
    pub fn list_all_sessions(&self) -> Result<Vec<ChatSession>> {
        let mut statement = self.connection.prepare(&format!(
            "{SELECT_SESSION} ORDER BY updated_at DESC, id DESC"
        ))?;
        let sessions = statement
            .query_map([], ChatSession::from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(sessions)
    }

    /// One session, or `None` when no session has this `id`.
    pub fn session(&self, id: SessionId) -> Result<Option<ChatSession>> {
        let session = self
            .connection
            .query_row(
                &format!("{SELECT_SESSION} WHERE id = ?1"),
                params![id],
                ChatSession::from_row,
            )
            .optional()?;
        Ok(session)
    }

    /// A session named by the user. Fails when the project does not exist.
    pub fn create_session(&self, project_id: ProjectId, title: &str) -> Result<ChatSession> {
        self.insert_session(project_id, title, TitleSource::User)
    }

    /// A session whose `placeholder` title stands in until a model names it with
    /// [`Self::set_generated_title`]. Fails when the project does not exist.
    pub fn create_untitled_session(
        &self,
        project_id: ProjectId,
        placeholder: &str,
    ) -> Result<ChatSession> {
        self.insert_session(project_id, placeholder, TitleSource::Provisional)
    }

    fn insert_session(
        &self,
        project_id: ProjectId,
        title: &str,
        source: TitleSource,
    ) -> Result<ChatSession> {
        let title = normalize_title(title)?;
        let timestamp = unix_timestamp();
        self.connection.execute(
            "INSERT INTO sessions (project_id, title, title_source, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)",
            params![project_id, title, source, timestamp],
        )?;
        Ok(ChatSession {
            id: SessionId::new(self.connection.last_insert_rowid()),
            project_id,
            title,
            title_source: source,
            created_at: timestamp,
            updated_at: timestamp,
        })
    }

    /// Replaces a provisional title with one a model wrote. Returns `false`, changing
    /// nothing, when the session is gone or its title is no longer provisional. Activity
    /// order is kept: naming a session is not activity.
    pub fn set_generated_title(&self, id: SessionId, title: &str) -> Result<bool> {
        let title = normalize_title(title)?;
        let changed = self.connection.execute(
            "UPDATE sessions SET title = ?1, title_source = 'generated'
             WHERE id = ?2 AND title_source = 'provisional'",
            params![title, id],
        )?;
        Ok(changed != 0)
    }

    /// Replaces any title, even one the user typed, with one a model wrote because the user
    /// asked for a new one. Returns `false` when the session is gone.
    pub fn replace_with_generated_title(&self, id: SessionId, title: &str) -> Result<bool> {
        let title = normalize_title(title)?;
        let changed = self.connection.execute(
            "UPDATE sessions SET title = ?1, title_source = 'generated' WHERE id = ?2",
            params![title, id],
        )?;
        Ok(changed != 0)
    }

    /// Returns `false` when no session has this `id`. Its messages are deleted; attached
    /// files stay in the Library.
    pub fn delete_session(&self, id: SessionId) -> Result<bool> {
        let changed = self
            .connection
            .execute("DELETE FROM sessions WHERE id = ?1", params![id])?;
        Ok(changed != 0)
    }
}

/// Trims a session title, typed or generated, and checks its length.
fn normalize_title(title: &str) -> Result<String> {
    trimmed(title, "session title", MAX_TITLE_CHARS)
}

#[cfg(test)]
mod tests {
    use crate::Result;
    use crate::db::{Database, TitleSource};
    use crate::{ProjectId, SessionId};

    #[test]
    fn sessions_belong_to_one_project_and_list_most_recent_first() -> Result<()> {
        let (_dir, db) = Database::temporary()?;
        let biology = db.create_project("Biology")?;
        let history = db.create_project("History")?;
        let first = db.create_session(biology.id, "  Cells  ")?;
        let second = db.create_session(biology.id, "Genetics")?;
        db.create_session(history.id, "Rome")?;

        assert_eq!(first.title, "Cells");
        assert_eq!(first.title_source, TitleSource::User);
        let listed = db.list_sessions(biology.id)?;
        assert_eq!(
            listed.iter().map(|s| s.id).collect::<Vec<_>>(),
            [second.id, first.id]
        );
        assert_eq!(db.session(first.id)?, Some(first));
        Ok(())
    }

    #[test]
    fn session_titles_are_validated_and_projects_must_exist() -> Result<()> {
        let (_dir, db) = Database::temporary()?;
        let project = db.create_project("Biology")?;
        assert!(db.create_session(project.id, "   ").is_err());
        assert!(db.create_session(project.id, &"x".repeat(201)).is_err());
        let orphan = db
            .create_session(ProjectId::new(project.id.get() + 100), "Orphan")
            .unwrap_err();
        assert_eq!(orphan.kind(), crate::ErrorKind::NotFound);
        Ok(())
    }

    #[test]
    fn sessions_can_be_deleted() -> Result<()> {
        let (_dir, db) = Database::temporary()?;
        let project = db.create_project("Biology")?;
        let session = db.create_session(project.id, "Cells")?;
        assert!(db.delete_session(session.id)?);
        assert!(!db.delete_session(session.id)?);
        Ok(())
    }

    #[test]
    fn deleting_a_project_deletes_its_sessions() -> Result<()> {
        let (_dir, db) = Database::temporary()?;
        let project = db.create_project("Biology")?;
        let session = db.create_session(project.id, "Cells")?;
        db.delete_project(project.id)?;
        assert_eq!(db.session(session.id)?, None);
        Ok(())
    }

    #[test]
    fn a_generated_title_replaces_only_a_provisional_one() -> Result<()> {
        let (_dir, db) = Database::temporary()?;
        let project = db.create_project("Biology")?;
        let session = db.create_untitled_session(project.id, "what are mitochondria")?;
        assert_eq!(session.title_source, TitleSource::Provisional);

        assert!(db.set_generated_title(session.id, "Mitochondria basics")?);
        let named = db.session(session.id)?.unwrap();
        assert_eq!(named.title, "Mitochondria basics");
        assert_eq!(named.title_source, TitleSource::Generated);
        assert_eq!(
            named.updated_at, session.updated_at,
            "naming is not activity"
        );
        assert!(
            !db.set_generated_title(session.id, "Again")?,
            "a session is named once"
        );

        let typed = db.create_session(project.id, "My own title")?;
        assert!(!db.set_generated_title(typed.id, "Model title")?);
        assert_eq!(db.session(typed.id)?.unwrap().title, "My own title");
        assert!(!db.set_generated_title(SessionId::new(typed.id.get() + 100), "Missing")?);

        assert!(db.replace_with_generated_title(typed.id, "Asked for anew")?);
        let replaced = db.session(typed.id)?.unwrap();
        assert_eq!(replaced.title, "Asked for anew");
        assert_eq!(replaced.title_source, TitleSource::Generated);
        assert!(!db.replace_with_generated_title(SessionId::new(typed.id.get() + 100), "Missing")?);
        Ok(())
    }
}
