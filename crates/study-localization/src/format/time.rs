//! Ages, durations, clocks, dates and timestamps, and the file names they date: a recording's
//! and a pasted image's.

use study_core::Day;

use crate::{Locale, Message, joined, text};

/// How long ago something happened, in the shortest form: `now`, `5m`, `3h`, `2d`, `4w`.
pub fn age(locale: Locale, seconds: i64) -> String {
    let seconds = seconds.max(0);
    if seconds < 60 {
        return text(locale, Message::Now).to_owned();
    }
    let (value, english, italian) = match seconds {
        ..3600 => (seconds / 60, "m", " min"),
        3600..86_400 => (seconds / 3600, "h", " h"),
        86_400..604_800 => (seconds / 86_400, "d", " g"),
        _ => (seconds / 604_800, "w", " sett"),
    };
    let unit = match locale {
        Locale::English => english,
        Locale::Italian => italian,
    };
    format!("{value}{unit}")
}

/// When something happened, as time since: `just now`, `5m ago`.
pub fn ago(locale: Locale, seconds: i64) -> String {
    if seconds < 60 {
        return text(locale, Message::JustNow).to_owned();
    }
    match locale {
        Locale::English => format!("{} ago", age(locale, seconds)),
        Locale::Italian => format!("{} fa", age(locale, seconds)),
    }
}

/// How long a job ran, from whole seconds.
pub fn job_duration(seconds: i64) -> String {
    let seconds = seconds.max(0);
    if seconds < 60 {
        format!("{seconds} s")
    } else {
        format!("{} min {} s", seconds / 60, seconds % 60)
    }
}

/// A status label followed by how long it took, such as "Finished · 12 s".
pub fn status_with_duration(status: &str, seconds: i64) -> String {
    joined(&[status.to_owned(), job_duration(seconds)])
}

/// How long a recording has been going, such as `03:12` or `1:02:03`.
pub fn recording_clock(seconds: u64) -> String {
    match hours_minutes_seconds(seconds) {
        (0, minutes, seconds) => format!("{minutes:02}:{seconds:02}"),
        (hours, minutes, seconds) => format!("{hours}:{minutes:02}:{seconds:02}"),
    }
}

/// Where in the session's recording a note was written, from `ms` into it: `at 12:34 in
/// the recording`.
pub fn recording_moment(locale: Locale, ms: u64) -> String {
    let clock = recording_clock(ms / 1_000);
    match locale {
        Locale::English => format!("at {clock} in the recording"),
        Locale::Italian => format!("al minuto {clock} della registrazione"),
    }
}

/// A moment in a recording, such as `4:05` or `1:02:03`.
pub(super) fn timestamp(ms: u64) -> String {
    match hours_minutes_seconds(ms / 1000) {
        (0, minutes, seconds) => format!("{minutes}:{seconds:02}"),
        (hours, minutes, seconds) => format!("{hours}:{minutes:02}:{seconds:02}"),
    }
}

fn hours_minutes_seconds(seconds: u64) -> (u64, u64, u64) {
    (seconds / 3600, seconds / 60 % 60, seconds % 60)
}

/// A time of day on the 24-hour clock, such as `14:03`, the same in every locale.
pub fn time_of_day(hour: u32, minute: u32) -> String {
    format!("{hour:02}:{minute:02}")
}

/// When something was sent on `day`, by the reader's calendar: `14:03` on `today`,
/// `Yesterday 14:03`, `29 Sep 14:03` earlier this year, and `29 Sep 2025` before that.
pub fn moment(locale: Locale, today: Day, day: Day, (hour, minute): (u32, u32)) -> String {
    let clock = time_of_day(hour, minute);
    let (date, month) = (day.day(), month_name(locale, day.month()));
    match today.days_since(day) {
        0 => clock,
        1 => format!("{} {clock}", text(locale, Message::Yesterday)),
        _ if day.year() == today.year() => format!("{date} {month} {clock}"),
        _ => format!("{date} {month} {}", day.year()),
    }
}

/// The day a stretch of a conversation was written on, as a divider names it: `Today`,
/// `Yesterday`, `29 Sep` earlier this year, and `29 Sep 2025` before that.
pub fn day_label(locale: Locale, today: Day, day: Day) -> String {
    let (date, month) = (day.day(), month_name(locale, day.month()));
    match today.days_since(day) {
        0 => text(locale, Message::Today).to_owned(),
        1 => text(locale, Message::Yesterday).to_owned(),
        _ if day.year() == today.year() => format!("{date} {month}"),
        _ => format!("{date} {month} {}", day.year()),
    }
}

/// A month's short name, from 1 for January.
fn month_name(locale: Locale, month: u32) -> &'static str {
    let names = match locale {
        Locale::English => [
            "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
        ],
        Locale::Italian => [
            "gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic",
        ],
    };
    names[(month.clamp(1, 12) - 1) as usize]
}

/// The Library file name of a recording started on `day` at the given local time, such as
/// `Recording 2026-09-29 14.03.wav`.
pub fn recording_file_name(locale: Locale, day: Day, (hour, minute): (u32, u32)) -> String {
    let word = text(locale, Message::RecordingSessionTitle);
    format!("{word} {day} {hour:02}.{minute:02}.wav")
}

/// The file name of an image pasted on `day` at the given local time, with the `extension`
/// of its format, such as `Pasted image 2026-09-30 21.04.07.png`. Seconds keep two pastes
/// apart.
pub fn pasted_image_name(
    locale: Locale,
    day: Day,
    (hour, minute, second): (u32, u32, u32),
    extension: &str,
) -> String {
    let words = text(locale, Message::PastedImageName);
    format!("{words} {day} {hour:02}.{minute:02}.{second:02}.{extension}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(year: i32, month: u32, day: u32) -> Day {
        Day::new(year, month, day).unwrap()
    }

    #[test]
    fn a_day_is_named_by_how_long_ago_it_was() {
        let today = day(2026, 10, 1);
        assert_eq!(day_label(Locale::English, today, today), "Today");
        assert_eq!(day_label(Locale::Italian, today, day(2026, 9, 30)), "Ieri");
        assert_eq!(day_label(Locale::English, today, day(2026, 9, 3)), "3 Sep");
        assert_eq!(
            day_label(Locale::Italian, today, day(2025, 12, 24)),
            "24 dic 2025"
        );
    }

    #[test]
    fn a_pasted_image_is_named_by_when_it_was_pasted() {
        assert_eq!(
            pasted_image_name(Locale::English, day(2026, 9, 30), (21, 4, 7), "png"),
            "Pasted image 2026-09-30 21.04.07.png"
        );
        assert_eq!(
            pasted_image_name(Locale::Italian, day(2026, 1, 2), (3, 4, 5), "jpg"),
            "Immagine incollata 2026-01-02 03.04.05.jpg"
        );
    }

    #[test]
    fn ages_are_short_and_localized() {
        assert_eq!(age(Locale::English, 30), "now");
        assert_eq!(age(Locale::English, 300), "5m");
        assert_eq!(age(Locale::Italian, 2 * 86_400), "2 g");
        assert_eq!(ago(Locale::Italian, 3 * 3600), "3 h fa");
        assert_eq!(job_duration(125), "2 min 5 s");
        assert_eq!(recording_clock(192), "03:12");
        assert_eq!(recording_clock(3723), "1:02:03");
    }

    #[test]
    fn an_age_moves_to_the_next_unit_at_its_boundary() {
        let age = |seconds| age(Locale::English, seconds);
        assert_eq!(age(-5), "now");
        assert_eq!(age(59), "now");
        assert_eq!(age(60), "1m");
        assert_eq!(age(3599), "59m");
        assert_eq!(age(3600), "1h");
        assert_eq!(age(86_399), "23h");
        assert_eq!(age(86_400), "1d");
        assert_eq!(age(604_799), "6d");
        assert_eq!(age(604_800), "1w");
    }

    #[test]
    fn moments_read_by_the_calendar() {
        let today = day(2026, 3, 1);
        assert_eq!(moment(Locale::English, today, today, (9, 5)), "09:05");
        // The day before the first of March, in a year that is not a leap year.
        assert_eq!(
            moment(Locale::English, today, day(2026, 2, 28), (23, 59)),
            "Yesterday 23:59"
        );
        assert_eq!(
            moment(Locale::Italian, today, day(2026, 2, 28), (8, 0)),
            "Ieri 08:00"
        );
        assert_eq!(
            moment(Locale::English, today, day(2026, 1, 15), (14, 3)),
            "15 Jan 14:03"
        );
        assert_eq!(
            moment(Locale::Italian, today, day(2025, 9, 29), (14, 3)),
            "29 set 2025"
        );
    }
}
