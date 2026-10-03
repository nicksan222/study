//! How a student is doing with their flashcards, counted on this computer's calendar: the
//! reviews this week and what comes due in the next week (in one project, or all of them),
//! and the streak of days with a review anywhere (studying another course keeps it).

use crate::features::clock::local_day;
use std::collections::BTreeSet;
use study_app::App;
use study_core::{Day, ProjectId};

/// How far back reviews are read: enough for any streak worth showing.
const HISTORY_DAYS: i64 = 400;
/// What "this week" and "coming up" span.
const WEEK_DAYS: i64 = 7;
const DAY_SECONDS: i64 = 86_400;

/// Review progress, in a project or everywhere.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Progress {
    /// Reviews in the last seven days, today included.
    pub this_week: usize,
    /// Days in a row with a review in any project, ending today, or yesterday while today
    /// has none yet.
    pub streak: usize,
    /// Cards due by a week from now, those due now included.
    pub coming_up: usize,
}

/// The progress in `project`, or everywhere, at `now` (seconds since the Unix epoch).
pub fn read(app: &App, project: Option<ProjectId>, now: i64) -> study_core::Result<Progress> {
    let since = now - HISTORY_DAYS * DAY_SECONDS;
    let today = local_day(now);
    let days = |times: Vec<i64>| -> Vec<Day> { times.into_iter().map(local_day).collect() };
    let here = days(app.review_times(project, since)?);
    let anywhere = days(app.review_times(None, since)?);
    Ok(Progress {
        this_week: here
            .iter()
            .filter(|day| today.days_since(**day) < WEEK_DAYS)
            .count(),
        streak: streak(&anywhere, today),
        coming_up: app.due_by(project, now + WEEK_DAYS * DAY_SECONDS)?,
    })
}

/// Days in a row with a review in `days`, ending `today`, or yesterday when `today` has
/// none yet: the streak is not lost before the day is over.
fn streak(days: &[Day], today: Day) -> usize {
    let days_ago: BTreeSet<i64> = days.iter().map(|day| today.days_since(*day)).collect();
    let last = if days_ago.contains(&0) { 0 } else { 1 };
    (last..).take_while(|ago| days_ago.contains(ago)).count()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(month: u32, day: u32) -> Day {
        Day::new(2026, month, day).unwrap()
    }

    #[test]
    fn a_streak_counts_days_in_a_row_and_waits_for_today() {
        let today = day(10, 1);
        let reviewed = [day(9, 28), day(9, 29), day(9, 30), day(9, 30)];
        assert_eq!(streak(&reviewed, today), 3, "today can still come");
        let with_today = [day(9, 30), day(10, 1)];
        assert_eq!(streak(&with_today, today), 2);
        let broken = [day(9, 27), day(9, 29)];
        assert_eq!(streak(&broken, today), 0);
        assert_eq!(streak(&[], today), 0);
    }
}
