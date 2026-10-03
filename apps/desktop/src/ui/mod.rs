//! The GPUI presentation layer: the window, and the screens drawn in it.

pub mod screens;
mod window;

pub use window::run;
pub(crate) use window::theme_mode;
