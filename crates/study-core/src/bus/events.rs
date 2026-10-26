//! Typed broadcast of completed facts, one channel per event type.
//!
//! Events are hints, not commands: a listener may fall behind and miss some, in which case
//! it hears [`Heard::Missed`] and should reload what it shows from the database.

use std::any::{Any, TypeId};
use std::collections::HashMap;
use std::fmt::Debug;
use std::sync::{Arc, Mutex, PoisonError};

use tokio::sync::broadcast;

/// Something that happened, declared with [`crate::events!`].
pub trait Event: Clone + Debug + Send + Sync + 'static {
    /// The kind of thing these events are about, such as a record type.
    type Source: 'static;

    /// Events kept for a listener that is behind before it starts missing some.
    const CAPACITY: usize = 256;
}

/// A kind of thing that has events, so `bus.listen::<Kind>()` hears them.
pub trait Emits: 'static {
    /// The one event type about this kind.
    type Event: Event<Source = Self>;
}

/// One bus for the whole app. Clones share every channel.
#[derive(Clone, Default)]
pub struct EventBus {
    channels: Arc<Mutex<HashMap<TypeId, Box<dyn Any + Send + Sync>>>>,
}

impl EventBus {
    /// A bus with no channels yet; each opens on first use.
    pub fn new() -> Self {
        Self::default()
    }

    /// Tells everyone listening to `E`'s source; returns how many heard it. Nobody listening
    /// is not an error.
    pub fn publish<E: Event>(&self, event: E) -> usize {
        self.sender::<E>().send(event).unwrap_or(0)
    }

    /// Hears every `S` event published from now on.
    pub fn listen<S: Emits>(&self) -> Listener<S::Event> {
        Listener {
            receiver: self.sender::<S::Event>().subscribe(),
        }
    }

    fn sender<E: Event>(&self) -> broadcast::Sender<E> {
        // A panic elsewhere leaves the map whole: each entry is inserted in one step.
        let mut channels = self.channels.lock().unwrap_or_else(PoisonError::into_inner);
        channels
            .entry(TypeId::of::<E>())
            .or_insert_with(|| Box::new(broadcast::channel::<E>(E::CAPACITY).0))
            .downcast_ref::<broadcast::Sender<E>>()
            .expect("each type id maps to its own sender")
            .clone()
    }
}

/// What a [`Listener`] hears next.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Heard<E> {
    Event(E),
    /// This listener fell behind and some events were dropped; reload what matters.
    Missed,
}

/// Events of one type, in the order they were published.
pub struct Listener<E> {
    receiver: broadcast::Receiver<E>,
}

impl<E: Event> Listener<E> {
    /// Waits for the next event. Never ends while the bus is alive.
    pub async fn next(&mut self) -> Heard<E> {
        match self.receiver.recv().await {
            Ok(event) => Heard::Event(event),
            Err(broadcast::error::RecvError::Lagged(_)) => Heard::Missed,
            // Every channel lives as long as the bus that created it; a listener that
            // outlives it simply never hears anything again.
            Err(broadcast::error::RecvError::Closed) => std::future::pending().await,
        }
    }

    /// The next event if one is waiting, without waiting for one; for tests.
    #[cfg(test)]
    pub(crate) fn try_next(&mut self) -> Option<Heard<E>> {
        match self.receiver.try_recv() {
            Ok(event) => Some(Heard::Event(event)),
            Err(broadcast::error::TryRecvError::Lagged(_)) => Some(Heard::Missed),
            Err(_) => None,
        }
    }
}

/// Declares the events a kind of thing emits.
///
/// ```
/// # pub struct Upload;
/// study_core::events! {
///     /// What happens to uploads.
///     pub enum UploadEvent for Upload {
///         Started { id: i64 },
///         Finished { id: i64, bytes: u64 },
///     }
/// }
///
/// # #[tokio::main(flavor = "current_thread")] async fn main() {
/// use study_core::bus::{EventBus, Heard};
///
/// let bus = EventBus::new();
/// let mut uploads = bus.listen::<Upload>();
/// bus.publish(UploadEvent::Started { id: 7 });
/// assert_eq!(uploads.next().await, Heard::Event(UploadEvent::Started { id: 7 }));
/// # }
/// ```
///
/// Without `for Source`, the enum is its own source: `bus.listen::<UploadEvent>()`. The
/// source must be defined in the same crate as the events.
///
/// To add an event, add a variant to its kind's enum, or declare a new enum beside the
/// record it describes (as `db/jobs/mod.rs` does for [`Job`](crate::db::Job)). Publish it
/// only after the transaction that made it true has committed, and make every listener
/// reload from the database when it hears [`Heard::Missed`].
#[macro_export]
macro_rules! events {
    (
        $(#[$meta:meta])*
        $vis:vis enum $name:ident for $source:ty {
            $($body:tt)*
        }
    ) => {
        $(#[$meta])*
        #[derive(Clone, Debug, PartialEq)]
        $vis enum $name {
            $($body)*
        }

        impl $crate::bus::Event for $name {
            type Source = $source;
        }

        impl $crate::bus::Emits for $source {
            type Event = $name;
        }
    };

    (
        $(#[$meta:meta])*
        $vis:vis enum $name:ident {
            $($body:tt)*
        }
    ) => {
        $crate::events! {
            $(#[$meta])*
            $vis enum $name for $name {
                $($body)*
            }
        }
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Door;

    crate::events! {
        enum DoorEvent for Door {
            Opened,
            Closed { by: String },
        }
    }

    crate::events! {
        enum Chime {
            Rang,
        }
    }

    #[tokio::test]
    async fn every_listener_hears_events_published_after_it_started_listening() {
        let bus = EventBus::new();
        assert_eq!(bus.publish(DoorEvent::Opened), 0, "nobody is listening yet");
        let mut first = bus.listen::<Door>();
        let mut second = bus.clone().listen::<Door>();

        assert_eq!(bus.publish(DoorEvent::Closed { by: "Ada".into() }), 2);
        let closed = Heard::Event(DoorEvent::Closed { by: "Ada".into() });
        assert_eq!(first.next().await, closed);
        assert_eq!(second.next().await, closed);
    }

    #[tokio::test]
    async fn each_kind_only_hears_its_own_events() {
        let bus = EventBus::new();
        let mut doors = bus.listen::<Door>();
        let mut chimes = bus.listen::<Chime>();
        bus.publish(Chime::Rang);
        bus.publish(DoorEvent::Opened);
        assert_eq!(doors.next().await, Heard::Event(DoorEvent::Opened));
        assert_eq!(chimes.next().await, Heard::Event(Chime::Rang));
    }

    #[tokio::test]
    async fn a_listener_that_falls_behind_is_told_it_missed_events() {
        let bus = EventBus::new();
        let mut slow = bus.listen::<Chime>();
        for _ in 0..=<Chime as Event>::CAPACITY {
            bus.publish(Chime::Rang);
        }
        assert_eq!(slow.next().await, Heard::Missed);
        assert_eq!(slow.next().await, Heard::Event(Chime::Rang));
    }
}
