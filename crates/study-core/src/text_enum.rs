//! Enums whose variants each have a stable text code, for storage and serialization.

use std::fmt;

/// A code that names no variant of the enum being parsed.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UnknownCode {
    /// The enum that was being parsed.
    pub type_name: &'static str,
    /// The code that matched none of its variants.
    pub code: String,
}

impl fmt::Display for UnknownCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "unknown {} `{}`", self.type_name, self.code)
    }
}

impl std::error::Error for UnknownCode {}

/// Declares an enum stored and serialized as a short text code per variant.
///
/// ```
/// study_core::text_enum! {
///     /// How a job ended.
///     pub enum Outcome {
///         Done = "done",
///         Failed = "failed",
///     }
/// }
///
/// assert_eq!(Outcome::from_code("failed"), Some(Outcome::Failed));
/// assert_eq!(Outcome::Done.code(), "done");
/// assert_eq!(Outcome::ALL, [Outcome::Done, Outcome::Failed]);
/// assert_eq!("done".parse::<Outcome>(), Ok(Outcome::Done));
/// ```
///
/// The enum derives `Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd`; add
/// `#[derive(Default)]` and `#[default]` on a variant when it has one. It gets `ALL`, `code`,
/// `from_code`, `Display`, `FromStr`, serde as its code, and `ToSql`/`FromSql`. A table
/// column holding it references a table of every code; test that they match with `ALL`.
///
/// Adding a variant is one line: everything above follows from it. Codes are stored, so rename
/// one only with a migration (see `db::migrations`); two variants sharing a code fail to
/// compile:
///
/// ```compile_fail
/// study_core::text_enum! {
///     pub enum Clash {
///         One = "same",
///         Two = "same",
///     }
/// }
/// ```
#[macro_export]
macro_rules! text_enum {
    (
        $(#[$meta:meta])*
        $vis:vis enum $name:ident {
            $(
                $(#[$variant_meta:meta])*
                $variant:ident = $code:literal
            ),+ $(,)?
        }
    ) => {
        $(#[$meta])*
        #[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
        $vis enum $name {
            $(
                $(#[$variant_meta])*
                $variant,
            )+
        }

        // A private enum may use only some of what the macro writes.
        #[allow(dead_code)]
        impl $name {
            /// Every variant, in declaration order.
            pub const ALL: &'static [Self] = &[$(Self::$variant),+];

            /// The stored code.
            pub const fn code(self) -> &'static str {
                match self {
                    $(Self::$variant => $code,)+
                }
            }

            /// The variant stored as `code`, if any.
            pub fn from_code(code: &str) -> Option<Self> {
                match code {
                    $($code => Some(Self::$variant),)+
                    _ => None,
                }
            }
        }

        const _: () = assert!(
            $crate::__private::distinct(&[$($code),+]),
            concat!("two `", stringify!($name), "` variants share a code"),
        );

        impl ::std::fmt::Display for $name {
            fn fmt(&self, f: &mut ::std::fmt::Formatter<'_>) -> ::std::fmt::Result {
                f.write_str(self.code())
            }
        }

        impl ::std::str::FromStr for $name {
            type Err = $crate::UnknownCode;

            fn from_str(code: &str) -> ::std::result::Result<Self, Self::Err> {
                Self::from_code(code).ok_or_else(|| $crate::UnknownCode {
                    type_name: stringify!($name),
                    code: code.to_owned(),
                })
            }
        }

        impl $crate::__private::serde::Serialize for $name {
            fn serialize<S: $crate::__private::serde::Serializer>(
                &self,
                serializer: S,
            ) -> ::std::result::Result<S::Ok, S::Error> {
                serializer.serialize_str(self.code())
            }
        }

        impl<'de> $crate::__private::serde::Deserialize<'de> for $name {
            fn deserialize<D: $crate::__private::serde::Deserializer<'de>>(
                deserializer: D,
            ) -> ::std::result::Result<Self, D::Error> {
                let code = <::std::borrow::Cow<'de, str> as $crate::__private::serde::Deserialize>::deserialize(deserializer)?;
                code.parse().map_err(<D::Error as $crate::__private::serde::de::Error>::custom)
            }
        }

        impl $crate::__private::rusqlite::types::ToSql for $name {
            fn to_sql(
                &self,
            ) -> $crate::__private::rusqlite::Result<
                $crate::__private::rusqlite::types::ToSqlOutput<'_>,
            > {
                Ok(self.code().into())
            }
        }

        impl $crate::__private::rusqlite::types::FromSql for $name {
            fn column_result(
                value: $crate::__private::rusqlite::types::ValueRef<'_>,
            ) -> $crate::__private::rusqlite::types::FromSqlResult<Self> {
                let code = value.as_str()?;
                code.parse().map_err(|error| {
                    $crate::__private::rusqlite::types::FromSqlError::Other(::std::boxed::Box::new(error))
                })
            }
        }
    };
}

/// Whether no two of `codes` are equal; `text_enum!` checks its codes with it at compile time.
pub const fn distinct(codes: &[&str]) -> bool {
    let mut i = 0;
    while i < codes.len() {
        let mut j = i + 1;
        while j < codes.len() {
            if same(codes[i].as_bytes(), codes[j].as_bytes()) {
                return false;
            }
            j += 1;
        }
        i += 1;
    }
    true
}

const fn same(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut i = 0;
    while i < a.len() {
        if a[i] != b[i] {
            return false;
        }
        i += 1;
    }
    true
}
