//! How parts of the app talk without knowing each other: completed facts go through the
//! [`EventBus`]. A kind of thing declares its events with [`crate::events!`], and anyone can
//! `bus.listen::<Kind>()` to hear exactly those. Work requests with one owner use a bounded
//! Tokio `mpsc` channel directly.

mod events;

pub use events::{Emits, Event, EventBus, Heard, Listener};
