//! The flashcard set of a practice's mistakes: questions the student wants to go over again,
//! as cards reviewed like any other.

use super::super::artifacts::insert_mistakes_set;
use super::super::cards::{push_card, save_cards};
use super::super::{Database, unix_timestamp};
use crate::{
    ArtifactBody, ArtifactId, ArtifactKind, PracticeBody, PracticeId, ProjectId, QuestionId, Result,
};
use rusqlite::{OptionalExtension as _, params};

impl Database {
    /// Puts question `id` into its practice's flashcard set of mistakes as a card (see
    /// [`PracticeBody::as_card`]). The set is made the first time, finished and titled
    /// `title`, in the practice's project; a question already in it is not added twice.
    /// Returns the set, or `None` when the question is not written or the set is not a
    /// finished flashcard set to add to.
    pub fn add_question_card(&self, id: QuestionId, title: &str) -> Result<Option<ArtifactId>> {
        let tx = self.immediate()?;
        let found: Option<(PracticeId, Option<String>)> = tx
            .query_row(
                "SELECT practice_id, body FROM practice_questions WHERE id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let Some((practice, Some(body))) = found else {
            return Ok(None);
        };
        let body: PracticeBody = serde_json::from_str(&body)?;
        let (front, back) = body.as_card();
        let now = unix_timestamp();
        let set: Option<(ArtifactId, Option<String>)> = tx
            .query_row(
                "SELECT id, body FROM artifacts WHERE practice_id = ?1 AND kind = ?2",
                params![practice, ArtifactKind::Flashcards],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let (set, mut cards) = match set {
            Some((set, Some(body))) => match serde_json::from_str(&body)? {
                ArtifactBody::Flashcards { cards } => (set, cards),
                _ => return Ok(None),
            },
            Some((_, None)) => return Ok(None),
            None => {
                let project: ProjectId = tx.query_row(
                    "SELECT project_id FROM practices WHERE id = ?1",
                    params![practice],
                    |row| row.get(0),
                )?;
                (
                    insert_mistakes_set(&tx, project, practice, title, now)?,
                    Vec::new(),
                )
            }
        };
        if !cards.iter().any(|card| card.front == front) {
            push_card(&tx, set, &mut cards, front, back, now)?;
            save_cards(&tx, set, cards, now)?;
        }
        tx.commit()?;
        Ok(Some(set))
    }
}
