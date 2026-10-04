//! The scripted visit that is recorded for the GIF: a list of [`Step`]s played like a person
//! would, with a pointer that glides, keys that are typed one at a time and a pause to read
//! after each page. The docs' scenes in [`crate::docs`] are made of the same steps.
//!
//! The tour is data so its pacing can be tested without a screen: [`estimate`] adds up how
//! long a tour takes, and the tests keep it a short GIF. Coordinates are logical pixels of
//! the output, taken from screenshots of the private desktop.

use std::{thread, time::Duration};

use study_core::Result;

use crate::desktop::{Desktop, PRESS_MS, RAIL_FIRST, RAIL_STEP, RAIL_WIDTH, RAIL_X, Screen};

/// One thing the visitor does.
#[derive(Debug, Clone, PartialEq)]
pub enum Step {
    /// Glide to the point and rest there.
    Hover { x: u32, y: u32 },
    /// Glide to the point and press the left button.
    Click { x: u32, y: u32 },
    /// Glide to `from`, hold the left button, glide slowly to `to` and let go.
    Drag { from: (u32, u32), to: (u32, u32) },
    /// A key, held with the modifiers.
    Key {
        modifiers: &'static [Modifier],
        key: &'static str,
    },
    /// Text typed at the speed of a person.
    Type { text: &'static str },
    /// Time to read the screen.
    Pause(u64),
}

/// A key that is held while another is pressed.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Modifier {
    Ctrl,
    Shift,
}

impl Modifier {
    /// The name `wtype` knows it by.
    fn wtype_name(self) -> &'static str {
        match self {
            Self::Ctrl => "ctrl",
            Self::Shift => "shift",
        }
    }
}

/// Time between typed characters.
const TYPING_MS: u64 = 90;
/// How long each pointer move between two points takes at most, and per hop.
const GLIDE_MS: u64 = 350;
const HOP_MS: u64 = 25;
/// Rest after a pointer arrives before it presses, and after a key.
const AIM_MS: u64 = 200;
const KEY_MS: u64 = 250;

/// How long a drag takes from press to release.
const DRAG_MS: u64 = 1200;

/// A key on its own.
pub(crate) fn key(key: &'static str) -> Step {
    Step::Key {
        modifiers: &[],
        key,
    }
}

/// A key held with `modifiers`.
pub(crate) fn chord(modifiers: &'static [Modifier], key: &'static str) -> Step {
    Step::Key { modifiers, key }
}

/// A click on row `n` of the rail on the left, counting Home as 0.
pub(crate) fn rail(row: u32) -> Step {
    Step::Click {
        x: RAIL_X + RAIL_WIDTH / 2,
        y: RAIL_FIRST + row * RAIL_STEP,
    }
}

/// The tour recorded for the README, in the storyboard's order: Home, a cited answer and
/// the moment it cites, a diagram, flashcards rated by keyboard, a graded practice answer
/// and search. It only looks and reads: nothing here asks a question, presses Update, Try
/// again, Retry or Start, answers or grades a quiz question, or opens Pipelines, because each
/// of those starts a model job.
pub fn tour() -> Vec<Step> {
    use Modifier::Ctrl;
    let Screen { width, height, .. } = Screen::DEMO;
    let start = Screen::DEMO.start();
    use Step::{Click, Hover, Pause, Type};
    let (home, projects, flashcards, diagrams, practice) = (0, 1, 3, 4, 5);
    vec![
        Pause(900),
        rail(projects),
        Pause(700),
        // Mitosis lecture: the answer, then its first citation opens the cited moment.
        Click { x: 105, y: 495 },
        Pause(500),
        Click { x: 690, y: 558 },
        Pause(1000),
        // Diagrams: one that runs past its canvas, then one that fits whole, with the
        // pointer over it.
        rail(diagrams),
        Pause(1500),
        Click { x: 87, y: 516 },
        Pause(400),
        Hover {
            x: (width + RAIL_WIDTH) / 2,
            y: height * 2 / 5,
        },
        Pause(1200),
        // Due cards of the nearest exam: reveal and rate two with the keyboard.
        rail(flashcards),
        Pause(500),
        Click { x: 688, y: 306 },
        Pause(500),
        key("space"),
        Pause(500),
        key("3"),
        Pause(300),
        key("space"),
        Pause(700),
        key("3"),
        Pause(300),
        // A past answer, graded, with its feedback.
        rail(practice),
        Pause(900),
        Click { x: 770, y: 555 },
        Pause(2800),
        // One search across recordings, slides and articles.
        chord(&[Ctrl], "k"),
        Pause(300),
        Type { text: "prophase" },
        Pause(2500),
        key("Escape"),
        key("Escape"),
        rail(home),
        Pause(700),
        // Back where the recording began, so the loop closes on its first frame.
        Hover {
            x: start.0,
            y: start.1,
        },
        Pause(300),
    ]
}

/// Plays `steps` on the desktop, starting with the pointer at `from`, and returns where the
/// pointer ends. `still_running` is asked before every step, so a dead app stops the tour.
pub fn play(
    desktop: &Desktop,
    steps: &[Step],
    from: (u32, u32),
    mut still_running: impl FnMut() -> Result<()>,
) -> Result<(u32, u32)> {
    let mut pointer = from;
    for step in steps {
        still_running()?;
        match step {
            Step::Hover { x, y } => glide_to(desktop, &mut pointer, (*x, *y))?,
            Step::Click { x, y } => {
                glide_to(desktop, &mut pointer, (*x, *y))?;
                thread::sleep(Duration::from_millis(AIM_MS));
                desktop.press()?;
            }
            Step::Drag { from, to } => {
                glide_to(desktop, &mut pointer, *from)?;
                thread::sleep(Duration::from_millis(AIM_MS));
                desktop.button(true)?;
                let path = drag(*from, *to);
                let hop = Duration::from_millis(DRAG_MS / path.len() as u64);
                for (x, y) in path {
                    thread::sleep(hop);
                    desktop.warp(x, y)?;
                }
                pointer = *to;
                thread::sleep(Duration::from_millis(AIM_MS));
                desktop.button(false)?;
            }
            Step::Key { modifiers, key } => {
                let args = wtype_key(modifiers, key);
                desktop.run(
                    "wtype",
                    &args.iter().map(String::as_str).collect::<Vec<_>>(),
                )?;
                thread::sleep(Duration::from_millis(KEY_MS));
            }
            Step::Type { text } => {
                desktop.run("wtype", &["-d", &TYPING_MS.to_string(), text])?;
            }
            Step::Pause(ms) => thread::sleep(Duration::from_millis(*ms)),
        }
    }
    Ok(pointer)
}

fn glide_to(desktop: &Desktop, pointer: &mut (u32, u32), to: (u32, u32)) -> Result<()> {
    for (x, y) in glide(*pointer, to) {
        desktop.warp(x, y)?;
        thread::sleep(Duration::from_millis(HOP_MS));
    }
    *pointer = to;
    Ok(())
}

/// The points of a pointer move: it starts and ends slowly, like a hand.
fn glide(from: (u32, u32), to: (u32, u32)) -> Vec<(u32, u32)> {
    let distance = f64::from(from.0.abs_diff(to.0)).hypot(f64::from(from.1.abs_diff(to.1)));
    let hops = (distance / 30.0)
        .clamp(1.0, GLIDE_MS as f64 / HOP_MS as f64)
        .round() as u32;
    eased(from, to, hops)
}

/// The points of a drag: eased like a glide, but in small even hops over [`DRAG_MS`], so
/// what is dragged follows the hand.
fn drag(from: (u32, u32), to: (u32, u32)) -> Vec<(u32, u32)> {
    eased(from, to, (DRAG_MS / HOP_MS) as u32)
}

/// `hops` points from `from` (left out) to `to`, slow at both ends.
fn eased(from: (u32, u32), to: (u32, u32), hops: u32) -> Vec<(u32, u32)> {
    (1..=hops)
        .map(|hop| {
            let t = f64::from(hop) / f64::from(hops);
            let eased = t * t * (3.0 - 2.0 * t);
            let at = |a: u32, b: u32| {
                (f64::from(a) + (f64::from(b) - f64::from(a)) * eased).round() as u32
            };
            (at(from.0, to.0), at(from.1, to.1))
        })
        .collect()
}

/// `wtype` arguments for a key held with modifiers.
fn wtype_key(modifiers: &[Modifier], key: &str) -> Vec<String> {
    let mut args: Vec<String> = modifiers
        .iter()
        .flat_map(|modifier| ["-M".into(), modifier.wtype_name().into()])
        .collect();
    args.extend(["-k".into(), key.into()]);
    args.extend(
        modifiers
            .iter()
            .rev()
            .flat_map(|modifier| ["-m".into(), modifier.wtype_name().into()]),
    );
    args
}

/// About how long `steps` take to play with the pointer starting at `from`.
pub fn estimate(steps: &[Step], from: (u32, u32)) -> Duration {
    let mut at = from;
    let mut total = 0;
    for step in steps {
        total += match step {
            Step::Hover { x, y } | Step::Click { x, y } => {
                let hops = glide(at, (*x, *y)).len() as u64;
                at = (*x, *y);
                hops * HOP_MS
                    + if matches!(step, Step::Click { .. }) {
                        AIM_MS + PRESS_MS
                    } else {
                        0
                    }
            }
            Step::Drag { from, to } => {
                let hops = glide(at, *from).len() as u64;
                at = *to;
                hops * HOP_MS + 2 * AIM_MS + DRAG_MS
            }
            Step::Key { .. } => KEY_MS,
            Step::Type { text } => text.chars().count() as u64 * TYPING_MS,
            Step::Pause(ms) => *ms,
        };
    }
    Duration::from_millis(total)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_glide_ends_on_its_target_and_starts_slowly() {
        let path = glide((0, 0), (300, 0));
        assert_eq!(path.last(), Some(&(300, 0)));
        assert!(path[1].0 - path[0].0 < path[path.len() / 2].0 - path[path.len() / 2 - 1].0);
        assert_eq!(glide((5, 5), (5, 5)), vec![(5, 5)]);
    }

    #[test]
    fn a_drag_ends_where_it_lets_go() {
        let path = drag((100, 100), (400, 160));
        assert_eq!(path.last(), Some(&(400, 160)));
        assert!(path.len() > 10, "a drag moves in small hops");
    }

    #[test]
    fn keys_release_their_modifiers_in_reverse() {
        assert_eq!(
            wtype_key(&[Modifier::Ctrl, Modifier::Shift], "k"),
            [
                "-M", "ctrl", "-M", "shift", "-k", "k", "-m", "shift", "-m", "ctrl"
            ]
        );
        assert_eq!(wtype_key(&[], "space"), ["-k", "space"]);
    }

    #[test]
    fn the_tour_makes_a_short_gif() {
        let length = estimate(&tour(), Screen::DEMO.start());
        assert!(length >= Duration::from_secs(3), "{length:?}");
        assert!(length <= Duration::from_secs(27), "{length:?}");
    }
}
