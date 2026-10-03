//! The pages of study material: Flashcards and Diagrams, one per
//! `ArtifactKind`, drawn by this one folder. Each page's sidebar lists the projects: one with
//! a piece of the kind opens it, one without shows Make. A piece is written from the whole
//! project and has one status, [`MaterialStatus`]: updating it rewrites it while the current
//! text stays on screen, and nothing old is kept. Flashcards also opens
//! on the cards due, with how reviews go, and runs a spaced-repetition review of them. An
//! empty project, an opened piece of material, the reviews and a review under way live in
//! `components/`.
//!
//! The database is the source of truth. Job events only say when to look again.

use super::ids;
use crate::ui::screens::shell::page::pages::components::{
    FirstLoad, kind_icon, material_writing, quiet, status_line,
};
use crate::ui::screens::shell::page::*;
use gpui_kit::component::{ActiveTheme as _, Sizable as _, spinner::Spinner};
use gpui_kit::{AppContext as _, Entity};
use gpui_kit::{SharedString, prelude::FluentBuilder as _};
use std::collections::{HashMap, HashSet};
use study_app::views::{Artifact, ArtifactBody, ArtifactKind, Changes, DueCard, Project, Rating};
use study_core::{ArtifactId, ProjectId};
use study_ui::{
    ContentPage, DiagramCanvas, DiagramLabels, MenuItem, PageView, SectionSidebar, scaled_px,
};

/// What an open diagram's canvas was drawn from. Writing a diagram again keeps its id but
/// not its drawing, and the toolbar's labels are made in one language, so a change to any of
/// them makes a new canvas.
#[derive(Debug, Eq, PartialEq)]
pub(super) struct DiagramSource {
    artifact: ArtifactId,
    mermaid: String,
    locale: Locale,
}

/// How tall an open diagram's canvas is, in units.
const DIAGRAM_HEIGHT: f32 = 640.;

/// The keys that go on in a review, and move through a deck, as GPUI names them.
const SPACE: &str = "space";
const ENTER: &str = "enter";
const LEFT: &str = "left";
const RIGHT: &str = "right";

/// Most cards in one review.
const REVIEW_SIZE: usize = 50;

/// What a page of material shows, as its sidebar picked it.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum Shown {
    /// A project with nothing of the page's kind yet, or no project at all.
    Empty(Option<ProjectId>),
    /// The cards due and how reviews go; only Flashcards has it.
    Reviews,
    /// One piece of material.
    Material(ArtifactId),
}

/// One piece of material of a project, as the pages read it.
pub(super) struct Piece {
    /// The text on screen: the finished piece, `None` until the first is written (a
    /// practice's set of mistakes is its own piece).
    pub(super) current: Option<Artifact>,
    /// The update being written, or that failed; `current` stays on screen meanwhile.
    pub(super) update: Option<Artifact>,
    /// What the project gained or lost since `current` was written.
    pub(super) changes: Changes,
}

/// Where a piece of material stands. A piece not made yet has no [`Piece`].
#[derive(Clone, Copy, Debug, PartialEq)]
pub(in crate::ui::screens::shell::page) enum MaterialStatus {
    /// Its first text is being written.
    Writing,
    /// Its first write stopped.
    WriteFailed,
    /// Nothing in the project changed since it was written.
    UpToDate,
    /// The project changed since it was written.
    Outdated(Changes),
    /// An update is being written; the current text stays.
    Updating,
    /// The update stopped; the current text stays.
    UpdateFailed,
}

impl MaterialStatus {
    /// Whether the status is a failure, which is drawn in the danger colour.
    pub(in crate::ui::screens::shell::page) fn failed(self) -> bool {
        matches!(self, Self::WriteFailed | Self::UpdateFailed)
    }

    /// The status in words, the same on every page.
    pub(in crate::ui::screens::shell::page) fn label(self, locale: Locale) -> String {
        match self {
            Self::Writing => text(locale, Message::WritingMaterial).to_owned(),
            Self::WriteFailed => text(locale, Message::MaterialWriteFailed).to_owned(),
            Self::UpToDate => text(locale, Message::MaterialUpToDate).to_owned(),
            Self::Outdated(changes) => {
                study_localization::outdated(locale, changes.files, changes.notes)
            }
            Self::Updating => text(locale, Message::MaterialUpdating).to_owned(),
            Self::UpdateFailed => text(locale, Message::MaterialUpdateFailed).to_owned(),
        }
    }
}

/// One project's piece of material as the project's page lists it.
pub(in crate::ui::screens::shell::page) struct MaterialLine {
    /// The piece, opened on its page.
    pub(in crate::ui::screens::shell::page) open: ArtifactId,
    /// Where it stands.
    pub(in crate::ui::screens::shell::page) status: MaterialStatus,
}

impl Piece {
    /// The artifact that stands for the piece: its update while there is one, since that
    /// becomes the current text, else the current text.
    pub(super) fn head(&self) -> &Artifact {
        self.update
            .as_ref()
            .or(self.current.as_ref())
            .expect("a piece has a current text or an update")
    }

    /// Whether the piece is a practice's set of mistakes, which is never updated.
    pub(super) fn is_mistakes(&self) -> bool {
        self.head().practice_id.is_some()
    }

    /// The artifact `id` of this piece, as it is read: the current text, or the update
    /// standing for it while the first is not yet written.
    fn resolve(&self, id: ArtifactId) -> Option<&Artifact> {
        let known = self.update.iter().chain(&self.current).any(|a| a.id == id);
        known.then(|| self.current.as_ref().unwrap_or_else(|| self.head()))
    }

    /// Whether an update of this piece is being written, or failed or waits to be written.
    pub(super) fn updating(&self) -> bool {
        self.current.is_some() && self.update.is_some()
    }

    /// Where the piece stands.
    pub(in crate::ui::screens::shell::page) fn status(&self) -> MaterialStatus {
        let stopped = |update: &Artifact| {
            update
                .job
                .as_ref()
                .is_some_and(|job| job.status.is_stopped())
        };
        match (&self.current, &self.update) {
            (None, Some(update)) if stopped(update) => MaterialStatus::WriteFailed,
            (None, _) => MaterialStatus::Writing,
            (Some(_), Some(update)) if stopped(update) => MaterialStatus::UpdateFailed,
            (Some(_), Some(_)) => MaterialStatus::Updating,
            (Some(_), None) if self.changes.is_none() => MaterialStatus::UpToDate,
            (Some(_), None) => MaterialStatus::Outdated(self.changes),
        }
    }
}

/// A flashcard being written: its set, its place (the set's length for a new one), and
/// the boxes for its two sides.
pub(super) struct CardEditor {
    pub(super) artifact: ArtifactId,
    pub(super) index: usize,
    /// Deleting the card waits for a confirmation.
    pub(super) confirm_delete: bool,
    /// Its save or deletion is under way; it closes once that worked.
    pub(super) saving: bool,
    pub(super) front: Entity<gpui_kit::component::input::TextareaState>,
    pub(super) back: Entity<gpui_kit::component::input::TextareaState>,
}

/// A review under way: the due cards, where the student is, and whether the answer shows.
pub(super) struct Review {
    pub(super) cards: Vec<DueCard>,
    pub(super) index: usize,
    pub(super) revealed: bool,
}

/// The pages of material: every project's material and due cards, what each page shows,
/// and the review under way.
pub(in crate::ui::screens::shell::page) struct StudyState {
    /// The kind of the page on screen, or last on screen.
    pub(super) kind: ArtifactKind,
    /// What each page's sidebar picked; a page not in it shows its default.
    chosen: HashMap<ArtifactKind, Shown>,
    pub(super) projects: Vec<Project>,
    /// Cards due in each project.
    pub(super) due: HashMap<ProjectId, usize>,
    /// Every project's pieces, newest first.
    pub(super) material: Vec<Piece>,
    /// Which projects have anything to write a kind of material from.
    pub(super) offered: HashSet<(ProjectId, ArtifactKind)>,
    /// An update is being queued.
    pub(super) making: bool,
    /// Whether a load has ever finished, so the page knows it has something to show.
    loaded: bool,
    loading: Serial,
    pub(super) review: Option<Review>,
    /// The flashcards turned over to show their answer, by artifact and card.
    pub(super) turned: HashSet<(ArtifactId, usize)>,
    /// The card each opened set's deck is at; the first when it has none.
    pub(super) deck: HashMap<ArtifactId, usize>,
    /// Takes the keyboard on opened flashcards, made at the first render that needs it.
    pub(super) material_focus: Option<gpui_kit::FocusHandle>,
    /// The material the keyboard last went to.
    focused_material: Option<ArtifactId>,
    /// Takes the keyboard during a review, once made.
    pub(super) review_focus: Option<gpui_kit::FocusHandle>,
    /// The review on screen has the keyboard. A review takes it whenever it comes on
    /// screen: started, or shown again from the sidebar. The load that starts one has no
    /// window, so `sync_study` moves the keyboard at the next render.
    review_focused: bool,
    /// The card being written, in its set's grid.
    pub(super) card_editor: Option<CardEditor>,
    /// The material just saved to a file, which its button says until another is opened.
    pub(super) saved: Option<ArtifactId>,
    /// The material whose deletion waits for a confirmation.
    pub(super) deleting: Option<ArtifactId>,
    /// How reviews are going, in every project.
    pub(super) progress: crate::features::progress::Progress,
    /// The material just copied, which its button says until another is opened.
    pub(super) copied: Option<ArtifactId>,
    /// The canvas of the open diagram, made when it opens and kept while it stays the same,
    /// so where the reader moved and zoomed survives every frame.
    pub(super) diagram: Option<(DiagramSource, Entity<DiagramCanvas>)>,
    pub(in crate::ui::screens::shell::page) error: Option<Message>,
}

impl Default for StudyState {
    fn default() -> Self {
        Self {
            kind: ArtifactKind::Flashcards,
            chosen: HashMap::new(),
            projects: Vec::new(),
            due: HashMap::new(),
            material: Vec::new(),
            offered: HashSet::new(),
            making: false,
            loaded: false,
            loading: Serial::default(),
            review: None,
            turned: HashSet::new(),
            deck: HashMap::new(),
            material_focus: None,
            focused_material: None,
            review_focus: None,
            review_focused: false,
            card_editor: None,
            saved: None,
            deleting: None,
            progress: Default::default(),
            copied: None,
            diagram: None,
            error: None,
        }
    }
}

impl StudyState {
    /// Each project's piece of the page's kind, newest first.
    pub(super) fn of_kind(&self) -> impl Iterator<Item = &Piece> {
        let kind = self.kind;
        self.material
            .iter()
            .filter(move |piece| piece.head().kind == kind)
    }

    /// The piece of the page's kind made from `project`, not counting a set of mistakes.
    pub(super) fn piece_of(&self, project: ProjectId) -> Option<&Piece> {
        self.of_kind()
            .find(|piece| piece.head().project_id == project && !piece.is_mistakes())
    }

    /// The piece of the page's kind that has artifact `id`, as its current text or its update.
    fn piece_with(&self, id: ArtifactId) -> Option<&Piece> {
        self.of_kind().find(|piece| piece.resolve(id).is_some())
    }

    /// Whether anything in `project` can be written into the page's kind.
    pub(super) fn offers(&self, project: ProjectId) -> bool {
        self.offered.contains(&(project, self.kind))
    }

    /// What the page on screen shows: what its sidebar picked while that is still there,
    /// else the reviews on Flashcards, else the newest piece, else the first project.
    pub(super) fn shown(&self) -> Shown {
        let picked = self
            .chosen
            .get(&self.kind)
            .copied()
            .filter(|shown| match shown {
                Shown::Empty(project) => project.is_none_or(|id| {
                    self.projects.iter().any(|project| project.id == id)
                        && self.piece_of(id).is_none()
                }),
                Shown::Reviews => self.kind == ArtifactKind::Flashcards,
                Shown::Material(id) => self.piece_with(*id).is_some(),
            });
        picked.unwrap_or_else(|| {
            if self.kind == ArtifactKind::Flashcards {
                Shown::Reviews
            } else {
                self.of_kind()
                    .find(|piece| !piece.is_mistakes())
                    .map_or_else(
                        || Shown::Empty(self.projects.first().map(|project| project.id)),
                        |piece| Shown::Material(piece.head().id),
                    )
            }
        })
    }

    /// The piece open on the page on screen.
    pub(super) fn open_piece(&self) -> Option<&Piece> {
        let Shown::Material(id) = self.shown() else {
            return None;
        };
        self.piece_with(id)
    }

    /// The piece of material open on the page on screen, as it reads: its current text.
    pub(super) fn open_artifact(&self) -> Option<&Artifact> {
        let Shown::Material(id) = self.shown() else {
            return None;
        };
        self.piece_with(id)?.resolve(id)
    }

    /// The card set `id`'s deck is at, among its `count`.
    pub(super) fn deck_at(&self, id: ArtifactId, count: usize) -> usize {
        self.deck
            .get(&id)
            .copied()
            .unwrap_or_default()
            .min(count.saturating_sub(1))
    }
}

/// What one load of the pages of material reads from the database.
#[derive(Default)]
pub(super) struct StudyRead {
    pub(super) projects: Vec<Project>,
    /// Cards due in each project.
    pub(super) due: HashMap<ProjectId, usize>,
    /// Every project's pieces, newest first.
    pub(super) material: Vec<Piece>,
    pub(super) offered: HashSet<(ProjectId, ArtifactKind)>,
    /// How reviews are going, in every project.
    pub(super) progress: crate::features::progress::Progress,
}

impl StudyRead {
    /// Reads every project with what is due in it and its material. Blocks on the database.
    pub(super) fn read(app: &study_app::App) -> study_core::Result<Self> {
        let projects = app.projects()?;
        let mut due = HashMap::new();
        let mut material = Vec::new();
        let mut offered = HashSet::new();
        for project in &projects {
            due.insert(project.id, app.due_count(Some(project.id))?);
            for kind in ArtifactKind::ALL {
                if app.can_update_material(project.id, *kind)? {
                    offered.insert((project.id, *kind));
                }
            }
            for read in app.material(project.id)? {
                let mut piece = Piece {
                    current: read.current,
                    update: read.update,
                    changes: Changes::default(),
                };
                if let Some(current) = piece.current.as_ref().filter(|_| !piece.is_mistakes()) {
                    piece.changes = app.material_changes(current.id)?.unwrap_or_default();
                }
                material.push(piece);
            }
        }
        material.sort_by_key(|piece: &Piece| std::cmp::Reverse(piece.head().created_at));
        Ok(Self {
            projects,
            due,
            material,
            offered,
            progress: crate::features::progress::read(app, None, crate::features::clock::now())?,
        })
    }
}

impl AppShell {
    /// Reads every project's material and what is due.
    pub(in crate::ui::screens::shell::page) fn load_study(&mut self, cx: &mut Context<Self>) {
        if !self.study.loading.start() {
            return;
        }
        self.background(
            StudyRead::read,
            move |view, result, cx| {
                let state = &mut view.study;
                state.loaded = true;
                match acted(result) {
                    Some(read) => {
                        state.projects = read.projects;
                        state.due = read.due;
                        state.material = read.material;
                        state.offered = read.offered;
                        state.progress = read.progress;
                        if state.error == Some(Message::StudyLoadError) {
                            state.error = None;
                        }
                    }
                    None => state.error = Some(Message::StudyLoadError),
                }
                if state.loading.finish() {
                    view.load_study(cx);
                }
                cx.notify();
            },
            cx,
        );
    }

    /// Readies the page of `kind` as it comes on screen: what was under way on another
    /// page's material goes with it.
    pub(in crate::ui::screens::shell::page) fn enter_material(
        &mut self,
        kind: ArtifactKind,
        cx: &mut Context<Self>,
    ) {
        if self.study.kind != kind {
            self.close_material(cx);
            self.study.kind = kind;
            self.study.error = None;
        }
        // Coming on screen, a review or a deck left open takes the keyboard again.
        self.study.review_focused = false;
        self.study.focused_material = None;
        self.load_study(cx);
    }

    /// Shows `shown` on the page of material on screen, leaving what was under way on what
    /// it showed before.
    pub(super) fn choose_material(&mut self, shown: Shown, cx: &mut Context<Self>) {
        if self.study.shown() != shown {
            self.close_material(cx);
            // Another piece's problem is not this one's.
            self.study.error = None;
        }
        self.study.chosen.insert(self.study.kind, shown);
        cx.notify();
    }

    /// Opens Flashcards on the cards due and how reviews go.
    pub(in crate::ui::screens::shell::page) fn show_reviews(&mut self, cx: &mut Context<Self>) {
        self.study.review = None;
        self.navigate(Page::Flashcards, cx);
        self.choose_material(Shown::Reviews, cx);
    }

    /// Opens a piece of study material of `kind` on its page.
    pub(in crate::ui::screens::shell::page) fn show_material(
        &mut self,
        kind: ArtifactKind,
        artifact: ArtifactId,
        cx: &mut Context<Self>,
    ) {
        self.study.review = None;
        self.navigate(Page::of_material(kind), cx);
        self.choose_material(Shown::Material(artifact), cx);
    }

    /// Opens the page of `kind` on the empty state of `project`, where its first piece is
    /// made.
    pub(in crate::ui::screens::shell::page) fn show_unmade_material(
        &mut self,
        kind: ArtifactKind,
        project: ProjectId,
        cx: &mut Context<Self>,
    ) {
        self.study.review = None;
        self.navigate(Page::of_material(kind), cx);
        self.choose_material(Shown::Empty(Some(project)), cx);
    }

    /// What a project's piece of `kind` is like, for a list of the project's material;
    /// `None` while it is not made, or until the pages of material are read.
    pub(in crate::ui::screens::shell::page) fn material_line(
        &self,
        project: ProjectId,
        kind: ArtifactKind,
    ) -> Option<MaterialLine> {
        let piece = self.study.material.iter().find(|piece| {
            let head = piece.head();
            head.project_id == project && head.kind == kind && !piece.is_mistakes()
        })?;
        Some(MaterialLine {
            open: piece.head().id,
            status: piece.status(),
        })
    }

    /// Opens a piece of study material on its page, once its kind is read; nothing when it
    /// is gone.
    pub(in crate::ui::screens::shell::page) fn find_material(
        &mut self,
        artifact: ArtifactId,
        cx: &mut Context<Self>,
    ) {
        self.background(
            move |app| app.artifact(artifact),
            move |view, result, cx| match result {
                Ok(Some(found)) => view.show_material(found.kind, found.id, cx),
                Ok(None) => {}
                Err(error) => crate::features::errors::report(&error),
            },
            cx,
        );
    }

    /// Queues updating the project's piece of `kind`, from the whole project, and opens it.
    pub(super) fn update_material(
        &mut self,
        project: ProjectId,
        kind: ArtifactKind,
        cx: &mut Context<Self>,
    ) {
        self.study.error = None;
        if self.study.making || !self.workers.allow(&mut self.study.error, cx) {
            return;
        }
        self.study.making = true;
        cx.notify();
        self.background(
            move |app| match app.update_material(project, kind) {
                Ok(id) => Ok(Some(id)),
                // Nothing to make it from: the page says why.
                Err(error) if error.kind() == study_core::ErrorKind::Unsupported => Ok(None),
                Err(error) => Err(error),
            },
            move |view, result, cx| {
                view.study.making = false;
                match result {
                    Ok(Some(id)) => {
                        // Opened on its own page, which may no longer be on screen.
                        view.study.chosen.insert(kind, Shown::Material(id));
                    }
                    // The outcome is about the page it was asked on; another page meanwhile
                    // keeps its own.
                    Ok(None) if view.study.kind == kind => {
                        view.study.error = Some(Message::MaterialNothingToMake);
                    }
                    Ok(None) => {}
                    Err(error) => {
                        crate::features::errors::report(&error);
                        if view.study.kind == kind {
                            view.study.error = Some(Message::ActionError);
                        }
                    }
                }
                view.load_study(cx);
                cx.notify();
            },
            cx,
        );
    }

    /// Deletes the open piece with its update; a practice's set of mistakes goes by itself.
    pub(super) fn delete_material(&mut self, id: ArtifactId, cx: &mut Context<Self>) {
        self.study.deleting = None;
        self.study.error = None;
        let Some((project, kind, mistakes)) = self
            .study
            .open_artifact()
            .filter(|artifact| artifact.id == id)
            .map(|artifact| {
                (
                    artifact.project_id,
                    artifact.kind,
                    artifact.practice_id.is_some(),
                )
            })
        else {
            return;
        };
        self.close_material(cx);
        self.act(
            // `false` means it was already gone, which is what was asked.
            move |app| {
                if mistakes {
                    app.delete_artifact(id)
                } else {
                    app.delete_material(project, kind)
                }
                .map(|_| true)
            },
            |this| &mut this.study.error,
            Message::ActionError,
            Self::load_study,
            cx,
        );
    }

    /// Leaves what was under way on the material open; its cards are turned anew next time.
    pub(super) fn close_material(&mut self, cx: &mut Context<Self>) {
        let open = self.study.open_artifact().map(|artifact| artifact.id);
        let state = &mut self.study;
        if let Some(open) = open {
            state.turned.retain(|(artifact, _)| *artifact != open);
        }
        state.copied = None;
        state.saved = None;
        state.deleting = None;
        state.card_editor = None;
        cx.notify();
    }

    /// Asks where to save `content`, material titled `title`, as a file with `extension`,
    /// and writes it there.
    pub(super) fn save_material(
        &mut self,
        id: ArtifactId,
        title: &str,
        extension: &str,
        content: String,
        cx: &mut Context<Self>,
    ) {
        self.study.error = None;
        let folder = std::env::home_dir().unwrap_or_default();
        let name =
            study_localization::material_file_name(self.preferences.language, title, extension);
        let picked = cx.prompt_for_new_path(&folder, Some(&name));
        cx.spawn(async move |this, cx| {
            let saved = match picked.await {
                Ok(Ok(Some(path))) => std::fs::write(&path, content)
                    .map_err(|error| crate::features::errors::report(&error)),
                Ok(Err(error)) => {
                    crate::features::errors::report(&error);
                    Err(())
                }
                // Dismissed, or the window went away.
                Ok(Ok(None)) | Err(_) => return,
            };
            let _ = this.update(cx, |view, cx| {
                match saved {
                    Ok(()) => view.study.saved = Some(id),
                    Err(()) => view.study.error = Some(Message::SaveMaterialError),
                }
                cx.notify();
            });
        })
        .detach();
    }

    /// Opens card `index` of `artifact` for writing, filled with `sides` (empty for a new
    /// card), with the keyboard in its question.
    pub(super) fn edit_card(
        &mut self,
        artifact: ArtifactId,
        index: usize,
        sides: (String, String),
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let locale = self.preferences.language;
        let make =
            |value: String, placeholder: Message, window: &mut Window, cx: &mut Context<Self>| {
                cx.new(|cx| {
                    let mut input = gpui_kit::component::input::TextareaState::new(window, cx);
                    input.set_placeholder(text(locale, placeholder), window, cx);
                    input.set_value(value, window, cx);
                    input
                })
            };
        let front = make(sides.0, Message::CardFront, window, cx);
        let back = make(sides.1, Message::CardBack, window, cx);
        front.update(cx, |input, cx| input.focus(window, cx));
        self.study.card_editor = Some(CardEditor {
            artifact,
            index,
            confirm_delete: false,
            saving: false,
            front,
            back,
        });
        cx.notify();
    }

    /// Saves the card being written, or deletes it when `delete`, and closes it once that
    /// worked. When it did not (the set or the card is gone, or the save failed), the card
    /// stays open with what was written, to try again.
    pub(super) fn finish_card(&mut self, delete: bool, cx: &mut Context<Self>) {
        let Some(editor) = self
            .study
            .card_editor
            .as_mut()
            .filter(|editor| !editor.saving)
        else {
            return;
        };
        let change = if delete {
            study_app::views::CardChange::Delete
        } else {
            let front = editor.front.read(cx).value().to_string();
            let back = editor.back.read(cx).value().to_string();
            if front.trim().is_empty() || back.trim().is_empty() {
                // Both sides are needed: keep writing.
                return;
            }
            study_app::views::CardChange::Write { front, back }
        };
        editor.saving = true;
        let (artifact, index, front_box) = (editor.artifact, editor.index, editor.front.clone());
        self.study.error = None;
        cx.notify();
        self.background(
            move |app| app.set_card(artifact, index, change),
            move |view, result, cx| {
                let done = acted(result) == Some(true);
                let state = &mut view.study;
                // Only the card this was for: another may have been opened meanwhile.
                if let Some(editor) = state
                    .card_editor
                    .as_mut()
                    .filter(|editor| editor.front == front_box)
                {
                    editor.saving = false;
                    if done {
                        state.card_editor = None;
                    }
                }
                if !done {
                    state.error = Some(Message::ActionError);
                }
                view.load_study(cx);
                cx.notify();
            },
            cx,
        );
    }

    /// Tries the piece whose stopped write is `job` again, from the project as it is now:
    /// the failed attempt is replaced, not resumed.
    pub(super) fn retry_material(&mut self, job: study_core::JobId, cx: &mut Context<Self>) {
        let Some((project, kind)) = self
            .study
            .material
            .iter()
            .filter_map(|piece| piece.update.as_ref())
            .find(|update| update.job.as_ref().is_some_and(|found| found.id == job))
            .map(|update| (update.project_id, update.kind))
        else {
            return;
        };
        self.update_material(project, kind, cx);
    }

    /// Opens Flashcards on a review of the cards due in every project.
    pub(in crate::ui::screens::shell::page) fn review_everything_due(
        &mut self,
        cx: &mut Context<Self>,
    ) {
        self.show_reviews(cx);
        self.review_due(None, cx);
    }

    /// Starts reviewing the cards due in `project`, or everywhere. The review opens only
    /// while the reviews are still on screen, so it never takes over what was picked
    /// meanwhile.
    pub(super) fn review_due(&mut self, project: Option<ProjectId>, cx: &mut Context<Self>) {
        self.study.error = None;
        self.background(
            move |app| app.due_cards(project, REVIEW_SIZE),
            move |view, result, cx| {
                let state = &mut view.study;
                if state.kind != ArtifactKind::Flashcards || state.shown() != Shown::Reviews {
                    if let Err(error) = result {
                        crate::features::errors::report(&error);
                    }
                    return;
                }
                match acted(result) {
                    Some(cards) => {
                        state.review = Some(Review {
                            cards,
                            index: 0,
                            revealed: false,
                        });
                        state.review_focused = false;
                    }
                    // The page itself is loaded: only starting the review did not work.
                    None => state.error = Some(Message::ActionError),
                }
                cx.notify();
            },
            cx,
        );
    }

    /// A key pressed during a review: Space or Enter shows the answer, and once it shows,
    /// 1 to 4 rate the card (Again to Easy). Rating takes a digit, so pressing Space twice
    /// never rates a card that was not read.
    pub(super) fn review_key(&mut self, key: &str, cx: &mut Context<Self>) -> bool {
        let Some(review) = &mut self.study.review else {
            return false;
        };
        if review.index >= review.cards.len() {
            return false;
        }
        let proceed = key == SPACE || key == ENTER;
        if !review.revealed {
            if proceed {
                review.revealed = true;
                cx.notify();
            }
            return proceed;
        }
        let digit = key
            .chars()
            .next()
            .and_then(|c| c.to_digit(10))
            .filter(|_| key.len() == 1);
        let Some(digit @ 1..=4) = digit else {
            return false;
        };
        let rating = Rating::ALL[digit as usize - 1];
        self.rate_card(rating, cx);
        true
    }

    /// Records how well the shown card was remembered and moves to the next one. When that
    /// could not be stored, the card comes back to be rated again, unless the review has
    /// moved on since.
    pub(super) fn rate_card(&mut self, rating: Rating, cx: &mut Context<Self>) {
        let Some(review) = &mut self.study.review else {
            return;
        };
        let Some(due) = review.cards.get(review.index) else {
            return;
        };
        let (card, rated) = (due.card.id, review.index);
        review.index += 1;
        review.revealed = false;
        self.study.error = None;
        cx.notify();
        self.background(
            // A card deleted meanwhile has nothing left to schedule.
            move |app| app.review(card, rating).map(|_| true),
            move |view, result, cx| {
                if acted(result).is_none() {
                    view.study.error = Some(Message::ActionError);
                    if let Some(review) = view.study.review.as_mut().filter(|review| {
                        review.index == rated + 1
                            && review
                                .cards
                                .get(rated)
                                .is_some_and(|due| due.card.id == card)
                    }) {
                        review.index = rated;
                        review.revealed = true;
                    }
                }
                view.load_study(cx);
                cx.notify();
            },
            cx,
        );
    }

    /// The page's sidebar: the cards due (on Flashcards), then every project, with its
    /// piece of the page's kind or the way to make one.
    pub(in crate::ui::screens::shell::page) fn study_sidebar(
        &self,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> SectionSidebar {
        let state = &self.study;
        let kind = state.kind;
        let shown = state.shown();
        let page = Page::of_material(kind);
        let mut sidebar = SectionSidebar::new(text(locale, page.title()));
        if kind == ArtifactKind::Flashcards {
            let due: usize = state.due.values().sum();
            sidebar = sidebar.item(
                MenuItem::new(ids::REVIEWS, text(locale, Message::ReviewDue))
                    .icon(IconName::CalendarClock)
                    .when(due > 0, |item| {
                        item.accessory(
                            div()
                                .text_size(scaled_px(cx, study_ui::scale::TEXT_CAPTION))
                                // Cards due are a learning moment: the highlighter's ink.
                                .text_color(study_ui::palette(cx).highlighter_ink)
                                .child(SharedString::from(due.to_string())),
                        )
                    })
                    .selected(shown == Shown::Reviews)
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.study.review = None;
                        this.choose_material(Shown::Reviews, cx)
                    })),
            );
        }
        for project in &state.projects {
            let project_id = project.id;
            let name = SharedString::from(project.name.clone());
            let Some(piece) = state.piece_of(project_id) else {
                // Nothing made yet: its row opens Make.
                sidebar = sidebar.item(
                    MenuItem::new((ids::PROJECT_ROW, project_id.get() as u64), name)
                        .icon(kind_icon(kind))
                        .description(text(locale, Message::MaterialNotMade))
                        .selected(shown == Shown::Empty(Some(project_id)))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.choose_material(Shown::Empty(Some(project_id)), cx)
                        })),
                );
                continue;
            };
            let id = piece.head().id;
            // Its first text on its way: a spinner, and nothing to open unless it is the one
            // on screen. An update keeps the current text open, with a spinner beside it.
            let writing = material_writing(piece.head());
            let first = piece.current.is_none();
            let selected = state.open_piece().is_some_and(|open| open.head().id == id);
            let item =
                MenuItem::new((ids::MATERIAL_ROW, id.get() as u64), name)
                    .icon(kind_icon(kind))
                    .description(SharedString::from(piece.status().label(locale)))
                    .selected(selected)
                    .disabled(writing && first && !selected)
                    .when(writing, |item| {
                        item.accessory(
                            Spinner::new()
                                .icon(study_ui::icon(IconName::LoaderCircle))
                                .color(cx.theme().colors.primary)
                                .with_size(scaled_px(cx, 14.)),
                        )
                    })
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.choose_material(Shown::Material(id), cx)
                    }));
            sidebar = sidebar.item(item);
        }
        sidebar
    }

    /// Readies what the page is about to draw, where the shell can change: the keyboard for
    /// a review that comes on screen, and the canvas of a diagram just opened.
    pub(in crate::ui::screens::shell::page) fn sync_study(
        &mut self,
        locale: Locale,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let reviewing = self.study.review.is_some() && self.study.shown() == Shown::Reviews;
        if reviewing && !self.study.review_focused {
            let focus = self
                .study
                .review_focus
                .get_or_insert_with(|| cx.focus_handle());
            window.focus(focus, cx);
        }
        self.study.review_focused = reviewing;
        // Opened cards take the keyboard, once, as they open.
        let keyed = self
            .study
            .open_artifact()
            .filter(|artifact| matches!(artifact.body, Some(ArtifactBody::Flashcards { .. })))
            .map(|artifact| artifact.id);
        if keyed.is_some() && self.study.focused_material != keyed {
            let focus = self
                .study
                .material_focus
                .get_or_insert_with(|| cx.focus_handle());
            window.focus(focus, cx);
        }
        self.study.focused_material = keyed;
        self.sync_study_diagram(locale, cx);
    }

    /// A key pressed on opened flashcards: Space turns the deck's card over, and once it is
    /// turned goes on to the next; the arrows move back and on. Whether the key was used.
    pub(super) fn material_key(&mut self, key: &str, cx: &mut Context<Self>) -> bool {
        // A card being written takes every key itself.
        if self.study.card_editor.is_some() {
            return false;
        }
        let Some(artifact) = self.study.open_artifact() else {
            return false;
        };
        let id = artifact.id;
        let Some(ArtifactBody::Flashcards { cards }) = &artifact.body else {
            return false;
        };
        let count = cards.len();
        if count == 0 {
            return false;
        }
        let at = self.study.deck_at(id, count);
        let state = &mut self.study;
        let to = match key {
            SPACE if !state.turned.contains(&(id, at)) => {
                state.turned.insert((id, at));
                cx.notify();
                return true;
            }
            SPACE | RIGHT => at + 1,
            LEFT => match at.checked_sub(1) {
                Some(to) => to,
                None => return false,
            },
            _ => return false,
        };
        if to >= count {
            return false;
        }
        state.deck.insert(id, to);
        cx.notify();
        true
    }

    /// Makes the canvas of the diagram that just opened, and drops it once the diagram is
    /// closed.
    fn sync_study_diagram(&mut self, locale: Locale, cx: &mut Context<Self>) {
        let open = self
            .study
            .open_artifact()
            .and_then(|artifact| match &artifact.body {
                Some(ArtifactBody::Diagram { mermaid }) => Some(DiagramSource {
                    artifact: artifact.id,
                    mermaid: mermaid.clone(),
                    locale,
                }),
                _ => None,
            });
        let Some(source) = open else {
            self.study.diagram = None;
            return;
        };
        if self
            .study
            .diagram
            .as_ref()
            .is_some_and(|(shown, _)| *shown == source)
        {
            return;
        }
        // Stored as `study_diagram` writes it, so it reads back whole.
        let diagram = study_diagram::mermaid::parse(&source.mermaid).diagram;
        let labels = DiagramLabels {
            zoom_in: text(locale, Message::DiagramZoomIn).into(),
            zoom_out: text(locale, Message::DiagramZoomOut).into(),
            fit: text(locale, Message::DiagramFit).into(),
            actual_size: text(locale, Message::DiagramActualSize).into(),
            hint: text(locale, Message::DiagramHint).into(),
            percent: study_localization::zoom_percentage,
        };
        let canvas = cx.new(|cx| DiagramCanvas::new(diagram, labels, DIAGRAM_HEIGHT, cx));
        self.study.diagram = Some((source, canvas));
    }

    pub(in crate::ui::screens::shell::page) fn study_page(
        &self,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> PageView {
        let state = &self.study;
        let page = Page::of_material(state.kind);
        // The page's description opens its lists; over a piece of material, which has its
        // own title, it would only be in the way.
        let reading = matches!(state.shown(), Shown::Material(_));
        let mut view = ContentPage::new(
            text(locale, page.title()),
            if reading {
                ""
            } else {
                text(locale, description(state.kind))
            },
        )
        .icon(page.icon());
        let first = FirstLoad {
            loaded: state.loaded,
            failed: state.error == Some(Message::StudyLoadError) && state.projects.is_empty(),
            loading: Message::LoadingStudy,
            load_error: Message::StudyLoadError,
            retry: Self::load_study,
        };
        if !first.ready() {
            return first.notice(view, ids::RETRY_LOAD, locale, cx);
        }
        view = match state.shown() {
            Shown::Reviews => match &state.review {
                Some(review) => self.review_view(view, review, locale, cx),
                None => self.reviews_view(view, locale, cx),
            },
            Shown::Empty(project) => self.material_empty(view, project, locale, cx),
            // Material reads best with the whole width: diagrams and card grids spread out.
            Shown::Material(_) => match state.open_piece().zip(state.open_artifact()) {
                Some((piece, artifact)) => {
                    self.artifact_view(view.workspace(), piece, artifact, locale, cx)
                }
                None => view.item(quiet(text(locale, Message::LoadingStudy), cx)),
            },
        };
        status_line(view, state.error, false, locale).into()
    }
}

/// What the page of `kind` is for, under its title.
fn description(kind: ArtifactKind) -> Message {
    match kind {
        ArtifactKind::Flashcards => Message::FlashcardsDescription,
        ArtifactKind::Diagram => Message::DiagramsDescription,
    }
}
