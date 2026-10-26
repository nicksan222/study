//! Practice: one endless quiz per project, over everything in it, one question at a time.
//! Questions are written in the background, always one ahead of the student; a choice is
//! graded at once, and an answer in the student's own words by a model. A failed job is
//! retried with [`App::retry_job`], like any other.

use study_core::db::{Answered, Practice, PracticeSummary};
use study_core::{PracticeAnswer, PracticeId, ProjectId, QuestionId, Result};

use crate::App;

impl App {
    /// The practice of `project`: opened with its first questions queued, once the files are
    /// read (the jobs' events say when), or the one it already has.
    pub fn project_practice(&self, project: ProjectId) -> Result<PracticeId> {
        self.queue(|database| database.project_practice(project))
    }

    /// Every practice, one per project, the one worked on last first, with its score.
    pub fn practices(&self) -> Result<Vec<PracticeSummary>> {
        self.with(|database| database.practices())
    }

    /// A practice with every question asked so far, and how each went.
    pub fn practice(&self, id: PracticeId) -> Result<Option<Practice>> {
        self.with(|database| database.practice(id))
    }

    /// Answers a ready question, and queues the practice's next one. A choice is graded
    /// at once; an open answer is graded by the job [`Answered::Grading`] names.
    pub fn answer_question(&self, id: QuestionId, answer: &PracticeAnswer) -> Result<Answered> {
        self.queue(|database| database.answer_question(id, answer))
    }

    /// Puts a question into its practice's flashcard set of mistakes, titled `title` when
    /// it is made, so what was missed comes back in reviews. `false` when the question is
    /// not written or its practice is gone.
    pub fn add_to_flashcards(&self, question: QuestionId, title: &str) -> Result<bool> {
        Ok(self
            .with(|database| database.add_question_card(question, title))?
            .is_some())
    }

    /// Deletes a practice with its questions, and stops the work on them.
    pub fn delete_practice(&self, id: PracticeId) -> Result<bool> {
        self.delete(|database| database.delete_practice(id))
    }
}
