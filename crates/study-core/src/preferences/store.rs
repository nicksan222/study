//! Preference rows in the database: one JSON value per `(scope, key)`.
//!
//! The [`crate::preferences!`] macro is the usual caller; it turns fields into rows and
//! back. Anything else worth remembering across launches, such as a measured result, can use
//! a scope of its own the same way.

use std::collections::HashMap;

use rusqlite::params;
use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::db::Database;
use crate::{Context as _, Result};

/// The raw values stored for one scope.
pub struct Stored {
    scope: &'static str,
    values: HashMap<String, String>,
}

impl Stored {
    /// The value saved for `key`, or `None` if it was never saved. A value that no longer
    /// parses is an error rather than a silent reset.
    pub fn get<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>> {
        self.values
            .get(key)
            .map(|json| serde_json::from_str(json))
            .transpose()
            .with_context(|| format!("bad stored preference {}.{key}", self.scope))
    }
}

/// A value as its stored JSON text.
pub fn encode(value: &impl Serialize) -> Result<String> {
    serde_json::to_string(value).context("cannot encode a preference")
}

impl Database {
    /// Every value saved in `scope`, still encoded.
    pub fn load_preferences(&self, scope: &'static str) -> Result<Stored> {
        let mut statement = self
            .connection
            .prepare("SELECT key, value FROM preferences WHERE scope = ?1")?;
        let values = statement
            .query_map([scope], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<rusqlite::Result<_>>()
            .with_context(|| format!("cannot load {scope} preferences"))?;
        Ok(Stored { scope, values })
    }

    /// Sets one value in `scope`, or removes it with `None`, leaving the others as they are:
    /// for settings saved one at a time, where saving the whole group could undo another
    /// save made at the same moment.
    pub fn set_preference(&self, scope: &str, key: &str, value: Option<&str>) -> Result<()> {
        match value {
            Some(value) => self.connection.execute(
                "INSERT INTO preferences (scope, key, value) VALUES (?1, ?2, ?3)
                 ON CONFLICT (scope, key) DO UPDATE SET value = excluded.value",
                params![scope, key, value],
            )?,
            None => self.connection.execute(
                "DELETE FROM preferences WHERE scope = ?1 AND key = ?2",
                params![scope, key],
            )?,
        };
        Ok(())
    }

    /// Replaces every value in `scope` in one transaction.
    pub fn save_preferences(
        &self,
        scope: &str,
        entries: &[(impl AsRef<str>, String)],
    ) -> Result<()> {
        let transaction = self.immediate()?;
        transaction.execute("DELETE FROM preferences WHERE scope = ?1", [scope])?;
        for (key, value) in entries {
            transaction.execute(
                "INSERT INTO preferences (scope, key, value) VALUES (?1, ?2, ?3)",
                params![scope, key.as_ref(), value],
            )?;
        }
        transaction
            .commit()
            .with_context(|| format!("cannot save {scope} preferences"))
    }
}
