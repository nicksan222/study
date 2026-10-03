//! The Library: every source, filed under projects. Files are imported here, notes typed and
//! links added (`components/made.rs`); opening one shows its preview and what was read from
//! it. The gallery, a file's page and the upload dialog live in `components/`.
//!
//! The UI calls this page the Library; `media_list` is its name in the code only.

use super::ids;
use crate::features::media::{MediaPreview, Original, original_of, preview_of, same_preview};
use crate::ui::screens::shell::page::pages::components::{Alert, show_dialog};
use crate::ui::screens::shell::page::*;
use gpui_kit::component::input::{InputEvent, InputState};
use gpui_kit::component::{Disableable as _, WindowExt as _, button::ButtonVariants as _};
use gpui_kit::{AppContext as _, Entity, Subscription, Window};
use std::{collections::HashMap, path::PathBuf};
use study_app::views::{Anchor, Document, Project, Source};
use study_core::{ProjectId, SourceId};
use study_ui::{MenuItem, PageView, SectionSidebar, button, icon_button};

/// What the Library shows.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(super) enum MediaMode {
    /// The gallery of files.
    #[default]
    List,
    /// One file's page.
    Detail(SourceId),
}

/// The Library page: its files and projects, what is shown, and the previews made so far.
pub(in crate::ui::screens::shell::page) struct MediaState {
    pub(super) items: Vec<Source>,
    pub(super) projects: Vec<Project>,
    pub(super) mode: MediaMode,
    pub(super) filter_project: Option<ProjectId>,
    pub(super) search: Entity<InputState>,
    search_locale: Option<Locale>,
    _search_subscription: Subscription,
    pub(super) previews: HashMap<SourceId, MediaPreview>,
    /// What was read from files opened in detail.
    pub(super) documents: HashMap<SourceId, Document>,
    /// The place a citation opened a file at, whose blocks then show first.
    pub(super) cited: Option<(SourceId, Anchor)>,
    /// The text before the cited place shows too; the place stays marked.
    pub(super) cited_earlier: bool,
    /// Originals already written out for the system viewer, from any page (see
    /// `AppShell::open_original`), kept while the app runs.
    originals: HashMap<SourceId, Original>,
    /// Only the newest round of `load_media_previews` may keep bringing previews.
    preview_generation: u64,
    pub(super) loaded: bool,
    pub(super) loading: bool,
    /// Something changed while a load was running, so load again when it ends.
    reload: bool,
    pub(super) picking: bool,
    pub(super) busy: bool,
    pub(super) error: Option<Message>,
    /// The file whose deleting is being asked, in an alert.
    deleting: Option<SourceId>,
}

impl MediaState {
    pub(in crate::ui::screens::shell::page) fn new(
        window: &mut Window,
        cx: &mut Context<AppShell>,
    ) -> Self {
        let search = cx.new(|cx| InputState::new(window, cx));
        let subscription = cx.subscribe(&search, |_, _, event: &InputEvent, cx| {
            if matches!(event, InputEvent::Change) {
                cx.notify();
            }
        });
        Self {
            items: Vec::new(),
            projects: Vec::new(),
            mode: MediaMode::List,
            filter_project: None,
            search,
            search_locale: None,
            _search_subscription: subscription,
            previews: HashMap::new(),
            documents: HashMap::new(),
            cited: None,
            cited_earlier: false,
            originals: HashMap::new(),
            preview_generation: 0,
            loaded: false,
            loading: false,
            reload: false,
            picking: false,
            busy: false,
            deleting: None,
            error: None,
        }
    }

    /// Whether a load or a change is under way, which holds off every other change.
    pub(super) fn working(&self) -> bool {
        self.busy || self.loading
    }

    /// The listed file with `id`, if it is still there.
    pub(super) fn item(&self, id: SourceId) -> Option<&Source> {
        self.items.iter().find(|item| item.id == id)
    }

    /// The choices of a project menu: `none` first, which files under no project or every
    /// project, then each project by name.
    pub(super) fn project_choices(
        &self,
        none: Message,
        locale: Locale,
    ) -> Vec<(Option<ProjectId>, String)> {
        std::iter::once((None, text(locale, none).to_owned()))
            .chain(
                self.projects
                    .iter()
                    .map(|project| (Some(project.id), project.name.clone())),
            )
            .collect()
    }

    /// Drops everything held for a file that was deleted, and leaves its page.
    fn forget(&mut self, id: SourceId) {
        self.items.retain(|item| item.id != id);
        self.previews.remove(&id);
        self.documents.remove(&id);
        self.originals.remove(&id);
        self.mode = MediaMode::List;
    }
}

impl AppShell {
    /// Shows the search field's placeholder in `locale`. Runs from `render`, where a window
    /// is at hand.
    pub(in crate::ui::screens::shell::page) fn sync_media_search(
        &mut self,
        locale: Locale,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.media.search_locale != Some(locale) {
            self.media.search_locale = Some(locale);
            self.media.search.update(cx, |input, cx| {
                input.set_placeholder(text(locale, Message::SearchMedia), window, cx)
            });
        }
    }

    /// Opens the Library filtered to one project's files.
    pub(in crate::ui::screens::shell::page) fn show_project_media(
        &mut self,
        id: ProjectId,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.media.mode = MediaMode::List;
        self.media.filter_project = Some(id);
        self.media
            .search
            .update(cx, |input, cx| input.set_value(String::new(), window, cx));
        self.navigate(Page::MediaList, cx);
    }

    /// Opens one Library file at the place a citation names: its blocks start there, the
    /// cited ones marked.
    pub(in crate::ui::screens::shell::page) fn show_media_at(
        &mut self,
        id: SourceId,
        at: Anchor,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.show_media(id, window, cx);
        self.media.cited = Some((id, at));
        self.media.cited_earlier = false;
    }

    /// Opens one Library file, whatever the list was filtered to.
    pub(in crate::ui::screens::shell::page) fn show_media(
        &mut self,
        id: SourceId,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.open_media_detail(id, cx);
        self.media.filter_project = None;
        self.media
            .search
            .update(cx, |input, cx| input.set_value(String::new(), window, cx));
        self.navigate(Page::MediaList, cx);
    }

    /// Back from a file to the whole Library, unfiltered.
    pub(super) fn show_all_media(&mut self, cx: &mut Context<Self>) {
        self.media.mode = MediaMode::List;
        self.media.filter_project = None;
        self.media.error = None;
        cx.notify();
    }

    /// Shows one file from its start, and loads what was read from it.
    pub(super) fn open_media_detail(&mut self, id: SourceId, cx: &mut Context<Self>) {
        self.media.mode = MediaMode::Detail(id);
        self.media.error = None;
        // A passage cited earlier is not where the file opens now.
        self.media.cited = None;
        self.media.cited_earlier = false;
        cx.notify();
        self.load_media_document(id, cx);
    }

    /// Reads what was read from a file, for its page.
    fn load_media_document(&mut self, id: SourceId, cx: &mut Context<Self>) {
        self.background(
            move |app| app.source_document(id),
            move |view, result, cx| {
                match result {
                    Ok(Some(document)) => {
                        view.media.documents.insert(id, document);
                    }
                    Ok(None) => {
                        view.media.documents.remove(&id);
                    }
                    Err(error) => crate::features::errors::report(&error),
                }
                cx.notify();
            },
            cx,
        );
    }

    /// The files the project filter and the search let through.
    pub(super) fn visible_media<'a>(
        &'a self,
        cx: &gpui_kit::App,
    ) -> impl Iterator<Item = &'a Source> + use<'a> {
        let query = self.media.search.read(cx).value().trim().to_lowercase();
        self.media.items.iter().filter(move |item| {
            (self.media.filter_project.is_none() || item.project_id == self.media.filter_project)
                && (query.is_empty() || item.name.to_lowercase().contains(&query))
        })
    }

    /// Runs the load a change asked for while an action kept the Library busy.
    fn reload_media_if_asked(&mut self, cx: &mut Context<Self>) {
        if std::mem::take(&mut self.media.reload) {
            self.load_media(cx);
        }
    }

    /// Reads the files and projects; while a change runs, reads once it ends.
    pub(in crate::ui::screens::shell::page) fn load_media(&mut self, cx: &mut Context<Self>) {
        if self.media.working() {
            self.media.reload = true;
            return;
        }
        self.media.loading = true;
        cx.notify();
        // The open file may have just been read.
        if let MediaMode::Detail(id) = self.media.mode {
            self.load_media_document(id, cx);
        }
        self.background(
            |app| Ok::<_, study_core::Error>((app.sources()?, app.projects()?)),
            |view, result, cx| {
                view.media.loading = false;
                view.media.loaded = true;
                match result {
                    Ok((items, projects)) => {
                        // A source changed in place, such as a link its Fetch job brought
                        // in, needs a new preview.
                        let media = &mut view.media;
                        media.previews.retain(|id, _| {
                            media.items.iter().any(|old| {
                                old.id == *id && items.iter().any(|now| same_preview(old, now))
                            })
                        });
                        view.media.items = items;
                        view.media.projects = projects;
                        if view.media.error == Some(Message::MediaLoadError) {
                            view.media.error = None;
                        }
                        if !view
                            .media
                            .projects
                            .iter()
                            .any(|project| Some(project.id) == view.media.filter_project)
                        {
                            view.media.filter_project = None;
                        }
                        view.load_media_previews(cx);
                    }
                    Err(error) => {
                        crate::features::errors::report(&error);
                        view.media.items.clear();
                        view.media.projects.clear();
                        view.media.mode = MediaMode::List;
                        view.media.error = Some(Message::MediaLoadError);
                    }
                }
                view.reload_media_if_asked(cx);
                cx.notify();
            },
            cx,
        );
    }

    /// Opens the upload dialog.
    pub(super) fn start_media_upload(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.media.working() || self.media.error == Some(Message::MediaLoadError) {
            return;
        }
        self.media.error = None;
        show_dialog(Self::media_upload_dialog, window, cx);
    }

    /// Asks the system for files to import.
    pub(in crate::ui::screens::shell::page) fn choose_media_file(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.media.picking || self.media.busy {
            return;
        }
        self.media.picking = true;
        self.media.error = None;
        cx.notify();
        self.pick_files(
            Message::ChooseMediaFile,
            window,
            |view, picked, window, cx| {
                view.media.picking = false;
                match picked {
                    Picked::Files(paths) => view.import_media_paths(paths, window, cx),
                    Picked::Dismissed => {}
                    Picked::Failed => view.media.error = Some(Message::MediaPickerError),
                }
                cx.notify();
            },
            cx,
        );
    }

    /// Imports `paths` under the project the Library is filtered to, then closes the upload
    /// dialog, unless a file failed.
    pub(super) fn import_media_paths(
        &mut self,
        paths: Vec<PathBuf>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        // A load may run meanwhile: the import is independent, and a reload follows it.
        if self.media.busy || paths.is_empty() {
            return;
        }
        let project_id = self.media.filter_project;
        // Imported files are read (pages, transcription) in the background and so become
        // searchable by content; without background work they are queued when it starts.
        self.media.busy = true;
        self.media.error = None;
        cx.notify();
        // Each file is imported on its own; the ones that fail are reported and left out.
        self.background_in_window(
            window,
            move |app| {
                let mut items = Vec::new();
                let mut failed = false;
                for imported in app.import_files(&paths, project_id) {
                    match imported {
                        Ok(item) => items.push(item),
                        Err(error) => {
                            crate::features::errors::report(&error);
                            failed = true;
                        }
                    }
                }
                (items, failed)
            },
            |view, (items, failed), window, cx| {
                view.media.busy = false;
                view.reload_media_if_asked(cx);
                if !items.is_empty() {
                    view.media
                        .search
                        .update(cx, |input, cx| input.set_value(String::new(), window, cx));
                }
                // The list is newest first, as the database lists it.
                view.media.items.splice(0..0, items.into_iter().rev());
                view.media.mode = MediaMode::List;
                if failed {
                    view.media.error = Some(Message::MediaImportError);
                } else {
                    window.close_dialog(cx);
                }
                view.load_media_previews(cx);
                cx.notify();
            },
            cx,
        );
    }

    /// Files a source under `project_id`, or under no project.
    pub(super) fn associate_media(
        &mut self,
        source_id: SourceId,
        project_id: Option<ProjectId>,
        cx: &mut Context<Self>,
    ) {
        if self.media.working() {
            return;
        }
        // Once saved, a load asked for meanwhile runs.
        self.change(
            |view| (&mut view.media.busy, &mut view.media.error),
            move |app| app.set_source_project(source_id, project_id),
            move |view| {
                let project_name = view
                    .media
                    .projects
                    .iter()
                    .find(|project| Some(project.id) == project_id)
                    .map(|project| project.name.clone());
                if let Some(item) = view
                    .media
                    .items
                    .iter_mut()
                    .find(|item| item.id == source_id)
                {
                    item.project_id = project_id;
                    item.project_name = project_name;
                }
            },
            Message::MediaAssociateError,
            Self::reload_media_if_asked,
            cx,
        );
    }

    fn delete_source(&mut self, id: SourceId, cx: &mut Context<Self>) {
        if self.media.working() {
            return;
        }
        self.change(
            |view| (&mut view.media.busy, &mut view.media.error),
            move |app| app.delete_source(id),
            move |view| view.media.forget(id),
            Message::MediaDeleteError,
            Self::reload_media_if_asked,
            cx,
        );
    }

    /// The sidebar: the whole Library, then a row per file.
    pub(in crate::ui::screens::shell::page) fn media_sidebar(
        &self,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> SectionSidebar {
        let mut sidebar = SectionSidebar::new(text(locale, Message::MediaList)).action(
            icon_button(
                ids::SIDEBAR_UPLOAD,
                text(locale, Message::UploadMedia),
                IconName::Plus,
                cx,
            )
            .disabled(self.media.working() || self.media.error == Some(Message::MediaLoadError))
            .on_click(cx.listener(|this, _, window, cx| this.start_media_upload(window, cx))),
        );
        sidebar = sidebar.item(
            MenuItem::new(ids::SIDEBAR_ALL, text(locale, Message::AllMedia))
                .icon(IconName::Images)
                .selected(self.media.mode == MediaMode::List)
                .disabled(self.media.working())
                .on_click(cx.listener(|this, _, _, cx| this.show_all_media(cx))),
        );
        for item in &self.media.items {
            let id = item.id;
            let selected = matches!(
                self.media.mode,
                MediaMode::Detail(selected) if selected == id
            );
            sidebar = sidebar.item(
                MenuItem::new((ids::ROW, id.get() as u64), item.name.clone())
                    .icon(IconName::File)
                    .selected(selected)
                    .disabled(self.media.working())
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.open_media_detail(id, cx);
                    })),
            );
        }
        sidebar
    }

    pub(in crate::ui::screens::shell::page) fn media_page(
        &self,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> PageView {
        let page = match self.media.mode {
            MediaMode::List => self.media_list_page(locale, cx),
            MediaMode::Detail(id) => self.media_detail_page(id, locale, cx),
        };
        page.into()
    }

    /// Asks before a file is deleted, in an alert.
    pub(super) fn confirm_delete_media(&mut self, id: SourceId, cx: &mut Context<Self>) {
        if self.media.busy {
            return;
        }
        self.media.deleting = Some(id);
        cx.notify();
    }

    /// While deleting a file is asked: that it cannot be undone, as an alert.
    pub(in crate::ui::screens::shell::page) fn media_alert(
        &self,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> Option<Alert> {
        let id = self.media.deleting?;
        let confirm = button(ids::CONFIRM_DELETE, text(locale, Message::DeleteMedia), cx)
            .danger()
            .disabled(self.media.working())
            .on_click(cx.listener(move |this, _, _, cx| {
                this.media.deleting = None;
                this.delete_source(id, cx);
                cx.notify();
            }));
        Some(Alert::new(
            text(locale, Message::AlertDeleteMedia),
            text(locale, Message::ConfirmDeleteMedia),
            confirm,
            ids::CANCEL_DELETE,
            |this, cx| {
                this.media.deleting = None;
                cx.notify();
            },
        ))
    }

    /// Prepares the previews the listed files lack, one by one; a newer round drops what an
    /// older one has yet to bring.
    fn load_media_previews(&mut self, cx: &mut Context<Self>) {
        self.media.preview_generation += 1;
        let generation = self.media.preview_generation;
        self.media
            .previews
            .retain(|id, _| self.media.items.iter().any(|item| item.id == *id));
        let items: Vec<_> = self
            .media
            .items
            .iter()
            .filter(|item| !self.media.previews.contains_key(&item.id))
            .cloned()
            .collect();
        self.background_each(
            items,
            |app, item| (item.id, preview_of(app, &item)),
            move |view, (id, preview), cx| {
                if view.media.preview_generation != generation {
                    return false;
                }
                if view.media.items.iter().any(|item| item.id == id) {
                    view.media.previews.insert(id, preview);
                }
                cx.notify();
                true
            },
            cx,
        );
    }

    /// Opens a file with the system viewer; a web page or video opens where it came from.
    pub(super) fn open_media_original(&mut self, id: SourceId, cx: &mut Context<Self>) {
        if self.media.busy {
            return;
        }
        let Some(item) = self.media.item(id) else {
            return;
        };
        if let Some(uri) = &item.uri {
            cx.open_url(uri);
            return;
        }
        self.media.error = None;
        self.open_original(id, |view| &mut view.media.error, cx);
    }

    /// Opens a source's file with the system viewer, from a private temporary copy written
    /// once while the app runs. A failure is logged and shown in the page's `error`.
    pub(in crate::ui::screens::shell::page) fn open_original(
        &mut self,
        id: SourceId,
        error: fn(&mut Self) -> &mut Option<Message>,
        cx: &mut Context<Self>,
    ) {
        if let Some(original) = self.media.originals.get(&id) {
            cx.open_with_system(original.path());
            return;
        }
        self.background(
            move |app| original_of(app, id),
            move |view, result, cx| {
                match result {
                    Ok(original) => {
                        cx.open_with_system(original.path());
                        view.media.originals.insert(id, original);
                    }
                    Err(failure) => {
                        crate::features::errors::report(&failure);
                        *error(view) = Some(Message::MediaOpenError);
                    }
                }
                cx.notify();
            },
            cx,
        );
    }
}
