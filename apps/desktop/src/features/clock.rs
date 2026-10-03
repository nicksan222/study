//! Stored times read on this computer's clock. A stored time is in seconds since the Unix
//! epoch.

use chrono::{DateTime, Datelike as _, Local, Timelike as _};
use study_core::Day;
use study_localization::Locale;

/// The current time as stored in the database, in seconds since the Unix epoch.
pub use study_core::db::unix_timestamp as now;

/// When `at` happened, in local time relative to today, such as `14:03` or
/// `Yesterday 14:03`.
pub fn moment(locale: Locale, at: i64) -> String {
    let at = local(at);
    study_localization::moment(locale, today(), day_of(&at), (at.hour(), at.minute()))
}

/// The local time of day of `at`, such as `14:03`.
pub fn time_of_day(at: i64) -> String {
    let at = local(at);
    study_localization::time_of_day(at.hour(), at.minute())
}

/// The local calendar day of `at`.
pub fn local_day(at: i64) -> Day {
    day_of(&local(at))
}

/// The day of `at` as a divider in a conversation names it, such as `Today` or `29 Sep`.
pub fn day(locale: Locale, at: i64) -> String {
    study_localization::day_label(locale, today(), local_day(at))
}

/// Today on this computer's calendar.
pub fn today() -> Day {
    day_of(&Local::now())
}

/// The file name a recording started at `started_at` is posted under, named for its local
/// start.
pub fn recording_file_name(locale: Locale, started_at: i64) -> String {
    let at = local(started_at);
    study_localization::recording_file_name(locale, day_of(&at), (at.hour(), at.minute()))
}

/// The file name of an image pasted now, with the `extension` of its format.
pub fn pasted_image_name(locale: Locale, extension: &str) -> String {
    let now = Local::now();
    study_localization::pasted_image_name(
        locale,
        day_of(&now),
        (now.hour(), now.minute(), now.second()),
        extension,
    )
}

/// `at` on this computer's clock; the epoch when it is out of range.
fn local(at: i64) -> DateTime<Local> {
    DateTime::from_timestamp(at, 0)
        .unwrap_or_default()
        .with_timezone(&Local)
}

/// The calendar day `at` falls on.
fn day_of(at: &DateTime<Local>) -> Day {
    Day::new(at.year(), at.month(), at.day()).expect("chrono keeps to real dates")
}
