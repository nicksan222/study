//! The website's docs media: `just docs-media`.
//!
//! Every still and clip the docs show is a [`Scene`] here: a name, the [`Step`]s that bring
//! the app to it, and what is taken there, a [`Take::Still`] or a [`Take::Clip`] of more
//! steps. [`run`] makes all of them from nothing in every language and both themes: for
//! each pair it seeds a fresh database, saves the language and the look through the same
//! preferences the Settings page writes, starts its own private desktop and the app, waits
//! as the GIF does for the app to be ready and the seed indexed, and plays every scene.
//! Each scene ends where the next can start: on Home, nothing open.
//!
//! Stills are taken once the screen stops changing and without the pointer; clips keep the
//! pointer, since it is what moves. Scenes that change the sample (rating a card, answering
//! a question) come last, so every other scene sees the seed as it was written.
//!
//! Files are named `<scene>-<language>-<theme>`: stills in `apps/landing/src/assets/shots`
//! as WebP, clips in `apps/landing/src/assets/clips` as MP4, each with a WebP poster of its
//! last frame. The site picks the variant for the page's language and the reader's theme.
//! Nothing here runs a model: answering a quiz question grades it at once from the seed,
//! and nothing is asked of `@study` or sent.

use std::{
    fmt,
    path::{Path, PathBuf},
    thread,
    time::Instant,
};

use study_core::{Language, LanguagePreferences, Result, db::Database};

use crate::{
    desktop::{self, Desktop, Screen},
    encode,
    tour::{self, Modifier, Step, chord, key, rail},
};

/// How much of the still screen before a clip's first step the clip keeps, in seconds.
const LEAD_IN: f64 = 0.3;

/// Where the site keeps its stills and its clips, from the repository's root.
const SHOTS: &str = "apps/landing/src/assets/shots";
const CLIPS: &str = "apps/landing/src/assets/clips";

/// The window's look: a copy of the desktop's `Appearance` codes in
/// `apps/desktop/src/app/preferences.rs`, stored under the same scope and key. This crate
/// cannot depend on the binary; if they change there, every take comes out dark.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Theme {
    Light,
    Dark,
}

impl Theme {
    pub const ALL: [Self; 2] = [Self::Light, Self::Dark];
    const SCOPE: &str = "app";
    const KEY: &str = "appearance";

    /// The stored code, which is also the file name's suffix.
    pub const fn code(self) -> &'static str {
        match self {
            Self::Light => "light",
            Self::Dark => "dark",
        }
    }
}

/// One language and one theme: one fresh database, desktop and app.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Variant {
    language: Language,
    theme: Theme,
}

impl fmt::Display for Variant {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}-{}", self.language.code(), self.theme.code())
    }
}

impl Variant {
    fn all() -> Vec<Self> {
        Language::ALL
            .iter()
            .flat_map(|&language| Theme::ALL.map(|theme| Self { language, theme }))
            .collect()
    }

    /// Saves this language and look where the app reads them at start.
    fn save(self, database: &Database) -> Result<()> {
        LanguagePreferences {
            language: self.language,
        }
        .save(database)?;
        database.set_preference(
            Theme::SCOPE,
            Theme::KEY,
            Some(&study_core::preferences::encode(&self.theme.code())?),
        )
    }
}

/// One picture or moving picture the docs show.
#[derive(Debug, Clone, PartialEq)]
pub struct Scene {
    /// The file name before the language and theme, and how the docs refer to it.
    pub name: &'static str,
    /// What brings the app from Home to where the take starts; not recorded.
    pub setup: Vec<Step>,
    pub take: Take,
    /// What undoes the scene before the way back Home, such as emptying what it typed.
    pub after: Vec<Step>,
}

impl Scene {
    /// This scene, undone by `steps` afterwards.
    fn then(self, after: Vec<Step>) -> Self {
        Self { after, ..self }
    }

    /// The files this scene writes in `variant`: a still, or a clip and its poster.
    fn files(&self, repo: &Path, variant: Variant) -> Vec<PathBuf> {
        let file = format!("{}-{variant}", self.name);
        match self.take {
            Take::Still => vec![output(repo, SHOTS, &file, "webp")],
            Take::Clip(_) => vec![
                output(repo, CLIPS, &file, "mp4"),
                output(repo, CLIPS, &file, "webp"),
            ],
        }
    }
}

/// What a scene keeps.
#[derive(Debug, Clone, PartialEq)]
pub enum Take {
    /// The screen as the setup leaves it.
    Still,
    /// These steps, recorded.
    Clip(Vec<Step>),
}

/// The rail's rows on the docs screen, counting Home as 0.
const HOME: u32 = 0;
const PROJECTS: u32 = 1;
const FLASHCARDS: u32 = 2;
const DIAGRAMS: u32 = 3;
const PRACTICE: u32 = 4;
const LIBRARY: u32 = 5;
const ACTIVITY: u32 = 6;

/// Places on the docs screen, in logical pixels, taken from screenshots of it.
mod at {
    /// Home's buttons.
    pub const NEW_SESSION: (u32, u32) = (558, 160);
    pub const NEW_PROJECT: (u32, u32) = (823, 160);
    /// The Mitosis lecture session under Cell biology, in the Projects sidebar.
    pub const MITOSIS: (u32, u32) = (104, 428);
    /// The first citation in its answer, the close button of the panel it opens, and the
    /// message box.
    pub const CITATION: (u32, u32) = (449, 558);
    pub const CLOSE_PANEL: (u32, u32) = (1381, 22);
    pub const COMPOSER: (u32, u32) = (700, 792);
    /// The Library's toolbar, and the textbook chapter's tile.
    pub const NEW_NOTE: (u32, u32) = (1310, 23);
    pub const ADD_LINK: (u32, u32) = (1346, 23);
    pub const ADD_FILES: (u32, u32) = (1382, 23);
    pub const TEXTBOOK: (u32, u32) = (725, 215);
    /// The Cell biology diagram in the Diagrams sidebar, and two points on its canvas.
    pub const CELL_DIAGRAM: (u32, u32) = (80, 370);
    pub const CANVAS_FROM: (u32, u32) = (900, 560);
    pub const CANVAS_TO: (u32, u32) = (640, 480);
    /// Flashcards: the overview in the sidebar, its Review button, and the Cell biology
    /// deck.
    pub const DUE: (u32, u32) = (70, 361);
    pub const REVIEW: (u32, u32) = (448, 306);
    pub const CELL_DECK: (u32, u32) = (100, 400);
    /// The fourth choice of the open question, and a past answer, on the Practice page.
    pub const CHOICE_D: (u32, u32) = (700, 354);
    pub const PAST_ANSWER: (u32, u32) = (530, 555);
    /// Settings, and the pages of its sidebar.
    pub const SETTINGS: (u32, u32) = (66, 838);
    pub const APPEARANCE: (u32, u32) = (79, 402);
    pub const PROCESSING: (u32, u32) = (80, 505);
    pub const MODELS: (u32, u32) = (100, 654);
}

fn click((x, y): (u32, u32)) -> Step {
    Step::Click { x, y }
}

/// A still taken after `setup`.
fn still(name: &'static str, setup: Vec<Step>) -> Scene {
    Scene {
        name,
        setup,
        take: Take::Still,
        after: Vec::new(),
    }
}

/// A clip of `steps`, recorded after `setup`.
fn clip(name: &'static str, setup: Vec<Step>, steps: Vec<Step>) -> Scene {
    Scene {
        name,
        setup,
        take: Take::Clip(steps),
        after: Vec::new(),
    }
}

/// Opens the Mitosis lecture session.
fn mitosis() -> Vec<Step> {
    vec![
        rail(PROJECTS),
        Step::Pause(1200),
        click(at::MITOSIS),
        Step::Pause(1200),
        // The first time, Projects opens the last session after the click lands; the second
        // click wins over it, and does nothing once the lecture is open.
        click(at::MITOSIS),
        Step::Pause(1000),
    ]
}

/// Starts a review of the cards due, from the Flashcards overview: the page remembers an
/// open deck, so the overview is chosen in its sidebar first.
fn review() -> Vec<Step> {
    vec![
        rail(FLASHCARDS),
        Step::Pause(800),
        click(at::DUE),
        Step::Pause(800),
        click(at::REVIEW),
        Step::Pause(1000),
    ]
}

/// Empties the message box, so nothing typed is left as a draft or ever sent.
fn clear_composer() -> Vec<Step> {
    vec![chord(&[Modifier::Ctrl], "a"), key("BackSpace")]
}

/// Every scene, in the order they are taken. Those that change the sample come last.
pub fn scenes() -> Vec<Scene> {
    use Step::Pause;
    let ctrl: &'static [Modifier] = &[Modifier::Ctrl];
    let with = |mut steps: Vec<Step>, more: Vec<Step>| {
        steps.extend(more);
        steps
    };
    vec![
        // First steps.
        still("home", vec![rail(HOME), Pause(1000)]),
        // Sessions and answers.
        still("session", mitosis()),
        still(
            "citation",
            with(mitosis(), vec![click(at::CITATION), Pause(1500)]),
        )
        .then(vec![click(at::CLOSE_PANEL)]),
        still(
            "study-menu",
            with(
                mitosis(),
                vec![click(at::COMPOSER), Step::Type { text: "@" }, Pause(800)],
            ),
        )
        .then(with(vec![key("Escape")], clear_composer())),
        clip(
            "citation-open",
            mitosis(),
            vec![Pause(400), click(at::CITATION), Pause(2600)],
        )
        .then(vec![click(at::CLOSE_PANEL)]),
        clip(
            "study-mention",
            mitosis(),
            vec![
                click(at::COMPOSER),
                Pause(300),
                Step::Type { text: "@st" },
                Pause(700),
                key("Tab"),
                Pause(300),
                Step::Type {
                    text: "which phase ends mitosis?",
                },
                Pause(1500),
            ],
        )
        .then(clear_composer()),
        // Search.
        still(
            "search",
            vec![
                chord(ctrl, "k"),
                Pause(300),
                Step::Type { text: "prophase" },
                Pause(2000),
            ],
        ),
        clip(
            "search-typing",
            vec![],
            vec![
                Pause(300),
                chord(ctrl, "k"),
                Pause(400),
                Step::Type { text: "prophase" },
                Pause(2200),
            ],
        ),
        // Sources.
        still("library", vec![rail(LIBRARY), Pause(1200)]),
        still(
            "new-note",
            vec![rail(LIBRARY), Pause(800), click(at::NEW_NOTE), Pause(800)],
        ),
        still(
            "add-files",
            vec![rail(LIBRARY), Pause(800), click(at::ADD_FILES), Pause(800)],
        ),
        still(
            "add-link",
            vec![rail(LIBRARY), Pause(800), click(at::ADD_LINK), Pause(800)],
        ),
        still(
            "source-details",
            vec![rail(LIBRARY), Pause(800), click(at::TEXTBOOK), Pause(1800)],
        ),
        // Notes and diagrams.
        still("diagram", vec![rail(DIAGRAMS), Pause(1500)]),
        still(
            "diagram-cells",
            vec![
                rail(DIAGRAMS),
                Pause(800),
                click(at::CELL_DIAGRAM),
                Pause(1500),
            ],
        ),
        // Flashcards.
        still("flashcards", vec![rail(FLASHCARDS), Pause(1000)]),
        still(
            "flashcard-deck",
            vec![
                rail(FLASHCARDS),
                Pause(800),
                click(at::CELL_DECK),
                Pause(1000),
            ],
        ),
        still("flashcard", with(review(), vec![key("space"), Pause(800)])),
        // Practice.
        still("practice", vec![rail(PRACTICE), Pause(1200)]),
        still(
            "graded",
            vec![
                rail(PRACTICE),
                Pause(1000),
                click(at::PAST_ANSWER),
                Pause(1200),
            ],
        ),
        // Settings and background work.
        still("settings", vec![click(at::SETTINGS), Pause(1000)]),
        still(
            "settings-appearance",
            vec![
                click(at::SETTINGS),
                Pause(800),
                click(at::APPEARANCE),
                Pause(800),
            ],
        ),
        still(
            "settings-processing",
            vec![
                click(at::SETTINGS),
                Pause(800),
                click(at::PROCESSING),
                Pause(1000),
            ],
        ),
        still(
            "settings-models",
            vec![
                click(at::SETTINGS),
                Pause(800),
                click(at::MODELS),
                Pause(1000),
            ],
        ),
        still("activity", vec![rail(ACTIVITY), Pause(1200)]),
        // A new project, after everything that reads the Projects sidebar: the draft
        // session it leaves there moves the rows below it.
        still(
            "new-session",
            vec![rail(HOME), Pause(600), click(at::NEW_SESSION), Pause(1000)],
        ),
        still(
            "new-project",
            vec![
                rail(HOME),
                Pause(600),
                click(at::NEW_PROJECT),
                Pause(800),
                Step::Type { text: "Genetics" },
                Pause(500),
            ],
        )
        .then(clear_composer()),
        // These change the sample, so they come last.
        clip(
            "diagram-drag",
            vec![
                rail(DIAGRAMS),
                Pause(800),
                click(at::CELL_DIAGRAM),
                Pause(1200),
            ],
            vec![
                Pause(300),
                Step::Drag {
                    from: at::CANVAS_FROM,
                    to: at::CANVAS_TO,
                },
                Pause(1000),
            ],
        ),
        clip(
            "flashcard-flip",
            review(),
            vec![Pause(800), key("space"), Pause(1500), key("3"), Pause(1500)],
        ),
        clip(
            "practice-answer",
            vec![rail(PRACTICE), Pause(1200)],
            vec![Pause(600), click(at::CHOICE_D), Pause(2800)],
        ),
        still("practice-feedback", vec![rail(PRACTICE), Pause(1200)]),
        // The next question the answer asked for waits for a ChatGPT sign-in.
        still("activity-waiting", vec![rail(ACTIVITY), Pause(1500)]),
    ]
}

/// What brings the app back to Home with nothing open, after any scene and its own undo.
fn reset() -> Vec<Step> {
    vec![key("Escape"), key("Escape"), rail(HOME), Step::Pause(800)]
}

/// The argument that makes only the scenes with a file missing, in every variant: a new
/// scene's, without making again the ones already committed.
pub const MISSING: &str = "missing";

/// Makes every scene whose name is in `only` (all if it is empty, or those with a file
/// missing if it holds [`MISSING`]) in every variant whose name is in `only` (all if none
/// is), for the app at `app`.
pub fn run(repo: &Path, work: &Path, app: &Path, only: &[String]) -> Result<()> {
    let variants: Vec<Variant> = {
        let named: Vec<_> = Variant::all()
            .into_iter()
            .filter(|variant| only.contains(&variant.to_string()))
            .collect();
        if named.is_empty() {
            Variant::all()
        } else {
            named
        }
    };
    let scenes: Vec<Scene> = {
        let named: Vec<_> = scenes()
            .into_iter()
            .filter(|scene| only.iter().any(|name| name == scene.name))
            .collect();
        if named.is_empty() { scenes() } else { named }
    };
    let scenes: Vec<Scene> = if only.iter().any(|argument| argument == MISSING) {
        scenes
            .into_iter()
            .filter(|scene| {
                Variant::all()
                    .into_iter()
                    .flat_map(|variant| scene.files(repo, variant))
                    .any(|file| !file.is_file())
            })
            .collect()
    } else {
        scenes
    };
    if scenes.is_empty() {
        eprintln!("every docs capture is there");
        return Ok(());
    }
    let mut total = 0;
    for variant in variants {
        total += make(repo, work, app, variant, &scenes)?;
    }
    eprintln!("wrote {total} bytes of docs media");
    Ok(())
}

/// Seeds a database, opens the app on it in `variant` and takes `scenes`; returns the
/// bytes written.
fn make(repo: &Path, work: &Path, app: &Path, variant: Variant, scenes: &[Scene]) -> Result<u64> {
    eprintln!("{variant}: seeding");
    let database = crate::seed(&work.join("data"))?;
    variant.save(&Database::open(&database)?)?;
    let desktop = Desktop::start(repo, work, Screen::DOCS)?;
    let mut app = desktop.launch(app, work)?;
    desktop.wait_until_ready(&mut app, work)?;
    crate::wait_for_indexing(&database, &mut app, work)?;

    let mut pointer = Screen::DOCS.start();
    let mut written = 0;
    for scene in scenes {
        let alive = |app: &mut desktop::Guard| app.check_running(work);
        pointer = tour::play(&desktop, &scene.setup, pointer, || alive(&mut app))?;
        let file = format!("{}-{variant}", scene.name);
        let png = work.join(format!("{file}.png"));
        written += match &scene.take {
            Take::Still => {
                desktop.capture(&png)?;
                encode::still(&png, &output(repo, SHOTS, &file, "webp"), None)?
            }
            Take::Clip(steps) => {
                let raw = work.join(format!("{file}.mkv"));
                let mut recording = desktop.record(&raw, &work.join("recorder.log"))?;
                thread::sleep(desktop::FIRST_FRAME);
                recording.check_running()?;
                let began = Instant::now();
                let played = tour::play(&desktop, steps, pointer, || alive(&mut app));
                let length = LEAD_IN + began.elapsed().as_secs_f64();
                let end = *played.as_ref().unwrap_or(&pointer);
                recording.stop(&desktop, end)?;
                pointer = played?;
                app.check_running(work)?;
                desktop.capture(&png)?;
                let skip = desktop::FIRST_FRAME.as_secs_f64() - LEAD_IN;
                encode::clip(&raw, &output(repo, CLIPS, &file, "mp4"), skip, length)?
                    + encode::still(
                        &png,
                        &output(repo, CLIPS, &file, "webp"),
                        Some(Screen::DOCS.width),
                    )?
            }
        };
        eprintln!("{variant}: {}", scene.name);
        let undo = [scene.after.as_slice(), &reset()].concat();
        pointer = tour::play(&desktop, &undo, pointer, || alive(&mut app))?;
    }
    Ok(written)
}

fn output(repo: &Path, dir: &str, file: &str, extension: &str) -> PathBuf {
    repo.join(dir).join(format!("{file}.{extension}"))
}

#[cfg(test)]
mod tests {
    use std::{collections::HashSet, time::Duration};

    use super::*;

    #[test]
    fn every_scene_has_its_own_name() {
        let scenes = scenes();
        let names: HashSet<_> = scenes.iter().map(|scene| scene.name).collect();
        assert_eq!(names.len(), scenes.len());
        assert!(names.iter().all(|name| {
            name.chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        }));
    }

    #[test]
    fn every_clip_is_short() {
        for scene in scenes() {
            if let Take::Clip(steps) = &scene.take {
                let length = tour::estimate(steps, Screen::DOCS.start());
                assert!(
                    length >= Duration::from_secs(3),
                    "{}: {length:?}",
                    scene.name
                );
                assert!(
                    length <= Duration::from_secs(8),
                    "{}: {length:?}",
                    scene.name
                );
            }
        }
    }

    #[test]
    fn every_variant_is_made_and_named_for_its_files() {
        let names: Vec<_> = Variant::all().iter().map(ToString::to_string).collect();
        assert_eq!(names, ["en-light", "en-dark", "it-light", "it-dark"]);
    }

    /// Every capture the website's source names, as (name, is a clip), from what it writes
    /// to name one: `![…](shot:name …)` and `clip:` in the docs' Markdown, `shot: name` in
    /// their frontmatter, `<Shot name="name"` in its components and `assets/shots/name-…`
    /// where it reads a file itself.
    fn site_references(dir: &Path, found: &mut Vec<(String, bool)>) {
        const MARKERS: [(&str, bool); 6] = [
            ("](shot:", false),
            ("](clip:", true),
            ("\nshot: ", false),
            ("<Shot name=\"", false),
            ("<Clip name=\"", true),
            ("/shots/", false),
        ];
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                if !path.ends_with("assets") {
                    site_references(&path, found);
                }
                continue;
            }
            let Ok(text) = std::fs::read_to_string(&path) else {
                continue;
            };
            for (marker, clip) in MARKERS {
                for (at, _) in text.match_indices(marker) {
                    let rest = &text[at + marker.len()..];
                    let end = rest
                        .find(|c: char| !(c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'))
                        .unwrap_or(rest.len());
                    let name = rest[..end].trim_end_matches('-');
                    if !name.is_empty() {
                        found.push((name.to_owned(), clip));
                    }
                }
            }
        }
    }

    #[test]
    fn the_website_shows_every_scene_and_only_scenes() {
        let site = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/landing/src");
        let mut references = Vec::new();
        site_references(&site, &mut references);
        let scenes = scenes();
        for (name, clip) in &references {
            let scene = scenes.iter().find(|scene| scene.name == name);
            let kind = if *clip { "clip" } else { "still" };
            assert!(
                scene.is_some_and(|scene| matches!(scene.take, Take::Clip(_)) == *clip),
                "the website shows the {kind} {name}, which is no {kind} scene in docs.rs"
            );
        }
        for scene in &scenes {
            assert!(
                references.iter().any(|(name, _)| name == scene.name),
                "no page of the website shows the scene {}: drop it, or show it",
                scene.name
            );
        }
    }

    #[test]
    fn the_committed_captures_are_every_scenes_files_and_no_others() {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let expected: HashSet<PathBuf> = scenes()
            .iter()
            .flat_map(|scene| {
                Variant::all()
                    .into_iter()
                    .flat_map(|variant| scene.files(&repo, variant))
            })
            .collect();
        for file in &expected {
            assert!(
                file.is_file(),
                "{} is missing: make it with `just docs-media missing`",
                file.display()
            );
        }
        for dir in [SHOTS, CLIPS] {
            for entry in std::fs::read_dir(repo.join(dir)).unwrap() {
                let file = entry.unwrap().path();
                assert!(
                    expected.contains(&file),
                    "{} is no scene's capture: delete it",
                    file.display()
                );
            }
        }
    }

    #[test]
    fn the_theme_codes_are_the_desktops() {
        let source = include_str!("../../../apps/desktop/src/app/preferences.rs");
        for theme in Theme::ALL {
            assert!(
                source.contains(&format!("= \"{}\"", theme.code())),
                "{theme:?}"
            );
        }
        assert!(source.contains(&format!("scope = \"{}\"", Theme::SCOPE)));
        assert!(source.contains(&format!("{}: Appearance", Theme::KEY)));
    }
}
