//! How many of something, with the plural each locale needs.

use crate::Locale;

/// How many files, such as `3 files`.
pub fn file_count(locale: Locale, count: usize) -> String {
    match (locale, count) {
        (Locale::English, 1) => "1 file".to_owned(),
        (Locale::English, _) => format!("{count} files"),
        (Locale::Italian, _) => format!("{count} file"),
    }
}

/// How many of a kind of file's processing steps are on, such as `7 of 11 on`.
pub fn steps_on(locale: Locale, on: usize, total: usize) -> String {
    match locale {
        Locale::English => format!("{on} of {total} on"),
        Locale::Italian => format!("{on} di {total} attivi"),
    }
}

/// How many flashcards are turned over, such as `3 of 12 turned`.
pub fn cards_turned(locale: Locale, turned: usize, total: usize) -> String {
    match locale {
        Locale::English => format!("{turned} of {total} turned"),
        Locale::Italian => format!("{turned} di {total} girate"),
    }
}

/// How many notes, such as `5 notes`.
fn note_count(locale: Locale, count: usize) -> String {
    match (locale, count) {
        (Locale::English, 1) => "1 note".to_owned(),
        (Locale::English, _) => format!("{count} notes"),
        (Locale::Italian, 1) => "1 nota".to_owned(),
        (Locale::Italian, _) => format!("{count} note"),
    }
}

/// How far a project has moved on since a piece was written, as its changes say: `2 files, 1
/// note changed`, naming only what changed.
fn changes_since(locale: Locale, files: usize, notes: usize) -> String {
    let mut parts = Vec::new();
    if files > 0 {
        parts.push(file_count(locale, files));
    }
    if notes > 0 {
        parts.push(note_count(locale, notes));
    }
    let parts = parts.join(", ");
    match locale {
        Locale::English => format!("{parts} changed"),
        Locale::Italian => format!("Modificati: {parts}"),
    }
}

/// A piece of material that the project has moved on from, such as `Outdated · 2 files, 1
/// note changed`.
pub fn outdated(locale: Locale, files: usize, notes: usize) -> String {
    let changes = changes_since(locale, files, notes);
    match locale {
        Locale::English => format!("Outdated · {changes}"),
        Locale::Italian => format!("Non aggiornato · {changes}"),
    }
}

/// How many flashcards a set holds, such as `12 cards`.
pub fn card_count(locale: Locale, count: usize) -> String {
    match (locale, count) {
        (Locale::English, 1) => "1 card".to_owned(),
        (Locale::English, _) => format!("{count} cards"),
        (Locale::Italian, _) => format!("{count} flashcard"),
    }
}

/// How many sources something is made from, such as `3 sources`.
pub fn source_count(locale: Locale, count: usize) -> String {
    match (locale, count) {
        (Locale::English, 1) => "1 source".to_owned(),
        (Locale::English, _) => format!("{count} sources"),
        (Locale::Italian, 1) => "1 fonte".to_owned(),
        (Locale::Italian, _) => format!("{count} fonti"),
    }
}

/// How many sessions a project has, such as `3 sessions`.
pub fn session_count(locale: Locale, count: usize) -> String {
    match (locale, count) {
        (Locale::English, 1) => "1 session".to_owned(),
        (Locale::English, _) => format!("{count} sessions"),
        (Locale::Italian, 1) => "1 sessione".to_owned(),
        (Locale::Italian, _) => format!("{count} sessioni"),
    }
}

/// How many replies a message thread holds, such as `3 replies`.
pub fn reply_count(locale: Locale, count: usize) -> String {
    match (locale, count) {
        (Locale::English, 1) => "1 reply".to_owned(),
        (Locale::English, _) => format!("{count} replies"),
        (Locale::Italian, 1) => "1 risposta".to_owned(),
        (Locale::Italian, _) => format!("{count} risposte"),
    }
}

/// What a count of flashcards waiting for review counts, set under the figure itself,
/// such as `cards due` under `3`.
pub fn cards_due_noun(locale: Locale, count: usize) -> &'static str {
    match (locale, count) {
        (Locale::English, 1) => "card due",
        (Locale::English, _) => "cards due",
        (Locale::Italian, _) => "flashcard da ripassare",
    }
}

/// How many flashcards wait for review, such as `3 cards due`.
pub fn cards_due(locale: Locale, count: usize) -> String {
    format!("{count} {}", cards_due_noun(locale, count))
}

/// How many hardware threads a CPU runs at once, such as `16 threads`: not a message
/// thread, which [`reply_count`] counts.
pub fn cpu_thread_count(locale: Locale, count: usize) -> String {
    match (locale, count) {
        (Locale::English, 1) => "1 thread".to_owned(),
        (Locale::English, _) => format!("{count} threads"),
        (Locale::Italian, _) => format!("{count} thread"),
    }
}

/// How many copies of a model run side by side, such as `3 at a time`.
pub fn copies(locale: Locale, count: usize) -> String {
    match locale {
        Locale::English => format!("{count} at a time"),
        Locale::Italian => format!("{count} alla volta"),
    }
}

/// Where a guided tour is, counting from 1, such as "Step 2 of 5".
pub fn step_of(locale: Locale, step: usize, steps: usize) -> String {
    match locale {
        Locale::English => format!("Step {step} of {steps}"),
        Locale::Italian => format!("Passo {step} di {steps}"),
    }
}

/// How many cards a finished review went through: `12 cards reviewed`.
pub fn cards_reviewed(locale: Locale, count: usize) -> String {
    match (locale, count) {
        (Locale::English, 1) => "1 card reviewed".to_owned(),
        (Locale::English, _) => format!("{count} cards reviewed"),
        (Locale::Italian, _) => format!("{count} flashcard ripassate"),
    }
}

/// How far off an exam is, `days` from today: `Exam in 12 days`, `Exam tomorrow`, `Exam
/// today`, or that it has passed.
pub fn exam_countdown(locale: Locale, days: i64) -> String {
    match (locale, days) {
        (Locale::English, ..0) => "The exam has passed".to_owned(),
        (Locale::English, 0) => "Exam today".to_owned(),
        (Locale::English, 1) => "Exam tomorrow".to_owned(),
        (Locale::English, _) => format!("Exam in {days} days"),
        (Locale::Italian, ..0) => "L'esame è passato".to_owned(),
        (Locale::Italian, 0) => "Esame oggi".to_owned(),
        (Locale::Italian, 1) => "Esame domani".to_owned(),
        (Locale::Italian, _) => format!("Esame tra {days} giorni"),
    }
}

/// What a count of this week's reviews is, after the number: `review this week`.
pub fn reviews_this_week(locale: Locale, count: usize) -> &'static str {
    match (locale, count) {
        (Locale::English, 1) => "review this week",
        (Locale::English, _) => "reviews this week",
        (Locale::Italian, 1) => "ripasso questa settimana",
        (Locale::Italian, _) => "ripassi questa settimana",
    }
}

/// What a streak is, after the number: `day in a row`.
pub fn days_in_a_row(locale: Locale, count: usize) -> &'static str {
    match (locale, count) {
        (Locale::English, 1) => "day in a row",
        (Locale::English, _) => "days in a row",
        (Locale::Italian, 1) => "giorno di fila",
        (Locale::Italian, _) => "giorni di fila",
    }
}

/// Where a review is: `3 of 12`.
pub fn review_progress(locale: Locale, done: usize, total: usize) -> String {
    match locale {
        Locale::English => format!("{done} of {total}"),
        Locale::Italian => format!("{done} di {total}"),
    }
}

/// A question's place in a quiz, counting from 1: `Question 3`.
pub fn question_number(locale: Locale, number: usize) -> String {
    match locale {
        Locale::English => format!("Question {number}"),
        Locale::Italian => format!("Domanda {number}"),
    }
}

/// How a quiz is going: answers that were right out of those given, as `7 of 9 right`.
pub fn practice_score(locale: Locale, correct: u32, answered: u32) -> String {
    match (locale, correct) {
        (Locale::English, _) => format!("{correct} of {answered} right"),
        (Locale::Italian, 1) => format!("1 su {answered} giusta"),
        (Locale::Italian, _) => format!("{correct} su {answered} giuste"),
    }
}

/// How many projects there are, such as `3 projects`.
pub fn project_count(locale: Locale, count: usize) -> String {
    match (locale, count) {
        (Locale::English, 1) => "1 project".to_owned(),
        (Locale::English, _) => format!("{count} projects"),
        (Locale::Italian, 1) => "1 progetto".to_owned(),
        (Locale::Italian, _) => format!("{count} progetti"),
    }
}

/// How many results of background work are ready, such as `64 results ready`.
pub fn results_ready(locale: Locale, count: usize) -> String {
    match (locale, count) {
        (Locale::English, 1) => "1 result ready".to_owned(),
        (Locale::English, _) => format!("{count} results ready"),
        (Locale::Italian, 1) => "1 risultato pronto".to_owned(),
        (Locale::Italian, _) => format!("{count} risultati pronti"),
    }
}

/// How a practice is going, one figure at a time: `4 answered`, `2 correct`, `1 partly
/// right`, `1 incorrect`.
pub fn practice_figure(locale: Locale, figure: PracticeFigure, count: u32) -> String {
    let one = count == 1;
    match (locale, figure) {
        (Locale::English, PracticeFigure::Answered) => format!("{count} answered"),
        (Locale::English, PracticeFigure::Correct) => format!("{count} correct"),
        (Locale::English, PracticeFigure::Partly) => format!("{count} partly right"),
        (Locale::English, PracticeFigure::Incorrect) => format!("{count} incorrect"),
        (Locale::Italian, PracticeFigure::Answered) if one => "1 risposta".to_owned(),
        (Locale::Italian, PracticeFigure::Answered) => format!("{count} risposte"),
        (Locale::Italian, PracticeFigure::Correct) if one => "1 corretta".to_owned(),
        (Locale::Italian, PracticeFigure::Correct) => format!("{count} corrette"),
        (Locale::Italian, PracticeFigure::Partly) => format!("{count} in parte"),
        (Locale::Italian, PracticeFigure::Incorrect) if one => "1 sbagliata".to_owned(),
        (Locale::Italian, PracticeFigure::Incorrect) => format!("{count} sbagliate"),
    }
}

/// One figure of how a practice is going, for [`practice_figure`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PracticeFigure {
    Answered,
    Correct,
    Partly,
    Incorrect,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn changes_name_only_what_changed_with_each_locales_plural() {
        assert_eq!(
            changes_since(Locale::English, 1, 5),
            "1 file, 5 notes changed"
        );
        assert_eq!(changes_since(Locale::English, 0, 1), "1 note changed");
        assert_eq!(
            changes_since(Locale::Italian, 2, 1),
            "Modificati: 2 file, 1 nota"
        );
        assert_eq!(
            changes_since(Locale::Italian, 1, 5),
            "Modificati: 1 file, 5 note"
        );
    }

    #[test]
    fn an_outdated_piece_says_what_changed() {
        assert_eq!(
            outdated(Locale::English, 3, 4),
            "Outdated · 3 files, 4 notes changed"
        );
        assert_eq!(
            outdated(Locale::Italian, 0, 1),
            "Non aggiornato · Modificati: 1 nota"
        );
    }

    #[test]
    fn figures_lead_with_their_count() {
        assert_eq!(project_count(Locale::English, 3), "3 projects");
        assert_eq!(project_count(Locale::Italian, 1), "1 progetto");
        assert_eq!(results_ready(Locale::Italian, 64), "64 risultati pronti");
        assert_eq!(
            practice_figure(Locale::English, PracticeFigure::Partly, 1),
            "1 partly right"
        );
        assert_eq!(
            practice_figure(Locale::Italian, PracticeFigure::Incorrect, 1),
            "1 sbagliata"
        );
    }

    #[test]
    fn an_exam_is_counted_down_in_words() {
        assert_eq!(exam_countdown(Locale::English, 12), "Exam in 12 days");
        assert_eq!(exam_countdown(Locale::English, 1), "Exam tomorrow");
        assert_eq!(exam_countdown(Locale::Italian, 0), "Esame oggi");
        assert_eq!(exam_countdown(Locale::Italian, -3), "L'esame è passato");
    }

    #[test]
    fn counts_take_the_plural_each_locale_needs() {
        assert_eq!(file_count(Locale::English, 1), "1 file");
        assert_eq!(file_count(Locale::English, 0), "0 files");
        // Italian keeps loanwords such as "file" and "thread" invariable.
        assert_eq!(file_count(Locale::Italian, 3), "3 file");
        assert_eq!(cpu_thread_count(Locale::Italian, 16), "16 thread");
        assert_eq!(session_count(Locale::Italian, 1), "1 sessione");
        assert_eq!(session_count(Locale::Italian, 2), "2 sessioni");
        assert_eq!(reply_count(Locale::English, 1), "1 reply");
        assert_eq!(reply_count(Locale::Italian, 2), "2 risposte");
        assert_eq!(cards_due(Locale::English, 3), "3 cards due");
        assert_eq!(cards_due(Locale::Italian, 1), "1 flashcard da ripassare");
        assert_eq!(question_number(Locale::Italian, 3), "Domanda 3");
    }

    #[test]
    fn a_score_says_how_many_answers_were_right() {
        assert_eq!(practice_score(Locale::English, 2, 4), "2 of 4 right");
        assert_eq!(practice_score(Locale::English, 1, 4), "1 of 4 right");
        assert_eq!(practice_score(Locale::Italian, 2, 4), "2 su 4 giuste");
        assert_eq!(practice_score(Locale::Italian, 1, 4), "1 su 4 giusta");
        assert_eq!(practice_score(Locale::Italian, 0, 4), "0 su 4 giuste");
    }
}
