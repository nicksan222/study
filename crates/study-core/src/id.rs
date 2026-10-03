//! Newtype IDs, so a session's ID can never be passed where a source's is expected.

/// Declares `#[repr(transparent)]` newtypes over the `i64` row IDs SQLite assigns.
///
/// ```
/// study_core::id! {
///     /// A widget's row.
///     pub struct WidgetId;
/// }
///
/// let id = WidgetId::new(7);
/// assert_eq!(id.get(), 7);
/// assert_eq!(id.to_string(), "7");
/// ```
///
/// Each ID serializes as its number, and binds and reads as an SQLite `INTEGER`.
#[macro_export]
macro_rules! id {
    ($($(#[$meta:meta])* $vis:vis struct $name:ident;)+) => {$(
        $(#[$meta])*
        #[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
        #[repr(transparent)]
        $vis struct $name(i64);

        impl $name {
            /// Wraps a row ID read from the database.
            pub const fn new(raw: i64) -> Self {
                Self(raw)
            }

            /// The row ID.
            pub const fn get(self) -> i64 {
                self.0
            }
        }

        impl ::std::fmt::Display for $name {
            fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
                ::std::fmt::Display::fmt(&self.0, f)
            }
        }

        impl $crate::__private::serde::Serialize for $name {
            fn serialize<S: $crate::__private::serde::Serializer>(
                &self,
                serializer: S,
            ) -> ::std::result::Result<S::Ok, S::Error> {
                serializer.serialize_i64(self.0)
            }
        }

        impl<'de> $crate::__private::serde::Deserialize<'de> for $name {
            fn deserialize<D: $crate::__private::serde::Deserializer<'de>>(
                deserializer: D,
            ) -> ::std::result::Result<Self, D::Error> {
                <i64 as $crate::__private::serde::Deserialize>::deserialize(deserializer).map(Self)
            }
        }

        impl $crate::__private::rusqlite::types::ToSql for $name {
            fn to_sql(
                &self,
            ) -> $crate::__private::rusqlite::Result<
                $crate::__private::rusqlite::types::ToSqlOutput<'_>,
            > {
                Ok(self.0.into())
            }
        }

        impl $crate::__private::rusqlite::types::FromSql for $name {
            fn column_result(
                value: $crate::__private::rusqlite::types::ValueRef<'_>,
            ) -> $crate::__private::rusqlite::types::FromSqlResult<Self> {
                value.as_i64().map(Self)
            }
        }
    )+};
}

id! {
    /// A study subject.
    pub struct ProjectId;
    /// Something the user brought in: a file, an attachment, a recording, a URL or a note.
    pub struct SourceId;
    /// A chat.
    pub struct SessionId;
    /// One message in a chat.
    pub struct MessageId;
    /// One part of a message: text, or a reference to a source.
    pub struct PartId;
    /// The text read from a source.
    pub struct DocumentId;
    /// One unit of background work.
    pub struct JobId;
    /// A microphone recording, in progress or ready to send.
    pub struct RecordingId;
    /// A search passage.
    pub struct ChunkId;
    /// Generated study material: notes, flashcards, a quiz or a diagram.
    pub struct ArtifactId;
    /// One flashcard, scheduled for review.
    pub struct CardId;
    /// An endless quiz over sessions the student picked.
    pub struct PracticeId;
    /// One question of a practice, with the student's answer once given.
    pub struct QuestionId;
}
