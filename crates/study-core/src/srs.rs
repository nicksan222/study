//! Spaced repetition with FSRS-5, the scheduler Anki uses: each card has a memory
//! *stability* (days until recall falls to 90%) and a *difficulty* (1–10). Every review
//! updates both from the grade, and the next review is due when recall is expected to drop
//! to 90%. The default parameters are FSRS-5's, fitted on millions of reviews; the review
//! log is kept so they can be fitted to one student later.

use serde::{Deserialize, Serialize};

crate::text_enum! {
    /// How well a card was remembered.
    pub enum Rating {
        /// Forgotten: the card comes back in a few minutes.
        Again = "again",
        /// Remembered with serious effort.
        Hard = "hard",
        /// Remembered.
        Good = "good",
        /// Remembered without effort.
        Easy = "easy",
    }
}

impl Rating {
    /// FSRS's grade, 1 for [`Again`](Self::Again) to 4 for [`Easy`](Self::Easy).
    pub fn grade(self) -> u8 {
        match self {
            Self::Again => 1,
            Self::Hard => 2,
            Self::Good => 3,
            Self::Easy => 4,
        }
    }
}

/// FSRS-5's default parameters.
const W: [f64; 19] = [
    0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925,
    1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
];
const DECAY: f64 = -0.5;
/// Makes recall exactly 90% after `stability` days: `0.9^(1 / DECAY) - 1`.
const FACTOR: f64 = 19.0 / 81.0;
const DAY: i64 = 86_400;
/// When a forgotten card comes back.
const RELEARN_SECS: i64 = 10 * 60;
/// The longest interval, so a card is never scheduled out of reach.
const MAX_INTERVAL_DAYS: f64 = 36_500.0;

/// What the scheduler knows about one card.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Memory {
    /// Days until recall is expected to fall to 90%; 0 before the first review.
    pub stability: f64,
    /// 1 (easy) to 10 (hard); 0 before the first review.
    pub difficulty: f64,
    pub reps: u32,
    /// Times it was forgotten after being learned.
    pub lapses: u32,
    /// Unix seconds of the last review.
    pub last_review: Option<i64>,
    /// Unix seconds when it is next due.
    pub due: i64,
}

impl Memory {
    /// A card never reviewed, due at `now`.
    pub fn new(now: i64) -> Self {
        Self {
            stability: 0.0,
            difficulty: 0.0,
            reps: 0,
            lapses: 0,
            last_review: None,
            due: now,
        }
    }

    /// The memory after a review graded `rating` at `now`.
    pub fn review(self, rating: Rating, now: i64) -> Self {
        let grade = f64::from(rating.grade());
        let (stability, difficulty) = match self.last_review {
            None => (initial_stability(grade), initial_difficulty(grade)),
            Some(last) => {
                let days = (now - last).max(0) as f64 / DAY as f64;
                let difficulty = next_difficulty(self.difficulty, grade);
                let stability = if days < 1.0 {
                    // Reviewed again the same day: recall barely decayed.
                    self.stability * (W[17] * (grade - 3.0 + W[18])).exp()
                } else {
                    let recall = retrievability(days, self.stability);
                    if rating == Rating::Again {
                        forgotten_stability(self.difficulty, self.stability, recall)
                    } else {
                        recalled_stability(self.difficulty, self.stability, recall, grade)
                    }
                };
                (stability, difficulty)
            }
        };
        let stability = stability.clamp(0.01, MAX_INTERVAL_DAYS);
        let due = if rating == Rating::Again {
            now + RELEARN_SECS
        } else {
            let days = stability.round().clamp(1.0, MAX_INTERVAL_DAYS);
            now + days as i64 * DAY
        };
        Self {
            stability,
            difficulty,
            reps: self.reps + 1,
            lapses: self.lapses + u32::from(rating == Rating::Again && self.last_review.is_some()),
            last_review: Some(now),
            due,
        }
    }
}

/// The chance of recalling a card `days` after its last review.
fn retrievability(days: f64, stability: f64) -> f64 {
    if stability <= 0.0 {
        return 0.0;
    }
    (1.0 + FACTOR * days / stability).powf(DECAY)
}

fn initial_stability(grade: f64) -> f64 {
    W[grade as usize - 1].max(0.1)
}

fn initial_difficulty(grade: f64) -> f64 {
    (W[4] - (W[5] * (grade - 1.0)).exp() + 1.0).clamp(1.0, 10.0)
}

fn next_difficulty(difficulty: f64, grade: f64) -> f64 {
    let change = -W[6] * (grade - 3.0);
    // Changes shrink near the top, so a hard card does not stay pinned at 10.
    let damped = difficulty + change * (10.0 - difficulty) / 9.0;
    let reverted = W[7] * initial_difficulty(4.0) + (1.0 - W[7]) * damped;
    reverted.clamp(1.0, 10.0)
}

fn recalled_stability(difficulty: f64, stability: f64, recall: f64, grade: f64) -> f64 {
    let hard = if grade == 2.0 { W[15] } else { 1.0 };
    let easy = if grade == 4.0 { W[16] } else { 1.0 };
    stability
        * (1.0
            + W[8].exp()
                * (11.0 - difficulty)
                * stability.powf(-W[9])
                * ((W[10] * (1.0 - recall)).exp() - 1.0)
                * hard
                * easy)
}

fn forgotten_stability(difficulty: f64, stability: f64, recall: f64) -> f64 {
    let forgotten = W[11]
        * difficulty.powf(-W[12])
        * ((stability + 1.0).powf(W[13]) - 1.0)
        * (W[14] * (1.0 - recall)).exp();
    forgotten.min(stability / (W[17] * W[18]).exp())
}

crate::preferences! {
    /// How reviews are paced.
    #[preferences(scope = "review")]
    #[derive(Copy)]
    pub struct ReviewPreferences {
        /// Most cards reviewed for the first time in a day, so a large new set comes in
        /// over several days instead of all at once.
        pub new_cards_per_day: u32 = 20,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_800_000_000;

    #[test]
    fn a_new_card_starts_from_its_first_grade() {
        let good = Memory::new(NOW).review(Rating::Good, NOW);
        assert!((good.stability - 3.173).abs() < 1e-9);
        assert_eq!(good.due, NOW + 3 * DAY);
        assert_eq!((good.reps, good.lapses), (1, 0));
        let easy = Memory::new(NOW).review(Rating::Easy, NOW);
        assert!(easy.stability > good.stability && easy.difficulty < good.difficulty);
        let again = Memory::new(NOW).review(Rating::Again, NOW);
        assert_eq!(again.due, NOW + RELEARN_SECS);
    }

    #[test]
    fn remembering_on_time_grows_the_interval_and_forgetting_shrinks_it() {
        let learned = Memory::new(NOW).review(Rating::Good, NOW);
        let later = learned.due;
        let recalled = learned.review(Rating::Good, later);
        assert!(recalled.stability > learned.stability * 2.0);
        assert!(recalled.due - later > learned.due - NOW);

        let forgotten = recalled.review(Rating::Again, recalled.due);
        assert!(forgotten.stability < recalled.stability);
        assert_eq!(forgotten.lapses, 1);
        assert_eq!(forgotten.due, recalled.due + RELEARN_SECS);
    }

    #[test]
    fn recall_is_ninety_percent_after_stability_days() {
        assert!((retrievability(10.0, 10.0) - 0.9).abs() < 1e-9);
        assert!(retrievability(0.0, 10.0) > 0.999);
        assert_eq!(retrievability(5.0, 0.0), 0.0);
    }

    #[test]
    fn difficulty_stays_between_one_and_ten() {
        let mut memory = Memory::new(NOW).review(Rating::Again, NOW);
        let mut now = NOW;
        for _ in 0..20 {
            now += 2 * DAY;
            memory = memory.review(Rating::Again, now);
            assert!((1.0..=10.0).contains(&memory.difficulty));
        }
        for _ in 0..20 {
            now = memory.due;
            memory = memory.review(Rating::Easy, now);
            assert!((1.0..=10.0).contains(&memory.difficulty));
        }
    }
}
