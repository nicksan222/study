//! Pieces more than one page draws.
//!
//! | File | Draws |
//! |---|---|
//! | `alert.rs` | what asks before something is lost or replaced: a card over the dimmed window with Cancel and the button that goes ahead |
//! | `badge.rs` | an icon as a plain glyph in a slot, never a coloured disc |
//! | `citation.rs` | a cited passage as a chip that opens its source and washes in the highlighter while hovered |
//! | `setup_card.rs` | what a job held up by setup shows: what is missing, why, and the step that fixes it |
//! | `source_peek.rs` | a cited passage opened over the page, washed in the highlighter among the text around it |
//! | `dialog.rs` | a dialog drawn from the shell's state as a floating layer, and where it sits in the window |
//! | `field.rs` | a text box or picker under a name of the page's own, the same every run |
//! | `file_tile.rs` | a file's kind as a monochrome glyph |
//! | `job.rs` | a job's state, the buttons that stop it or start it again and what a stopped job offers |
//! | `load.rs` | a page's first load, running or failed, and its line saying what went wrong or that a save is running |
//! | `material.rs` | what a piece of study material is called, looks like and says, and its markdown |
//! | `pill.rs` | a status in quiet caption words, coloured only for a failure |
//! | `surface.rs` | a group of content as a plain column (full width, or one of a wrapping row), and an opened fold's inset |
//! | `text.rs` | a section heading (and one with a count after it), a quiet line of explanation, and raw text in a code block |

mod alert;
mod badge;
mod citation;
mod dialog;
mod field;
mod file_tile;
mod job;
mod load;
mod material;
mod pill;
mod setup_card;
mod source_peek;
mod surface;
mod text;

pub(in crate::ui::screens::shell::page) use alert::Alert;
pub(super) use badge::badge;
pub(super) use citation::{citation_chip, cited_blocks, cited_start};
pub(super) use dialog::{centered_top, show_dialog};
pub(in crate::ui::screens::shell::page) use field::named_field;
pub(super) use file_tile::file_tile;
pub(super) use job::{
    job_controls, job_problem_parts, job_status, retry_button, settings_button, status_icon,
    status_look,
};
pub(super) use load::{FirstLoad, status_line};
pub(in crate::ui::screens::shell::page) use material::kind_icon;
pub(super) use material::{
    OnCite, kind_label, material_status, material_writing, prose, prose_citing,
};
pub(super) use pill::pill;
pub(in crate::ui::screens::shell::page) use setup_card::{
    ChatGptState, setup_requirement, sign_in_line,
};
pub(in crate::ui::screens::shell::page) use source_peek::SourcePeek;
pub(super) use surface::{feature_card, panel, surface};
pub(super) use text::{code_block, quiet, section_heading};
