//! The scripted visit that is recorded: a list of [`Step`]s played like a person would, with a
//! pointer that glides, keys that are typed one at a time and a pause to read after each page.
//!
//! The tour is data so its pacing can be tested without a screen: [`estimate`] adds up how
//! long a tour takes, and the tests keep it a short GIF. Coordinates are pixels of the
//! recorded output, taken from screenshots of the private desktop.

use std::{thread, time::Duration};

use study_core::Result;

use crate::desktop::{Desktop, START};

/// One thing the visitor does.
#[derive(Debug, Clone, PartialEq)]
pub enum Step {
    /// Glide to the point and rest there.
    Hover { x: u32, y: u32 },
    /// Glide to the point and press the left button.
    Click { x: u32, y: u32 },
    /// A key, held with the modifiers (`ctrl`, `shift`, ...).
    Key {
        modifiers: &'static [&'static str],
        key: &'static str,
    },
    /// Text typed at the speed of a person.
    Type { text: &'static str },
    /// Wheel notches over a point; positive scrolls down.
    Scroll { x: u32, y: u32, notches: i32 },
    /// Time to read the screen.
    Pause(u64),
}

/// Time between typed characters.
const TYPING_MS: u64 = 90;
/// How long each pointer move between two points takes at most, and per hop.
const GLIDE_MS: u64 = 350;
const HOP_MS: u64 = 25;
/// Rest after a pointer arrives before it presses, and after a key.
const AIM_MS: u64 = 200;
const KEY_MS: u64 = 250;
/// Time between wheel notches.
const NOTCH_MS: u64 = 140;

/// The tour recorded for the README, in the storyboard's order: Home, a cited answer and
/// the moment it cites, a diagram, flashcards rated by keyboard, a graded practice answer
/// and search. It only looks and reads: nothing here asks a question, presses Update, Try
/// again, Retry or Start, answers or grades a quiz question, or opens Pipelines, because each
/// of those starts a model job.
pub fn tour() -> Vec<Step> {
    use Step::{Click, Hover, Key, Pause, Scroll, Type};
    // The rail on the left, and the places the pages below put their controls.
    let rail = |y| Click { x: 70, y };
    let (home, projects, flashcards, diagrams, practice) = (67, 97, 157, 187, 217);
    vec![
        Pause(900),
        rail(projects),
        Pause(500),
        // Mitosis lecture: the answer, then its first citation opens the cited moment.
        Click { x: 105, y: 448 },
        Pause(700),
        Click { x: 370, y: 529 },
        Pause(1000),
        // The diagram, fitted to the view.
        rail(diagrams),
        Pause(1500),
        Click { x: 87, y: 462 },
        Pause(400),
        Click { x: 1058, y: 213 },
        Pause(600),
        // Off the canvas, so no focus border lingers.
        Click { x: 350, y: 90 },
        Pause(300),
        // Due cards of the nearest exam: reveal and rate two with the keyboard.
        rail(flashcards),
        Pause(500),
        Click { x: 370, y: 327 },
        Pause(500),
        Key {
            modifiers: &[],
            key: "space",
        },
        Pause(500),
        Key {
            modifiers: &[],
            key: "3",
        },
        Pause(300),
        Key {
            modifiers: &[],
            key: "space",
        },
        Pause(700),
        Key {
            modifiers: &[],
            key: "3",
        },
        Pause(300),
        // A past answer, graded, with its feedback.
        rail(practice),
        Pause(500),
        Click { x: 450, y: 555 },
        Pause(600),
        Scroll {
            x: 700,
            y: 450,
            notches: 5,
        },
        Pause(2500),
        // One search across recordings, slides and articles.
        Key {
            modifiers: &["ctrl"],
            key: "k",
        },
        Pause(300),
        Type { text: "prophase" },
        Pause(2500),
        Key {
            modifiers: &[],
            key: "Escape",
        },
        Key {
            modifiers: &[],
            key: "Escape",
        },
        rail(home),
        Pause(700),
        // Back where the recording began, so the loop closes on its first frame.
        Hover {
            x: START.0,
            y: START.1,
        },
        Pause(300),
    ]
}

/// Plays `steps` on the desktop, starting from where the pointer is after the warm-up.
pub fn play(desktop: &Desktop, steps: &[Step]) -> Result<()> {
    let mut pointer = START;
    for step in steps {
        match step {
            Step::Hover { x, y } => glide_to(desktop, &mut pointer, (*x, *y))?,
            Step::Click { x, y } => {
                glide_to(desktop, &mut pointer, (*x, *y))?;
                thread::sleep(Duration::from_millis(AIM_MS));
                desktop.press()?;
            }
            Step::Key { modifiers, key } => {
                desktop.run("wtype", &wtype_key(modifiers, key))?;
                thread::sleep(Duration::from_millis(KEY_MS));
            }
            Step::Type { text } => {
                desktop.run(
                    "wtype",
                    &["-d".into(), TYPING_MS.to_string(), (*text).into()],
                )?;
            }
            Step::Scroll { x, y, notches } => {
                desktop.warp(*x, *y)?;
                pointer = (*x, *y);
                for _ in 0..notches.unsigned_abs() {
                    let amount = if *notches > 0 { "10" } else { "-10" };
                    desktop.run(
                        "wlrctl",
                        &["pointer".into(), "scroll".into(), amount.into(), "0".into()],
                    )?;
                    thread::sleep(Duration::from_millis(NOTCH_MS));
                }
            }
            Step::Pause(ms) => thread::sleep(Duration::from_millis(*ms)),
        }
    }
    Ok(())
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
fn wtype_key(modifiers: &[&str], key: &str) -> Vec<String> {
    let mut args: Vec<String> = modifiers
        .iter()
        .flat_map(|name| ["-M".into(), (*name).into()])
        .collect();
    args.extend(["-k".into(), key.into()]);
    args.extend(
        modifiers
            .iter()
            .rev()
            .flat_map(|name| ["-m".into(), (*name).into()]),
    );
    args
}

/// About how long `steps` take to play.
pub fn estimate(steps: &[Step]) -> Duration {
    let mut at = START;
    let mut total = 0;
    for step in steps {
        total += match step {
            Step::Hover { x, y } | Step::Click { x, y } => {
                let hops = glide(at, (*x, *y)).len() as u64;
                at = (*x, *y);
                hops * HOP_MS
                    + if matches!(step, Step::Click { .. }) {
                        AIM_MS + 60
                    } else {
                        0
                    }
            }
            Step::Key { .. } => KEY_MS,
            Step::Type { text } => text.chars().count() as u64 * TYPING_MS,
            Step::Scroll { x, y, notches } => {
                at = (*x, *y);
                u64::from(notches.unsigned_abs()) * NOTCH_MS
            }
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
    fn keys_release_their_modifiers_in_reverse() {
        assert_eq!(
            wtype_key(&["ctrl", "shift"], "k"),
            [
                "-M", "ctrl", "-M", "shift", "-k", "k", "-m", "shift", "-m", "ctrl"
            ]
        );
        assert_eq!(wtype_key(&[], "space"), ["-k", "space"]);
    }

    #[test]
    fn the_tour_makes_a_short_gif() {
        let length = estimate(&tour());
        assert!(length >= Duration::from_secs(3), "{length:?}");
        assert!(length <= Duration::from_secs(27), "{length:?}");
    }
}
