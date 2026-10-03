//! Study projects: the subjects sources and sessions are organized under.

use super::{Database, trimmed, unix_timestamp};
use crate::Result;
use crate::{Day, ProjectId};
use rusqlite::{OptionalExtension as _, Row, params};

const MAX_NAME_CHARS: usize = 100;

/// A stored project.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Project {
    pub id: ProjectId,
    pub name: String,
    /// The day of the course's exam, when the student set one.
    pub exam_on: Option<Day>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl Project {
    /// Map a `SELECT id, name, exam_on, created_at, updated_at` row.
    fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get(0)?,
            name: row.get(1)?,
            exam_on: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
        })
    }
}

impl Database {
    /// All projects, newest first.
    pub fn list_projects(&self) -> Result<Vec<Project>> {
        let mut statement = self.connection.prepare(
            "SELECT id, name, exam_on, created_at, updated_at
             FROM projects
             ORDER BY id DESC",
        )?;
        let projects = statement
            .query_map([], Project::from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(projects)
    }

    /// The project `id`, or `None` when there is none.
    pub fn project(&self, id: ProjectId) -> Result<Option<Project>> {
        Ok(self
            .connection
            .query_row(
                "SELECT id, name, exam_on, created_at, updated_at FROM projects WHERE id = ?1",
                params![id],
                Project::from_row,
            )
            .optional()?)
    }

    /// Stores a new project named `name`, trimmed.
    pub fn create_project(&self, name: &str) -> Result<Project> {
        let name = normalize_name(name)?;
        let timestamp = unix_timestamp();
        self.connection.execute(
            "INSERT INTO projects (name, created_at, updated_at)
             VALUES (?1, ?2, ?2)",
            params![name, timestamp],
        )?;
        Ok(Project {
            id: ProjectId::new(self.connection.last_insert_rowid()),
            name,
            exam_on: None,
            created_at: timestamp,
            updated_at: timestamp,
        })
    }

    /// Returns `false` when no project has this `id`.
    pub fn rename_project(&self, id: ProjectId, name: &str) -> Result<bool> {
        let name = normalize_name(name)?;
        let changed = self.connection.execute(
            "UPDATE projects SET name = ?1, updated_at = ?2 WHERE id = ?3",
            params![name, unix_timestamp(), id],
        )?;
        Ok(changed != 0)
    }

    /// Sets the day of the project's exam, or clears it with `None`. Returns `false` when
    /// no project has this `id`.
    pub fn set_exam(&self, id: ProjectId, exam_on: Option<Day>) -> Result<bool> {
        let changed = self.connection.execute(
            "UPDATE projects SET exam_on = ?1, updated_at = ?2 WHERE id = ?3",
            params![exam_on, unix_timestamp(), id],
        )?;
        Ok(changed != 0)
    }

    /// Returns `false` when no project has this `id`. Its chat sessions and study material
    /// (with its cards and their reviews) are deleted; sources in the project are kept and
    /// detached by the schema.
    pub fn delete_project(&self, id: ProjectId) -> Result<bool> {
        let changed = self
            .connection
            .execute("DELETE FROM projects WHERE id = ?1", params![id])?;
        Ok(changed != 0)
    }
}

/// Trims a project name and checks its length.
fn normalize_name(name: &str) -> Result<String> {
    trimmed(name, "project name", MAX_NAME_CHARS)
}

#[cfg(test)]
mod tests {
    use crate::db::Database;
    use crate::{Day, ErrorKind, ProjectId, Result};

    #[test]
    fn projects_persist_and_are_sorted_newest_first() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join("study.sqlite3");
        let db = Database::open(&path)?;
        let first = db.create_project("  Biology  ")?;
        let second = db.create_project("Biology")?;
        assert_eq!(first.name, "Biology");
        assert_eq!(db.list_projects()?, vec![second.clone(), first.clone()]);
        drop(db);

        let reopened = Database::open(&path)?;
        assert_eq!(reopened.list_projects()?, vec![second, first]);
        Ok(())
    }

    #[test]
    fn project_names_are_validated_before_writing() -> Result<()> {
        let (_dir, db) = Database::temporary()?;
        for name in [" \n\t ".to_owned(), "x".repeat(101)] {
            let error = db.create_project(&name).unwrap_err();
            assert_eq!(error.kind(), ErrorKind::InvalidInput, "{name:?}");
        }
        assert_eq!(db.list_projects()?.len(), 0);
        let project = db.create_project(&"é".repeat(100))?;
        assert_eq!(project.name.chars().count(), 100);
        Ok(())
    }

    #[test]
    fn projects_can_be_renamed_and_deleted() -> Result<()> {
        let (_dir, db) = Database::temporary()?;
        let project = db.create_project("Original")?;
        assert!(db.rename_project(project.id, "  Renamed  ")?);
        assert_eq!(db.list_projects()?[0].name, "Renamed");
        assert!(!db.rename_project(ProjectId::new(999), "Missing")?);
        assert!(db.delete_project(project.id)?);
        assert!(!db.delete_project(project.id)?);
        assert!(db.list_projects()?.is_empty());
        Ok(())
    }

    #[test]
    fn a_project_keeps_its_exam_day_until_cleared() -> Result<()> {
        let (_dir, db) = Database::temporary()?;
        let project = db.create_project("Biology")?;
        assert_eq!(project.exam_on, None);
        let exam = Day::new(2026, 10, 20).unwrap();
        assert!(db.set_exam(project.id, Some(exam))?);
        assert_eq!(db.list_projects()?[0].exam_on, Some(exam));
        // Every day there is fits the column's check.
        for edge in [Day::new(0, 1, 1), Day::new(9999, 12, 31)] {
            assert!(db.set_exam(project.id, edge)?);
            assert_eq!(db.list_projects()?[0].exam_on, edge);
        }
        assert!(db.set_exam(project.id, None)?);
        assert_eq!(db.list_projects()?[0].exam_on, None);
        assert!(!db.set_exam(ProjectId::new(999), None)?);
        Ok(())
    }
}
