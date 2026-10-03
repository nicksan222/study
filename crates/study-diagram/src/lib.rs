//! Diagrams: boxes joined by arrows, laid out automatically and drawn by hand the way
//! Excalidraw draws. No GPUI and no Study types, so all of it is tested here; the desktop
//! paints a [`Scene`] through `study_ui::DiagramView`.
//!
//! | Module | Holds |
//! |---|---|
//! | `model` | [`Diagram`], [`Node`] (a card: title, rows, citations), [`Edge`] and their styles: the one shape of a diagram |
//! | [`mermaid`] | the text form models write: [`mermaid::GUIDE`] to ask for it, [`mermaid::parse`] to read it (with [`mermaid::Problem`]s and [`feedback`](mermaid::Parsed::feedback) for a retry), [`mermaid::write`] |
//! | `layout` | (private) where boxes go and how arrows run, with `rust-sugiyama` |
//! | `sketch` | [`Stroke`]s: rough, hand-drawn paths from `roughr`, ready for any renderer, and the [`Palette`] that says what colour each [`Ink`] is |
//! | `scene` | [`scene()`]: a diagram, measured, laid out and sketched, with [`Text`] in a [`TextStyle`] |
//! | `svg` | [`svg()`]: a scene as an SVG image, to save or share |
//!
//! From a model's answer to something to paint:
//!
//! ```
//! use study_diagram::{Metrics, mermaid, scene};
//!
//! let parsed = mermaid::parse(
//!     "flowchart LR\n  sun((Sun)) -->|light| leaf[\"Leaf<br>Makes sugar [1]\"]",
//! );
//! assert_eq!(parsed.feedback(), None);
//! assert_eq!(parsed.diagram.nodes()[1].cites, [1]);
//! // A renderer measures text in its own font; here, ten pixels a character.
//! let scene = scene(&parsed.diagram, Metrics::for_font_size(20.), |text, _style| {
//!     text.len() as f32 * 10.
//! });
//! // Two titles, one row and the arrow's label.
//! assert_eq!(scene.texts.len(), 4);
//! ```

mod layout;
pub mod mermaid;
mod model;
mod scene;
mod sketch;
mod svg;

pub use layout::Point;
pub use model::{Diagram, Direction, Edge, LineStyle, Node, NodeShape};
pub use scene::{Metrics, Scene, Text, TextStyle, scene};
pub use sketch::{Dash, Ink, Op, Paint, Palette, Stroke};
pub use svg::svg;
