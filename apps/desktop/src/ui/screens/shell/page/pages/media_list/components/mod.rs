//! What the Library page draws, one file per piece.
//!
//! | File | Draws |
//! |---|---|
//! | `gallery.rs` | the whole Library: its actions, the project filter and search, a tile per file |
//! | `tile.rs` | a file's tile in the gallery |
//! | `preview.rs` | a file's preview, small on its tile and large on its page |
//! | `detail.rs` | one file: its preview, its project, and what was read from it |
//! | `upload.rs` | the upload dialog: drop files, or choose them from disk |
//! | `made.rs` | sources made in the Library: a typed note, or what a web address holds |

mod detail;
mod gallery;
mod made;
mod preview;
mod tile;
mod upload;

pub(in crate::ui::screens::shell::page) use made::MadeState;
use preview::media_preview;
pub(in crate::ui::screens::shell::page::pages) use preview::{is_page, page_picture};
use tile::media_tile;
