//! Element ids of the pages of material. Per-row ids pair a name with a database id.

use study_core::ArtifactId;

/// Makes a project's piece.
pub const MAKE: usize = 7000;
/// The sidebar item that shows the cards due.
pub const REVIEWS: usize = 7002;
/// Reviews the cards due in every project.
pub const REVIEW: usize = 7010;
pub const SHOW_ANSWER: usize = 7011;
/// Base of the rating buttons; each adds its place in `Rating::ALL`.
pub const RATE: usize = 7020;
pub const BACK: usize = 7030;
pub const RETRY_LOAD: usize = 7031;
/// Reviews the cards due in one project.
pub const REVIEW_PROJECT: &str = "study-review-project";
/// A piece of material in the sidebar.
pub const MATERIAL_ROW: &str = "material-row";
/// A project in the sidebar with nothing of the page's kind made yet.
pub const PROJECT_ROW: &str = "material-project-row";
/// An opened set's deck: its card, which shows or hides its answer when clicked, and the
/// way back and on. The card is named by what a click does, the side it shows and what that
/// side says, as `Show answer · Question · What powers the cell?`.
pub const DECK_CARD: usize = 7063;
pub const DECK_PREVIOUS: usize = 7064;
pub const DECK_NEXT: usize = 7065;
pub const DELETE: usize = 7060;
pub const CONFIRM_DELETE: usize = 7061;
pub const CANCEL_DELETE: usize = 7062;
pub const MATERIAL_RETRY: &str = "material-retry";
pub const MATERIAL_SETTINGS: &str = "material-settings";
/// A source cited by material; the id packs the material's id and the citation's marker.
pub const CITATION: &str = "material-citation";
/// A flashcard, turned over by a click and named by its question; the id packs the
/// material's id and the card.
pub const FLASHCARD: &str = "material-flashcard";
pub const TURN_ALL: usize = 7033;
/// Rewrites the open piece from the project as it is now.
pub const UPDATE: usize = 7034;
pub const COPY: usize = 7037;
/// The line saying where a piece stands.
pub const STATUS: usize = 7070;
/// The card under review and its buttons, which take the keyboard.
pub const REVIEW_CARD: usize = 7038;
/// The face of the card under review, named by the side it shows and what that says.
pub const REVIEW_FACE: usize = 7039;
pub const SAVE_FILE: usize = 7050;
pub const CARD_SAVE: usize = 7052;
pub const CARD_CANCEL: usize = 7053;
pub const CARD_DELETE: usize = 7054;
pub const CARD_ADD: usize = 7055;
pub const CARD_CONFIRM_DELETE: usize = 7058;
pub const CARD_CANCEL_DELETE: usize = 7059;
/// Opened flashcards, which take the keyboard.
pub const MATERIAL_KEYS: usize = 7057;
/// A card's edit button; the id packs the set's id and the card's place.
pub const CARD_EDIT: &str = "card-edit";

/// The id of a part of a piece of material, such as a card or a citation: the material's id
/// with the part's place or marker below it.
pub fn packed(artifact: ArtifactId, part: u64) -> u64 {
    (artifact.get() as u64) << 16 | part
}
/// A flashcard being edited: its question and its answer.
pub const CARD_FRONT: &str = "card-front";
pub const CARD_BACK: &str = "card-back";
