//! What the welcome tour draws, one file per piece.
//!
//! | File | Draws |
//! |---|---|
//! | `steps.rs` | the tour's own steps: language and look, signing in, the models, the way to the AI settings |
//! | `art.rs` | the tour's pictures: the brand tile, feature tiles, a sample session |

mod art;
mod steps;

pub(in crate::ui::screens::shell::page::pages::onboarding) use art::{
    brand_tile, feature_tiles, hero_badge, sample_session,
};
