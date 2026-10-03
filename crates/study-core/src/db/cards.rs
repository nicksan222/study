//! Flashcards and their reviews. Each card keeps its FSRS memory; reviewing one updates it
//! and logs the review in one transaction. Cards are written when their flashcard set is
//! finished (see `artifacts.rs`); a set's body and its cards always change together. An update
//! of a set carries over the cards it shares with the set it replaces, matched by their
//! question (see [`card_key`]), so their ids, memory and reviews move to it. The cards it
//! drops go with the replaced set, reviews included.

use super::{Database, unix_timestamp};
use crate::text::collapse_whitespace;
use crate::{ArtifactBody, ArtifactId, CardId, Flashcard, Memory, ProjectId, Rating};
use crate::{ErrorKind, Result, bail};
use rusqlite::{Connection, OptionalExtension as _, Row, params};
use std::collections::HashSet;

/// A flashcard with its schedule.
#[derive(Clone, Debug, PartialEq)]
pub struct Card {
    pub id: CardId,
    pub artifact_id: ArtifactId,
    pub front: String,
    pub back: String,
    pub memory: Memory,
}

/// A card due for review, with the set it belongs to.
#[derive(Clone, Debug, PartialEq)]
pub struct DueCard {
    pub card: Card,
    pub artifact_title: String,
    pub project_id: ProjectId,
}

/// A change to one card of a flashcard set.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CardChange {
    /// New sides for the card; it keeps its schedule. At the set's end, a new card, due now.
    Write { front: String, back: String },
    /// The card goes, with its reviews.
    Delete,
}

/// The columns [`Card::from_row`] maps, from `cards c`.
const CARD_COLUMNS: &str =
    "c.id, c.artifact_id, c.front, c.back, c.stability, c.difficulty, c.reps, c.lapses,
     c.last_review, c.due";

/// Past any card's place, to move cards out of the way while renumbering.
const SHIFT: i64 = 1_000_000;

impl Database {
    /// Cards due by `now`, in `project` or everywhere, at most `limit`: every card already
    /// reviewed that is due, most overdue first, then those of the first `new_cards` never
    /// reviewed (in one order across projects) that are `project`'s, so a large new set does
    /// not swamp a day.
    pub fn due_cards(
        &self,
        project: Option<ProjectId>,
        now: i64,
        limit: usize,
        new_cards: usize,
    ) -> Result<Vec<DueCard>> {
        let mut statement = self.connection.prepare(&format!(
            "SELECT {CARD_COLUMNS}, a.title, a.project_id FROM cards c
             JOIN artifacts a ON a.id = c.artifact_id
             WHERE c.due <= ?1 AND (?2 IS NULL OR a.project_id = ?2)
               AND c.reps > 0
             ORDER BY c.due, c.id LIMIT ?3"
        ))?;
        let row = |row: &Row| -> rusqlite::Result<DueCard> {
            Ok(DueCard {
                card: Card::from_row(row)?,
                artifact_title: row.get(10)?,
                project_id: row.get(11)?,
            })
        };
        let mut cards: Vec<DueCard> = statement
            .query_map(params![now, project, limit as i64], row)?
            .collect::<rusqlite::Result<_>>()?;
        // New cards come in one order everywhere, so each project gets its share of the
        // day's allowance, and the projects' shares add up to it.
        let room = limit.saturating_sub(cards.len());
        let mut new = self.connection.prepare(&format!(
            "SELECT * FROM (
                 SELECT {CARD_COLUMNS}, a.title, a.project_id FROM cards c
                 JOIN artifacts a ON a.id = c.artifact_id
                 WHERE c.due <= ?1 AND c.reps = 0
                 ORDER BY c.due, c.id LIMIT ?3
             ) WHERE ?2 IS NULL OR project_id = ?2
             LIMIT ?4"
        ))?;
        cards.extend(
            new.query_map(params![now, project, new_cards as i64, room as i64], row)?
                .collect::<rusqlite::Result<Vec<_>>>()?,
        );
        Ok(cards)
    }

    /// How many cards [`due_cards`](Self::due_cards) would give without a limit: every card
    /// already reviewed that is due by `now`, and this project's share of the first
    /// `new_cards` never reviewed, so the projects' counts add up to the total.
    pub fn count_due_cards(
        &self,
        project: Option<ProjectId>,
        now: i64,
        new_cards: usize,
    ) -> Result<usize> {
        let seen: i64 = self.connection.query_row(
            "SELECT count(*) FROM cards c JOIN artifacts a ON a.id = c.artifact_id
             WHERE c.due <= ?1 AND c.reps > 0
               AND (?2 IS NULL OR a.project_id = ?2)",
            params![now, project],
            |row| row.get(0),
        )?;
        // This project's share of the new cards the day still allows, in the one order
        // `due_cards` takes them.
        let unseen: i64 = self.connection.query_row(
            "SELECT count(*) FROM (
                 SELECT a.project_id FROM cards c JOIN artifacts a ON a.id = c.artifact_id
                 WHERE c.due <= ?1 AND c.reps = 0
                 ORDER BY c.due, c.id LIMIT ?3
             ) WHERE ?2 IS NULL OR project_id = ?2",
            params![now, project, new_cards as i64],
            |row| row.get(0),
        )?;
        Ok((seen + unseen) as usize)
    }

    /// How many cards were reviewed for the first time since `since`: the new cards a day
    /// has already taken.
    pub fn new_cards_since(&self, since: i64) -> Result<usize> {
        let count: i64 = self.connection.query_row(
            "SELECT count(*) FROM (SELECT min(reviewed_at) AS first FROM reviews GROUP BY card_id)
             WHERE first >= ?1",
            params![since],
            |row| row.get(0),
        )?;
        Ok(count as usize)
    }

    /// When each review since `since` happened, in `project` or everywhere, oldest first:
    /// what a student's progress is counted from.
    pub fn review_times(&self, project: Option<ProjectId>, since: i64) -> Result<Vec<i64>> {
        let mut statement = self.connection.prepare(
            "SELECT r.reviewed_at FROM reviews r
             JOIN cards c ON c.id = r.card_id
             JOIN artifacts a ON a.id = c.artifact_id
             WHERE r.reviewed_at >= ?1 AND (?2 IS NULL OR a.project_id = ?2)
             ORDER BY r.reviewed_at",
        )?;
        let times = statement
            .query_map(params![since, project], |row| row.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        Ok(times)
    }

    /// The cards of a flashcard set, in order.
    pub fn cards_of(&self, artifact: ArtifactId) -> Result<Vec<Card>> {
        let mut statement = self.connection.prepare(&format!(
            "SELECT {CARD_COLUMNS} FROM cards c WHERE c.artifact_id = ?1 ORDER BY c.ordinal"
        ))?;
        let cards = statement
            .query_map(params![artifact], Card::from_row)?
            .collect::<rusqlite::Result<_>>()?;
        Ok(cards)
    }

    /// Records a review at `now` and reschedules the card. Returns its new memory, or `None`
    /// when the card is gone.
    pub fn review_card(&self, id: CardId, rating: Rating, now: i64) -> Result<Option<Memory>> {
        let tx = self.immediate()?;
        let card = tx
            .query_row(
                &format!("SELECT {CARD_COLUMNS} FROM cards c WHERE c.id = ?1"),
                params![id],
                Card::from_row,
            )
            .optional()?;
        let Some(card) = card else {
            return Ok(None);
        };
        let before = card.memory;
        let after = before.review(rating, now);
        let elapsed_days = before
            .last_review
            .map_or(0.0, |last| (now - last).max(0) as f64 / 86_400.0);
        tx.execute(
            "INSERT INTO reviews (card_id, rating, reviewed_at, stability, difficulty,
                 elapsed_days)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                id,
                rating,
                now,
                before.stability,
                before.difficulty,
                elapsed_days
            ],
        )?;
        tx.execute(
            "UPDATE cards SET stability = ?2, difficulty = ?3, reps = ?4, lapses = ?5,
                 last_review = ?6, due = ?7
             WHERE id = ?1",
            params![
                id,
                after.stability,
                after.difficulty,
                after.reps,
                after.lapses,
                after.last_review,
                after.due
            ],
        )?;
        tx.commit()?;
        Ok(Some(after))
    }

    /// Changes card `index` of the finished flashcard set `artifact`: the set's body and
    /// its cards change together, so what Study shows and what is reviewed stay one. Writing
    /// at the set's end adds a card. Returns `false` when there is no such set or card.
    pub fn set_card(
        &self,
        artifact: ArtifactId,
        index: usize,
        change: &CardChange,
    ) -> Result<bool> {
        let tx = self.immediate()?;
        let body: Option<String> = tx
            .query_row(
                "SELECT body FROM artifacts
                 WHERE id = ?1 AND kind = 'flashcards' AND status = 'complete'",
                params![artifact],
                |row| row.get(0),
            )
            .optional()?;
        let Some(body) = body else {
            return Ok(false);
        };
        let ArtifactBody::Flashcards { mut cards } = serde_json::from_str(&body)? else {
            return Ok(false);
        };
        let now = unix_timestamp();
        let changed = match change {
            CardChange::Write { front, back } => {
                write_card(&tx, artifact, &mut cards, index, front, back, now)?
            }
            CardChange::Delete => delete_card(&tx, artifact, &mut cards, index)?,
        };
        if !changed {
            return Ok(false);
        }
        save_cards(&tx, artifact, cards, now)?;
        tx.commit()?;
        Ok(true)
    }
}

/// Replaces the cards of flashcard set `artifact` with `cards`, all new and due at `now`,
/// inside the caller's transaction.
pub(super) fn replace_cards(
    connection: &Connection,
    artifact: ArtifactId,
    cards: &[Flashcard],
    now: i64,
) -> Result<()> {
    connection.execute(
        "DELETE FROM cards WHERE artifact_id = ?1",
        params![artifact],
    )?;
    let due = Memory::new(now).due;
    let mut insert = connection.prepare(
        "INSERT INTO cards (artifact_id, ordinal, front, back, due) VALUES (?1, ?2, ?3, ?4, ?5)",
    )?;
    for (ordinal, card) in cards.iter().enumerate() {
        insert.execute(params![
            artifact,
            ordinal as i64,
            card.front.trim(),
            card.back.trim(),
            due
        ])?;
    }
    Ok(())
}

/// What identifies a card across updates: its front with whitespace collapsed, in lower
/// case, without the question mark, full stop, colon or exclamation mark it ends with.
pub(super) fn card_key(front: &str) -> String {
    let front = collapse_whitespace(front).to_lowercase();
    front
        .trim_end_matches(['?', '.', ':', '!'])
        .trim_end()
        .to_owned()
}

/// Writes the cards of flashcard set `new`, the update of `previous`, inside the
/// caller's transaction. Each card whose front matches a card of `previous` (by
/// [`card_key`]; the first match wins, and an old card matches once) is that card moved, with
/// its id, memory and reviews and the new wording; the others are new cards, due at `now`.
/// Old cards that nothing matches stay on `previous`, which the caller then deletes. Edits
/// made to `previous`'s cards after the update read them may not carry.
pub(super) fn carry_cards(
    tx: &Connection,
    previous: ArtifactId,
    new: ArtifactId,
    cards: &[Flashcard],
    now: i64,
) -> Result<()> {
    // Cards already on `new` (a set finished twice) are candidates too, out of the way
    // of the places the new cards take.
    tx.execute(
        "UPDATE cards SET ordinal = ordinal + ?2 WHERE artifact_id = ?1",
        params![new, SHIFT],
    )?;
    let old: Vec<(CardId, String)> = tx
        .prepare(
            "SELECT id, front FROM cards WHERE artifact_id IN (?1, ?2)
             ORDER BY artifact_id = ?2 DESC, ordinal",
        )?
        .query_map(params![previous, new], |row| {
            Ok((row.get(0)?, card_key(&row.get::<_, String>(1)?)))
        })?
        .collect::<rusqlite::Result<_>>()?;
    // Decide every match before changing a row.
    let mut taken = HashSet::new();
    let matches: Vec<Option<CardId>> = cards
        .iter()
        .map(|card| {
            let key = card_key(&card.front);
            let found = old
                .iter()
                .find(|(id, old)| !taken.contains(id) && *old == key)
                .map(|(id, _)| *id);
            taken.extend(found);
            found
        })
        .collect();
    tx.execute(
        "DELETE FROM cards WHERE artifact_id = ?1 AND id NOT IN (SELECT value FROM json_each(?2))",
        params![
            new,
            serde_json::to_string(&taken.iter().map(|id| id.get()).collect::<Vec<_>>())?
        ],
    )?;
    let due = Memory::new(now).due;
    for (ordinal, (card, found)) in cards.iter().zip(matches).enumerate() {
        match found {
            Some(id) => tx.execute(
                "UPDATE cards SET artifact_id = ?2, ordinal = ?3, front = ?4, back = ?5
                 WHERE id = ?1",
                params![id, new, ordinal as i64, card.front.trim(), card.back.trim()],
            )?,
            None => tx.execute(
                "INSERT INTO cards (artifact_id, ordinal, front, back, due)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    new,
                    ordinal as i64,
                    card.front.trim(),
                    card.back.trim(),
                    due
                ],
            )?,
        };
    }
    Ok(())
}

/// Writes new sides for card `index` of flashcard set `artifact`, whose body holds `cards`,
/// or adds a card at its end. Returns `false` when there is no such place.
fn write_card(
    tx: &Connection,
    artifact: ArtifactId,
    cards: &mut Vec<Flashcard>,
    index: usize,
    front: &str,
    back: &str,
    now: i64,
) -> Result<bool> {
    let (front, back) = (front.trim(), back.trim());
    if front.is_empty() || back.is_empty() {
        bail!(
            ErrorKind::InvalidInput,
            "a card needs a question and an answer"
        );
    }
    if index == cards.len() {
        push_card(tx, artifact, cards, front.to_owned(), back.to_owned(), now)?;
        return Ok(true);
    }
    let Some(card) = cards.get_mut(index) else {
        return Ok(false);
    };
    card.front = front.to_owned();
    card.back = back.to_owned();
    tx.execute(
        "UPDATE cards SET front = ?3, back = ?4 WHERE artifact_id = ?1 AND ordinal = ?2",
        params![artifact, index as i64, front, back],
    )?;
    Ok(true)
}

/// Deletes card `index` of flashcard set `artifact`, whose body holds `cards`, with its
/// reviews. Returns `false` when there is no such card.
fn delete_card(
    tx: &Connection,
    artifact: ArtifactId,
    cards: &mut Vec<Flashcard>,
    index: usize,
) -> Result<bool> {
    if index >= cards.len() {
        return Ok(false);
    }
    cards.remove(index);
    tx.execute(
        "DELETE FROM cards WHERE artifact_id = ?1 AND ordinal = ?2",
        params![artifact, index as i64],
    )?;
    // Close the gap in two steps, so no two cards share a place on the way.
    tx.execute(
        "UPDATE cards SET ordinal = ordinal + ?3 WHERE artifact_id = ?1 AND ordinal > ?2",
        params![artifact, index as i64, SHIFT],
    )?;
    tx.execute(
        "UPDATE cards SET ordinal = ordinal - ?2 - 1 WHERE artifact_id = ?1 AND ordinal >= ?2",
        params![artifact, SHIFT],
    )?;
    Ok(true)
}

/// Adds a new card, due at `now`, at the end of flashcard set `artifact`, whose body holds
/// `cards`, inside the caller's transaction. Store the body with [`save_cards`] after.
pub(super) fn push_card(
    connection: &Connection,
    artifact: ArtifactId,
    cards: &mut Vec<Flashcard>,
    front: String,
    back: String,
    now: i64,
) -> Result<()> {
    connection.execute(
        "INSERT INTO cards (artifact_id, ordinal, front, back, due) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            artifact,
            cards.len() as i64,
            front,
            back,
            Memory::new(now).due
        ],
    )?;
    cards.push(Flashcard {
        front,
        back,
        cites: Vec::new(),
    });
    Ok(())
}

/// Stores `cards` as the body of flashcard set `artifact`, changed at `now`, inside the
/// caller's transaction.
pub(super) fn save_cards(
    connection: &Connection,
    artifact: ArtifactId,
    cards: Vec<Flashcard>,
    now: i64,
) -> Result<()> {
    connection.execute(
        "UPDATE artifacts SET body = ?2, updated_at = ?3 WHERE id = ?1",
        params![
            artifact,
            serde_json::to_string(&ArtifactBody::Flashcards { cards })?,
            now
        ],
    )?;
    Ok(())
}

impl Card {
    /// Maps the [`CARD_COLUMNS`].
    fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Card {
            id: row.get(0)?,
            artifact_id: row.get(1)?,
            front: row.get(2)?,
            back: row.get(3)?,
            memory: Memory {
                stability: row.get(4)?,
                difficulty: row.get(5)?,
                reps: row.get(6)?,
                lapses: row.get(7)?,
                last_review: row.get(8)?,
                due: row.get(9)?,
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use crate::db::{CardChange, Database};
    use crate::{
        ArtifactBody, ArtifactId, ArtifactKind, Flashcard, JobStatus, ProjectId, Rating, Result,
    };
    use std::path::Path;

    fn card(front: &str, back: &str) -> Flashcard {
        Flashcard {
            front: front.into(),
            back: back.into(),
            cites: Vec::new(),
        }
    }

    /// A finished flashcard set `name` holding `cards`, made from a file of its own.
    fn flashcard_set(
        db: &Database,
        dir: &Path,
        project: ProjectId,
        name: &str,
        cards: Vec<Flashcard>,
    ) -> Result<ArtifactId> {
        let file = dir.join(format!("{name}.txt"));
        std::fs::write(&file, name)?;
        let source = db.import_source(&file, Some(project))?;
        let (id, _) = db.request_update(project, ArtifactKind::Flashcards, &[source.id])?;
        db.begin_artifact(id)?;
        db.finish_artifact(id, &ArtifactBody::Flashcards { cards }, &[])?;
        Ok(id)
    }

    #[test]
    fn new_cards_come_a_day_at_a_time_while_reviewed_ones_always_come() -> Result<()> {
        let (dir, db) = crate::db::Database::temporary()?;
        let project = db.create_project("Biology")?;
        let cards = (1..=4).map(|n| card(&format!("Q{n}"), "A")).collect();
        let id = flashcard_set(&db, dir.path(), project.id, "Cells", cards)?;
        let later = i64::MAX / 2;
        assert_eq!(db.due_cards(None, later, 10, 2)?.len(), 2, "two new ones");
        assert_eq!(db.count_due_cards(None, later, 2)?, 2);

        // A card seen once and due again always comes, on top of the new ones allowed.
        let first = db.cards_of(id)?[0].id;
        db.review_card(first, Rating::Again, 1_000)?;
        assert_eq!(db.new_cards_since(0)?, 1);
        assert_eq!(db.new_cards_since(2_000)?, 0);
        let due = db.due_cards(None, later, 10, 1)?;
        assert_eq!(due.len(), 2);
        assert_eq!(due[0].card.id, first, "reviewed ones first");
        assert_eq!(db.count_due_cards(None, later, 0)?, 1);
        Ok(())
    }

    #[test]
    fn projects_share_the_days_new_cards_so_their_counts_add_up() -> Result<()> {
        let (dir, db) = crate::db::Database::temporary()?;
        let mut projects = Vec::new();
        for name in ["Biology", "History"] {
            let project = db.create_project(name)?;
            let cards = (1..=3).map(|n| card(&format!("{name} {n}"), "A")).collect();
            flashcard_set(&db, dir.path(), project.id, name, cards)?;
            projects.push(project.id);
        }
        let later = i64::MAX / 2;
        let each: usize = projects
            .iter()
            .map(|project| db.count_due_cards(Some(*project), later, 4).unwrap())
            .sum();
        assert_eq!(each, 4, "the projects' shares add up to the allowance");
        assert_eq!(db.count_due_cards(None, later, 4)?, 4);
        let shown: usize = projects
            .iter()
            .map(|project| db.due_cards(Some(*project), later, 50, 4).unwrap().len())
            .sum();
        assert_eq!(shown, 4);
        Ok(())
    }

    #[test]
    fn reviews_are_counted_by_project_since_a_time() -> Result<()> {
        let (dir, db) = crate::db::Database::temporary()?;
        let biology = db.create_project("Biology")?;
        let history = db.create_project("History")?;
        let id = flashcard_set(&db, dir.path(), biology.id, "Cells", vec![card("Q", "A")])?;
        let card = db.cards_of(id)?[0].id;
        db.review_card(card, Rating::Good, 100)?;
        db.review_card(card, Rating::Good, 500)?;
        assert_eq!(db.review_times(Some(biology.id), 0)?, [100, 500]);
        assert_eq!(db.review_times(None, 200)?, [500]);
        assert!(db.review_times(Some(history.id), 0)?.is_empty());
        Ok(())
    }

    #[test]
    fn a_card_is_rewritten_deleted_or_added_in_the_set_and_its_reviews() -> Result<()> {
        let (dir, db) = crate::db::Database::temporary()?;
        let project = db.create_project("Biology")?;
        let file = dir.path().join("cells.txt");
        std::fs::write(&file, "mitochondria")?;
        let source = db.import_source(&file, Some(project.id))?;
        let (id, _) = db.request_update(project.id, ArtifactKind::Flashcards, &[source.id])?;
        let write = |front: &str, back: &str| CardChange::Write {
            front: front.into(),
            back: back.into(),
        };
        // Not written yet: nothing to change.
        assert!(!db.set_card(id, 0, &write("Q", "A"))?);
        db.begin_artifact(id)?;
        db.finish_artifact(
            id,
            &ArtifactBody::Flashcards {
                cards: vec![
                    card("One", "answer"),
                    card("Two", "answer"),
                    card("Three", "answer"),
                ],
            },
            &[],
        )?;
        let reviewed = db.cards_of(id)?[2].id;
        db.review_card(reviewed, Rating::Good, 1_000)?;

        assert!(db.set_card(id, 2, &write(" Three, fixed ", "Better"))?);
        assert!(db.set_card(id, 0, &CardChange::Delete)?);
        assert!(db.set_card(id, 2, &write("Four", "New"))?);
        assert!(!db.set_card(id, 9, &CardChange::Delete)?);
        assert!(db.set_card(id, 0, &write(" ", "x")).is_err());

        let cards = db.cards_of(id)?;
        let sides: Vec<(&str, &str)> = cards
            .iter()
            .map(|card| (card.front.as_str(), card.back.as_str()))
            .collect();
        assert_eq!(
            sides,
            [
                ("Two", "answer"),
                ("Three, fixed", "Better"),
                ("Four", "New")
            ]
        );
        // The edited card kept its schedule.
        assert_eq!(cards[1].id, reviewed);
        assert_eq!(cards[1].memory.reps, 1);
        let Some(ArtifactBody::Flashcards { cards: body }) = db.artifact(id)?.unwrap().body else {
            panic!("flashcards");
        };
        let fronts: Vec<&str> = body.iter().map(|card| card.front.as_str()).collect();
        assert_eq!(fronts, ["Two", "Three, fixed", "Four"]);
        Ok(())
    }

    #[test]
    fn a_flashcard_set_schedules_its_cards_and_reviews_move_them() -> Result<()> {
        let (dir, db) = crate::db::Database::temporary()?;
        let project = db.create_project("Biology")?;
        let file = dir.path().join("cells.txt");
        std::fs::write(&file, "mitochondria")?;
        let source = db.import_source(&file, Some(project.id))?;

        let (id, job) = db.request_update(project.id, ArtifactKind::Flashcards, &[source.id])?;
        let job = job.expect("queued");
        let pending = db.artifact(id)?.unwrap();
        assert_eq!(pending.sources, [source.id]);
        assert_eq!(
            pending.job.as_ref().map(|job| (job.id, job.status)),
            Some((job, JobStatus::Queued))
        );

        // A body of the wrong shape is refused.
        let text = ArtifactBody::Text { text: "no".into() };
        assert!(db.finish_artifact(id, &text, &[]).is_err());

        db.begin_artifact(id)?;
        let body = ArtifactBody::Flashcards {
            cards: vec![
                Flashcard {
                    cites: vec![1],
                    ..card("What powers the cell?", "Mitochondria")
                },
                card("Where are proteins built?", "Ribosomes"),
            ],
        };
        assert!(db.finish_artifact(id, &body, &[])?);
        assert_eq!(db.artifact(id)?.unwrap().body, Some(body));
        let now = crate::db::unix_timestamp();
        let due = db.due_cards(Some(project.id), now, 10, usize::MAX)?;
        assert_eq!(due.len(), 2);
        assert_eq!(db.count_due_cards(None, now, usize::MAX)?, 2);

        let memory = db.review_card(due[0].card.id, Rating::Good, now)?.unwrap();
        assert!(memory.due > now);
        assert_eq!(db.count_due_cards(Some(project.id), now, usize::MAX)?, 1);

        // A finished set is never written again, so its cards and reviews stay; deleting it
        // takes them along.
        assert!(!db.begin_artifact(id)?);
        assert_eq!(db.cards_of(id)?.len(), 2);
        db.delete_material(project.id, ArtifactKind::Flashcards)?;
        assert!(db.list_material(project.id)?.is_empty());
        Ok(())
    }

    #[test]
    fn card_keys_ignore_case_spacing_and_closing_punctuation() {
        use super::card_key;
        assert_eq!(
            card_key("  What  powers\nthe CELL? "),
            "what powers the cell"
        );
        assert_eq!(card_key("Define ATP:"), card_key("define atp"));
        assert_eq!(card_key("Why?!"), "why");
        assert_ne!(card_key("a b"), card_key("ab"));
        assert_eq!(card_key("ÈTÀ?"), "ètà");
    }

    #[test]
    fn an_update_carries_the_cards_it_shares_with_the_set_it_replaces() -> Result<()> {
        let (dir, db) = Database::temporary()?;
        let project = db.create_project("Biology")?;
        let first = flashcard_set(
            &db,
            dir.path(),
            project.id,
            "one",
            vec![
                card("What powers the cell?", "Mitochondria"),
                card("Where are proteins built?", "Ribosomes"),
                card("Dropped later", "x"),
            ],
        )?;
        let old = db.cards_of(first)?;
        let now = crate::db::unix_timestamp();
        db.review_card(old[0].id, Rating::Good, now)?;
        db.review_card(old[2].id, Rating::Good, now)?;
        let reviewed = db.cards_of(first)?[0].memory;

        let second = flashcard_set(
            &db,
            dir.path(),
            project.id,
            "two",
            vec![
                card("Brand new", "n"),
                card("  where are PROTEINS built ", "Ribosomes, on the rough ER"),
                card("what powers the cell?", "Mitochondria"),
                card("What powers the cell", "duplicate front, new card"),
            ],
        )?;
        let cards = db.cards_of(second)?;
        assert_eq!(cards.len(), 4);
        assert_eq!(cards[2].id, old[0].id, "kept its id");
        assert_eq!(cards[2].memory, reviewed, "and its memory");
        assert_eq!(cards[1].id, old[1].id);
        assert_eq!(cards[1].back, "Ribosomes, on the rough ER");
        assert_eq!(cards[1].front, "where are PROTEINS built", "new wording");
        assert!(![old[0].id, old[1].id, old[2].id].contains(&cards[0].id));
        assert!(
            ![old[0].id, old[1].id, old[2].id].contains(&cards[3].id),
            "once only"
        );
        let reviews: i64 = db.connection.query_row(
            "SELECT count(*) FROM reviews WHERE card_id = ?1",
            [old[0].id],
            |row| row.get(0),
        )?;
        assert_eq!(reviews, 1);

        // The unmatched old card went with the set it was on, review included.
        assert!(db.artifact(first)?.is_none());
        assert!(db.cards_of(first)?.is_empty());
        let reviews: i64 = db.connection.query_row(
            "SELECT count(*) FROM reviews WHERE card_id = ?1",
            [old[2].id],
            |row| row.get(0),
        )?;
        assert_eq!(reviews, 0);
        let later = i64::MAX / 2;
        let due = db.due_cards(None, later, 50, usize::MAX)?;
        assert!(due.iter().all(|due| due.card.artifact_id == second));
        assert_eq!(due.len(), 4);
        assert_eq!(db.count_due_cards(None, later, usize::MAX)?, 4);

        let edit = CardChange::Write {
            front: "x".into(),
            back: "y".into(),
        };
        assert!(db.set_card(second, 0, &edit)?);
        Ok(())
    }
}
