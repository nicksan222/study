//! The [`crate::preferences!`] macro.

/// Declares a group of preferences that one crate owns, stored under its own scope.
///
/// ```
/// use study_core::preferences::Count;
///
/// study_core::preferences! {
///     /// How lectures are turned into text.
///     #[preferences(scope = "example", form = ExampleForm)]
///     pub struct ExamplePreferences {
///         /// Whether pauses split the text into paragraphs.
///         pub paragraphs: bool = true,
///         /// Copies of the model kept in memory.
///         pub instances: Count<4> = Count::ONE,
///     }
/// }
///
/// # fn main() -> study_core::Result<()> {
/// # let dir = tempfile::tempdir()?;
/// # let database = study_core::db::Database::open(dir.path().join("study.sqlite3"))?;
/// let form = ExampleForm { paragraphs: false, instances: " 2 ".into() };
/// let preferences = form.parse()?;
/// preferences.save(&database)?;
/// assert_eq!(ExamplePreferences::load(&database)?, preferences);
/// # Ok(())
/// # }
/// ```
///
/// Every field is a [`Preference`](crate::preferences::Preference) with a default. The macro
/// writes:
///
/// - the struct, with `Default` built from the field defaults;
/// - `load` and `save` against the [`Database`](crate::db::Database), one row per field, so
///   fields can be added later without a migration and missing ones read as their default;
/// - `load_or`, which reads missing ones from another value instead, such as a
///   recommendation that must not override what the user chose;
/// - any `#[derive(...)]` or other attributes after `#[preferences(...)]`, on the struct;
/// - with `form = Name`, a form struct holding every field as typed, with `From<&Struct>` and
///   a `parse` that checks every field.
#[macro_export]
macro_rules! preferences {
    (
        $(#[doc = $doc:literal])*
        #[preferences(scope = $scope:literal, form = $form:ident)]
        $(#[$extra:meta])*
        $vis:vis struct $name:ident {
            $(
                $(#[doc = $field_doc:literal])*
                $field_vis:vis $field:ident : $ty:ty = $default:expr
            ),* $(,)?
        }
    ) => {
        $crate::preferences! {
            $(#[doc = $doc])*
            #[preferences(scope = $scope)]
            $(#[$extra])*
            $vis struct $name {
                $(
                    $(#[doc = $field_doc])*
                    $field_vis $field: $ty = $default
                ),*
            }
        }

        #[doc = concat!("[`", stringify!($name), "`] as typed into a settings form; [`Self::parse`] checks it.")]
        #[derive(Clone, Debug, Default, Eq, PartialEq)]
        $vis struct $form {
            $(
                $(#[doc = $field_doc])*
                $field_vis $field: <$ty as $crate::preferences::Preference>::Form,
            )*
        }

        impl From<&$name> for $form {
            fn from(preferences: &$name) -> Self {
                Self {
                    $($field: $crate::preferences::Preference::to_form(&preferences.$field),)*
                }
            }
        }

        #[allow(dead_code)]
        impl $form {
            /// Checks every field, including ones the page is not showing, so nothing
            /// stored is a value the page could not have produced.
            pub fn parse(&self) -> Result<$name, $crate::preferences::Invalid> {
                Ok($name {
                    $($field: $crate::preferences::Preference::from_form(&self.$field)?,)*
                })
            }
        }
    };

    (
        $(#[doc = $doc:literal])*
        #[preferences(scope = $scope:literal)]
        $(#[$extra:meta])*
        $vis:vis struct $name:ident {
            $(
                $(#[doc = $field_doc:literal])*
                $field_vis:vis $field:ident : $ty:ty = $default:expr
            ),* $(,)?
        }
    ) => {
        $(#[doc = $doc])*
        #[derive(Clone, Debug, Eq, PartialEq)]
        $(#[$extra])*
        $vis struct $name {
            $(
                $(#[doc = $field_doc])*
                $field_vis $field: $ty,
            )*
        }

        impl Default for $name {
            fn default() -> Self {
                Self {
                    $($field: $default,)*
                }
            }
        }

        // Not every crate uses every method the macro writes.
        #[allow(dead_code)]
        impl $name {
            /// Where these preferences are stored; unique across the app.
            pub const SCOPE: &'static str = $scope;

            /// The stored values, with defaults for anything never saved.
            pub fn load(
                database: &$crate::db::Database,
            ) -> $crate::Result<Self> {
                Self::load_or(database, Self::default())
            }

            /// The stored values, with `fallback`'s for anything never saved: how a
            /// recommendation fills only what the user never chose.
            pub fn load_or(
                database: &$crate::db::Database,
                fallback: Self,
            ) -> $crate::Result<Self> {
                let stored = database.load_preferences(Self::SCOPE)?;
                Ok(Self {
                    $($field: stored.get(stringify!($field))?.unwrap_or(fallback.$field),)*
                })
            }

            /// Stores every field, one row each.
            pub fn save(
                &self,
                database: &$crate::db::Database,
            ) -> $crate::Result<()> {
                database.save_preferences(Self::SCOPE, &self.entries()?)
            }

            fn entries(
                &self,
            ) -> $crate::Result<Vec<(&'static str, String)>> {
                Ok(vec![
                    $((stringify!($field), $crate::preferences::encode(&self.$field)?),)*
                ])
            }
        }

        impl $crate::preferences::PreferenceSet for $name {
            const SCOPE: &'static str = $scope;

            fn load(
                database: &$crate::db::Database,
            ) -> $crate::Result<Self> {
                Self::load(database)
            }

            fn save(
                &self,
                database: &$crate::db::Database,
            ) -> $crate::Result<()> {
                Self::save(self, database)
            }
        }
    };
}
