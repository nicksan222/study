//! [`Day`]: a date on the calendar, without a time or a time zone, such as the day of an
//! exam. Stored as `YYYY-MM-DD`; the difference between two is a whole number of days.

use std::fmt;
use std::str::FromStr;

use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};

/// A calendar date.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct Day {
    year: i32,
    month: u32,
    day: u32,
}

impl Day {
    /// The date, when it is one: a year of 0 to 9999 (all SQLite's `date()` handles), a
    /// month of 1 to 12 and a day that month has.
    pub fn new(year: i32, month: u32, day: u32) -> Option<Self> {
        if !(0..=9999).contains(&year) {
            return None;
        }
        let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
        let days = match month {
            1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
            4 | 6 | 9 | 11 => 30,
            2 if leap => 29,
            2 => 28,
            _ => return None,
        };
        (1..=days)
            .contains(&day)
            .then_some(Self { year, month, day })
    }

    /// The year.
    pub fn year(self) -> i32 {
        self.year
    }

    /// The month, 1 to 12.
    pub fn month(self) -> u32 {
        self.month
    }

    /// The day of the month, from 1.
    pub fn day(self) -> u32 {
        self.day
    }

    /// Days from `earlier` to this day: negative when this day comes first.
    pub fn days_since(self, earlier: Day) -> i64 {
        self.ordinal() - earlier.ordinal()
    }

    /// Days since 1970-01-01, by the proleptic Gregorian calendar.
    fn ordinal(self) -> i64 {
        // Howard Hinnant's days-from-civil.
        let (year, month, day) = (
            i64::from(self.year),
            i64::from(self.month),
            i64::from(self.day),
        );
        let year = if month <= 2 { year - 1 } else { year };
        let era = year.div_euclid(400);
        let year_of_era = year - era * 400;
        let day_of_year = (153 * ((month + 9) % 12) + 2) / 5 + day - 1;
        let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
        era * 146_097 + day_of_era - 719_468
    }
}

impl fmt::Display for Day {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:04}-{:02}-{:02}", self.year, self.month, self.day)
    }
}

impl FromStr for Day {
    type Err = crate::Error;

    /// Reads `YYYY-MM-DD`; anything else fails with
    /// [`ErrorKind::InvalidInput`](crate::ErrorKind::InvalidInput).
    fn from_str(text: &str) -> crate::Result<Self> {
        let mut parts = text.splitn(3, '-');
        let mut read = || {
            let year = parts.next()?.parse().ok()?;
            let month = parts.next()?.parse().ok()?;
            let day = parts.next()?.parse().ok()?;
            Day::new(year, month, day)
        };
        read().ok_or_else(|| crate::err!(crate::ErrorKind::InvalidInput, "{text:?} is not a date"))
    }
}

impl ToSql for Day {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::from(self.to_string()))
    }
}

impl FromSql for Day {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        value
            .as_str()?
            .parse()
            .map_err(|error: crate::Error| FromSqlError::Other(format!("{error:#}").into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_day_reads_back_and_counts_the_days_between() {
        let exam: Day = "2026-10-20".parse().unwrap();
        assert_eq!(exam.to_string(), "2026-10-20");
        let today = Day::new(2026, 10, 1).unwrap();
        assert_eq!(exam.days_since(today), 19);
        assert_eq!(today.days_since(exam), -19);
        let new_year = Day::new(2027, 1, 1).unwrap();
        assert_eq!(new_year.days_since(Day::new(2026, 12, 31).unwrap()), 1);
        assert_eq!(Day::new(2028, 2, 29).map(|day| day.day()), Some(29));
        assert!(Day::new(2026, 2, 29).is_none());
        assert!(Day::new(10_000, 1, 1).is_none());
        assert!(Day::new(-1, 1, 1).is_none());
        assert_eq!(Day::new(9999, 12, 31).unwrap().to_string(), "9999-12-31");
        for text in [
            "2026-13-01",
            "soon",
            "2026-10",
            "-2026-10-01",
            "10000-01-01",
        ] {
            let error = text.parse::<Day>().unwrap_err();
            assert_eq!(error.kind(), crate::ErrorKind::InvalidInput, "{text}");
        }
    }
}
