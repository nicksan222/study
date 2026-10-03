//! [`Error`]: the error every library crate returns. It keeps what went wrong (the original
//! error and its causes), what was being done (context lines, outermost last), and what kind
//! of failure it is ([`ErrorKind`]), so a caller can decide without reading text.
//!
//! It works like `anyhow`, which is kept to binaries and tests (golden rule 5): `?` converts
//! any standard error, [`Context`] adds what was being done, [`bail!`](crate::bail!) and
//! [`err!`](crate::err!) build one from a message, and `{:#}` prints the whole chain.

use std::error::Error as StdError;
use std::fmt;
use std::time::Duration;

use super::{Classify, ErrorKind, Failure};

/// `Result` with [`Error`] as the default error.
pub type Result<T, E = Error> = std::result::Result<T, E>;

/// A classified error with its causes and context. Build one with `?` from any standard error
/// (kind [`ErrorKind::Internal`], or [`ErrorKind::NotFound`] for a write naming a row that is
/// gone), with [`Error::new`] or [`err!`](crate::err!), or from a
/// classified error with [`Error::classified`]; set a kind with [`Error::with_kind`].
///
/// It deliberately does not implement [`std::error::Error`], so that `?` can turn every
/// standard error into it.
pub struct Error {
    kind: ErrorKind,
    retry_after: Option<Duration>,
    /// The original error; its own causes follow through `source()`.
    root: Box<dyn StdError + Send + Sync + 'static>,
    /// What was being done, innermost first.
    context: Vec<String>,
}

/// A plain message as a standard error, for errors that start from text.
#[derive(Debug)]
struct Message(String);

impl fmt::Display for Message {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl StdError for Message {}

impl Error {
    /// An error of `kind` that starts from a message.
    pub fn new(kind: ErrorKind, message: impl fmt::Display) -> Self {
        Self::msg(message).with_kind(kind)
    }

    /// An [`ErrorKind::Internal`] error that starts from a message.
    pub fn msg(message: impl fmt::Display) -> Self {
        Self::from_std(Message(message.to_string()))
    }

    /// Keeps a classified error's kind and retry hint, which a plain `?` would drop.
    pub fn classified(error: impl Classify + StdError + Send + Sync + 'static) -> Self {
        let kind = error.kind();
        let retry_after = error.retry_after();
        let mut this = Self::from_std(error);
        this.kind = kind;
        this.retry_after = retry_after;
        this
    }

    fn from_std(error: impl StdError + Send + Sync + 'static) -> Self {
        Self {
            kind: Self::kind_of(&error),
            retry_after: None,
            root: Box::new(error),
            context: Vec::new(),
        }
    }

    /// The same error, as a failure of `kind`.
    pub fn with_kind(mut self, kind: ErrorKind) -> Self {
        self.kind = kind;
        self
    }

    /// Adds what was being done when this happened.
    pub fn context(mut self, context: impl fmt::Display) -> Self {
        self.context.push(context.to_string());
        self
    }

    /// What kind of failure this is.
    pub fn kind(&self) -> ErrorKind {
        self.kind
    }

    /// The original error and its causes, outermost first. Context lines are not errors and
    /// are not included; use this to look for a specific cause with `downcast_ref`.
    pub fn chain(&self) -> impl Iterator<Item = &(dyn StdError + 'static)> {
        let root: &(dyn StdError + 'static) = &*self.root;
        std::iter::successors(Some(root), |&error| error.source())
    }

    /// The original error, if it is an `E`.
    pub fn downcast_ref<E: StdError + 'static>(&self) -> Option<&E> {
        self.root.downcast_ref::<E>()
    }

    /// The kind a standard error starts as. A write SQLite's foreign key check refused named
    /// a row that is gone, such as a source deleted while the work ran: every reference in
    /// the schema cascades or clears on delete, so only a missing parent fails the check (or a
    /// code missing from its codes table, a bug `check_lists_match_the_rust_enums` catches).
    /// Anything else is [`ErrorKind::Internal`].
    fn kind_of(error: &(dyn StdError + 'static)) -> ErrorKind {
        let missing_parent = std::iter::successors(Some(error), |&error| error.source())
            .filter_map(|cause| cause.downcast_ref::<rusqlite::Error>())
            .any(|error| {
                matches!(
                    error,
                    rusqlite::Error::SqliteFailure(failure, _)
                        if failure.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_FOREIGNKEY
                )
            });
        if missing_parent {
            ErrorKind::NotFound
        } else {
            ErrorKind::Internal
        }
    }

    /// Whether SQLite gave up waiting for another connection's write somewhere in the chain.
    fn database_busy(&self) -> bool {
        use rusqlite::ErrorCode::{DatabaseBusy, DatabaseLocked};
        self.chain().any(|cause| {
            cause
                .downcast_ref::<rusqlite::Error>()
                .and_then(rusqlite::Error::sqlite_error_code)
                .is_some_and(|code| matches!(code, DatabaseBusy | DatabaseLocked))
        })
    }

    /// Every line, outermost first: the context, then the original error and its causes.
    /// A cause whose text its wrapper already ends with is left out.
    fn lines(&self) -> Vec<String> {
        let mut lines: Vec<String> = self.context.iter().rev().cloned().collect();
        let mut previous = String::new();
        for cause in self.chain() {
            let text = cause.to_string();
            if !previous.ends_with(&text) {
                lines.push(text.clone());
            }
            previous = text;
        }
        lines
    }
}

impl<E: StdError + Send + Sync + 'static> From<E> for Error {
    fn from(error: E) -> Self {
        Self::from_std(error)
    }
}

impl Classify for Error {
    fn kind(&self) -> ErrorKind {
        self.kind
    }

    fn retry_after(&self) -> Option<Duration> {
        self.retry_after
    }
}

/// Keeps the error's kind, except that a database busy with a long write is worth another
/// try, wherever the error came from.
impl From<Error> for Failure {
    fn from(error: Error) -> Self {
        let kind = if error.database_busy() {
            ErrorKind::Transient
        } else {
            error.kind
        };
        Self {
            kind,
            retry_after: error.retry_after,
            message: format!("{error:#}"),
        }
    }
}

/// `{}` is the outermost line; `{:#}` is every line, joined by `: `.
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let lines = self.lines();
        if f.alternate() {
            f.write_str(&lines.join(": "))
        } else {
            f.write_str(lines.first().map_or("", String::as_str))
        }
    }
}

/// The outermost line, then each cause on its own line, as a test failure shows it.
impl fmt::Debug for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let lines = self.lines();
        let mut lines = lines.iter();
        if let Some(first) = lines.next() {
            f.write_str(first)?;
        }
        let mut causes = lines.peekable();
        if causes.peek().is_some() {
            f.write_str("\n\nCaused by:")?;
            for cause in causes {
                write!(f, "\n    {cause}")?;
            }
        }
        write!(f, "\n\nKind: {:?}", self.kind)
    }
}

/// Adds what was being done to a failed `Result` or a missing `Option`.
pub trait Context<T> {
    /// Adds `context` to the error.
    fn context(self, context: impl fmt::Display) -> Result<T>;

    /// Adds the context `context()` builds, only when there is an error.
    fn with_context<C: fmt::Display>(self, context: impl FnOnce() -> C) -> Result<T>;
}

impl<T, E: Into<Error>> Context<T> for std::result::Result<T, E> {
    fn context(self, context: impl fmt::Display) -> Result<T> {
        self.map_err(|error| error.into().context(context))
    }

    fn with_context<C: fmt::Display>(self, context: impl FnOnce() -> C) -> Result<T> {
        self.map_err(|error| error.into().context(context()))
    }
}

impl<T> Context<T> for Option<T> {
    fn context(self, context: impl fmt::Display) -> Result<T> {
        self.ok_or_else(|| Error::msg(context))
    }

    fn with_context<C: fmt::Display>(self, context: impl FnOnce() -> C) -> Result<T> {
        self.ok_or_else(|| Error::msg(context()))
    }
}

/// An [`Error`] from a format string, of kind [`ErrorKind::Internal`] unless a kind comes
/// first: `err!("no session {id}")` or `err!(ErrorKind::NotFound, "no session {id}")`.
#[macro_export]
macro_rules! err {
    ($kind:path, $fmt:literal $($arg:tt)*) => {
        $crate::error::Error::new($kind, ::std::format!($fmt $($arg)*))
    };
    ($fmt:literal $($arg:tt)*) => {
        $crate::error::Error::msg(::std::format!($fmt $($arg)*))
    };
    ($error:expr $(,)?) => {
        $crate::error::Error::msg($error)
    };
}

/// Returns early with an [`err!`](crate::err!).
#[macro_export]
macro_rules! bail {
    ($($arg:tt)*) => {
        return ::std::result::Result::Err($crate::err!($($arg)*).into())
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug)]
    struct Outer(std::io::Error);

    impl fmt::Display for Outer {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.write_str("cannot read the file")
        }
    }

    impl StdError for Outer {
        fn source(&self) -> Option<&(dyn StdError + 'static)> {
            Some(&self.0)
        }
    }

    fn failing() -> Result<()> {
        let missing = std::io::Error::new(std::io::ErrorKind::NotFound, "no such file");
        Err(Outer(missing)).context("loading lecture.mp3")?;
        Ok(())
    }

    #[test]
    fn the_chain_reads_outermost_first() {
        let error = failing().unwrap_err();
        assert_eq!(error.to_string(), "loading lecture.mp3");
        assert_eq!(
            format!("{error:#}"),
            "loading lecture.mp3: cannot read the file: no such file"
        );
        assert_eq!(error.kind(), ErrorKind::Internal);
        assert!(error.chain().any(|cause| cause.is::<std::io::Error>()));
        assert!(error.downcast_ref::<Outer>().is_some());
    }

    #[test]
    fn context_keeps_the_kind_and_failures_carry_it() {
        let error = Error::new(ErrorKind::NotFound, "no session 7").context("renaming");
        let failure = Failure::from(error);
        assert_eq!(failure.kind, ErrorKind::NotFound);
        assert_eq!(failure.message, "renaming: no session 7");
    }

    #[test]
    fn a_busy_database_fails_as_transient() {
        let busy = rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_BUSY),
            None,
        );
        let error = Error::from(busy).context("saving the job");
        assert_eq!(error.kind(), ErrorKind::Internal);
        assert_eq!(Failure::from(error).kind, ErrorKind::Transient);
    }

    #[test]
    fn a_write_naming_a_missing_row_fails_as_not_found() {
        let connection = rusqlite::Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE parents (id INTEGER PRIMARY KEY);
                 CREATE TABLE children (parent_id INTEGER NOT NULL REFERENCES parents(id));",
            )
            .unwrap();
        let refused = connection
            .execute("INSERT INTO children (parent_id) VALUES (7)", [])
            .unwrap_err();
        let error = Error::from(refused).context("adding a child");
        assert_eq!(error.kind(), ErrorKind::NotFound);
        let unique = connection
            .execute_batch("CREATE TABLE parents (id INTEGER PRIMARY KEY)")
            .unwrap_err();
        assert_eq!(Error::from(unique).kind(), ErrorKind::Internal);
    }

    #[test]
    fn a_missing_option_becomes_an_error() {
        let error = None::<u8>.context("no project").unwrap_err();
        assert_eq!(format!("{error:#}"), "no project");
    }

    #[test]
    fn the_macros_build_and_return_errors() {
        fn check(id: u8) -> Result<u8> {
            if id == 0 {
                crate::bail!(ErrorKind::InvalidInput, "id {id} is not valid");
            }
            Ok(id)
        }
        let error = check(0).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidInput);
        assert_eq!(error.to_string(), "id 0 is not valid");
        assert_eq!(crate::err!("plain {}", 1).kind(), ErrorKind::Internal);
    }

    #[test]
    fn a_classified_error_keeps_its_kind() {
        let missing = std::io::Error::new(std::io::ErrorKind::NotFound, "gone");
        assert_eq!(Error::classified(missing).kind(), ErrorKind::NotFound);
    }
}
