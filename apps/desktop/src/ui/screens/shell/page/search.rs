//! Search everywhere: a palette over projects, chats, messages, and Library files, opened
//! with Ctrl+K (Cmd+K on macOS) or the toolbar button. Keyword and semantic matches come
//! from the app's search; the palette only asks and shows.

use super::*;
use std::time::Duration;

use crate::features::media::KindStyle as _;
use crate::features::search::{Group, grouped, snippet};
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::command::{Command, CommandGroup, CommandItem, CommandState};
use gpui_kit::component::{WindowExt as _, dialog::Dialog};
use gpui_kit::{
    AnyElement, AppContext as _, Entity, FontWeight, HighlightStyle, SharedString,
    StatefulInteractiveElement as _, StyledText,
};
use study_app::views::{SearchHit, SearchKind, SearchTarget};
use study_core::SourceKind;
use study_localization::joined;

/// Waits this long after the last keystroke before searching.
const DEBOUNCE: Duration = Duration::from_millis(120);
const MAX_RESULTS: usize = 30;
/// A result's row; adds its place on screen, counted down through every section, the
/// first being 0.
const RESULT: &str = "search-result";

pub(super) struct SearchState {
    command: Entity<CommandState>,
    query: String,
    hits: Vec<SearchHit>,
    /// Whether `hits` answer `query`: false while a new query waits for its first results.
    settled: bool,
    /// Whether the last results included semantic matches.
    semantic: bool,
    failed: bool,
    /// Only the newest query may apply its results.
    generation: u64,
}

impl SearchState {
    pub(super) fn new(window: &mut Window, cx: &mut Context<AppShell>) -> Self {
        Self {
            command: cx.new(|cx| CommandState::new(window, cx)),
            query: String::new(),
            hits: Vec::new(),
            settled: true,
            semantic: true,
            failed: false,
            generation: 0,
        }
    }
}

impl SearchState {
    /// What the palette says when it shows no results: a prompt before anything is typed,
    /// that nothing matches once the query's results are in, and nothing while they are
    /// on their way.
    fn empty_message(&self) -> Option<Message> {
        if self.query.trim().is_empty() {
            Some(Message::SearchPrompt)
        } else if self.settled {
            Some(Message::SearchNoResults)
        } else {
            None
        }
    }
}

impl AppShell {
    pub(super) fn open_search(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.search.generation += 1;
        self.search.query.clear();
        self.search.hits.clear();
        self.search.settled = true;
        self.search.failed = false;
        let command = self.search.command.clone();
        command.update(cx, |state, cx| state.set_query("", window, cx));
        let view = cx.entity().downgrade();
        window.open_dialog(cx, move |dialog, window, cx| {
            let Some(view) = view.upgrade() else {
                return dialog;
            };
            view.update(cx, |this, cx| this.search_dialog(dialog, window, cx))
        });
        command.update(cx, |state, cx| state.focus(window, cx));
        cx.notify();
    }

    fn search_dialog(&self, dialog: Dialog, _: &mut Window, cx: &mut Context<Self>) -> Dialog {
        let locale = self.preferences.language;
        let unit = |value| study_ui::scaled_px(cx, value);
        let view = cx.entity().downgrade();
        let confirm = view.clone();
        let hits = &self.search.hits;
        // Each row is counted by its place on screen, down through the sections.
        let mut place = 0;
        let mut groups = Vec::new();
        for (group, rows) in grouped(hits) {
            let mut items = Vec::new();
            for index in rows {
                items.push(search_item(
                    place,
                    index,
                    hits,
                    &self.search.query,
                    locale,
                    cx,
                ));
                place += 1;
            }
            groups.push(
                CommandGroup::new()
                    .label(text(locale, heading(group)))
                    .items(items),
            );
        }
        let note = if self.search.failed {
            Some(Message::SearchFailed)
        } else if !self.search.semantic && !self.search.query.is_empty() {
            Some(Message::SearchKeywordOnly)
        } else {
            None
        };
        let empty = self.search.empty_message();
        let tones = study_ui::palette(cx);
        let palette = groups
            .into_iter()
            .fold(Command::new(&self.search.command), Command::group)
            .filterable(false)
            .bordered(false)
            .max_h(unit(460.))
            .placeholder(text(locale, Message::SearchPlaceholder))
            .on_query(move |query, window, cx| {
                let query = query.to_owned();
                let _ = view.update(cx, |this, cx| this.run_search(query, window, cx));
            })
            .on_confirm(move |index, window, cx| {
                let _ = confirm.update(cx, |this, cx| {
                    let hit = grouped(&this.search.hits)
                        .get(index.section)
                        .and_then(|(_, rows)| rows.get(index.row).copied());
                    if let Some(hit) = hit {
                        this.open_search_hit(hit, window, cx);
                    }
                });
            })
            .empty(move |_, _, cx| {
                let unit = |value| study_ui::scaled_px(cx, value);
                let Some(empty) = empty else {
                    return div();
                };
                div()
                    .w_full()
                    .px(unit(32.))
                    .py(unit(36.))
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap(unit(study_ui::scale::SPACE_SM))
                    .text_color(tones.muted)
                    .child(study_ui::icon(IconName::Search).size(unit(24.)))
                    .child(
                        div()
                            .max_w(unit(360.))
                            .text_center()
                            .text_size(unit(study_ui::scale::TEXT_SMALL))
                            .child(text(locale, empty)),
                    )
            })
            .footer(move |_, _, cx| {
                let unit = |value| study_ui::scaled_px(cx, value);
                let key = |cap: Message| {
                    div()
                        .min_w(unit(18.))
                        .h(unit(18.))
                        .px(unit(4.))
                        .flex()
                        .items_center()
                        .justify_center()
                        .rounded(unit(study_ui::scale::RADIUS_SM))
                        .bg(tones.active)
                        .text_size(unit(study_ui::scale::TEXT_CAPTION))
                        .text_color(tones.muted)
                        .child(text(locale, cap))
                };
                let hint = |caps: &[Message], label: Message| {
                    div()
                        .flex()
                        .items_center()
                        .gap(unit(4.))
                        .children(caps.iter().map(|&cap| key(cap)))
                        .child(div().ml(unit(2.)).child(text(locale, label)))
                };
                div()
                    .w_full()
                    .px(unit(study_ui::scale::SPACE_SM))
                    .py(unit(study_ui::scale::SPACE_XS))
                    .flex()
                    .items_center()
                    .gap(unit(study_ui::scale::SPACE_MD))
                    .border_t_1()
                    .border_color(tones.border)
                    .text_size(unit(study_ui::scale::TEXT_CAPTION))
                    .text_color(tones.faint)
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .text_ellipsis()
                            .whitespace_nowrap()
                            .children(note.map(|note| text(locale, note))),
                    )
                    .child(hint(
                        &[Message::SearchKeyUp, Message::SearchKeyDown],
                        Message::SearchMove,
                    ))
                    .child(hint(&[Message::SearchKeyEnter], Message::SearchOpen))
                    .child(hint(&[Message::SearchKeyEscape], Message::SearchClose))
            });
        // A floating layer: the raised tone, a hairline edge and the large radius.
        dialog
            .w(unit(study_ui::scale::COLUMN_READ))
            .close_button(false)
            .p_0()
            .bg(tones.raised)
            .border_color(tones.border)
            .rounded(unit(study_ui::scale::RADIUS_LG))
            .child(palette)
    }

    /// Searches for `query` once typing pauses; a newer query supersedes it.
    fn run_search(&mut self, query: String, window: &mut Window, cx: &mut Context<Self>) {
        self.search.generation += 1;
        let generation = self.search.generation;
        self.search.query = query.clone();
        self.search.failed = false;
        self.search.settled = query.trim().is_empty();
        let command = self.search.command.clone();
        if query.trim().is_empty() {
            self.search.hits.clear();
            command.update(cx, |state, cx| state.set_loading(false, window, cx));
            cx.notify();
            return;
        }
        let app = self.app.clone();
        let handle = window.window_handle();
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(DEBOUNCE).await;
            let current = this
                .read_with(cx, |view, _| view.search.generation == generation)
                .unwrap_or(false);
            if !current {
                return;
            }
            let _ = handle.update(cx, |_, window, cx| {
                command.update(cx, |state, cx| state.set_loading(true, window, cx))
            });
            let result = cx
                .background_executor()
                .spawn(async move { app.search(&query, MAX_RESULTS) })
                .await;
            let _ = handle.update(cx, |_, window, cx| {
                let _ = this.update(cx, |view, cx| {
                    if view.search.generation != generation {
                        return;
                    }
                    view.search.settled = true;
                    match result {
                        Ok(results) => {
                            view.search.hits = results.hits;
                            view.search.semantic = results.semantic;
                        }
                        Err(error) => {
                            crate::features::errors::report(&error);
                            view.search.hits.clear();
                            view.search.failed = true;
                        }
                    }
                    command.update(cx, |state, cx| state.set_loading(false, window, cx));
                    cx.notify();
                });
            });
        })
        .detach();
    }

    /// Opens the result at `index` of the hits, in their ranked order.
    fn open_search_hit(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        let Some(hit) = self.search.hits.get(index) else {
            return;
        };
        let target = hit.target.clone();
        window.close_dialog(cx);
        match target {
            SearchTarget::Project(id) => {
                self.navigate(Page::Projects, cx);
                self.show_project(id);
            }
            SearchTarget::Session { session_id, .. } => {
                self.navigate(Page::Projects, cx);
                self.show_project_session();
                self.open_session(session_id, window, cx);
            }
            // A file attached to a conversation opens beside it; any other in the Library.
            SearchTarget::Source {
                source_id,
                session_id: Some(session_id),
                ..
            } => {
                self.navigate(Page::Projects, cx);
                self.show_project_session();
                self.open_session(session_id, window, cx);
                self.show_attachment(source_id, cx);
            }
            SearchTarget::Source { source_id, .. } => self.show_media(source_id, window, cx),
        }
        cx.notify();
    }
}

/// What a result in `group` is, after its name, as accessibility reads the row.
fn kind(group: Group) -> Message {
    match group {
        Group::Projects => Message::SearchKindProject,
        Group::Sessions => Message::SearchKindSession,
        Group::Files => Message::SearchKindFile,
        Group::Passages => Message::SearchKindPassage,
        Group::Messages => Message::SearchKindMessage,
    }
}

/// A section's heading.
fn heading(group: Group) -> Message {
    match group {
        Group::Projects => Message::SearchProjects,
        Group::Sessions => Message::SearchSessions,
        Group::Files => Message::SearchFiles,
        Group::Passages => Message::SearchPassages,
        Group::Messages => Message::SearchMessages,
    }
}

/// One result row: the monochrome glyph of what it is, its name with the place in the file and
/// when it was sent or last changed, where it lives, and the matching passage with the
/// searched words marked. The row shows the hit at `index` in `hits`; its id is `row`,
/// its place on screen, and accessibility reads it as its name and what it is.
fn search_item(
    row: usize,
    index: usize,
    hits: &[SearchHit],
    query: &str,
    locale: Locale,
    cx: &Context<AppShell>,
) -> CommandItem {
    let hit = &hits[index];
    let label = SharedString::from(joined(&[
        hit.title.clone(),
        text(locale, kind(Group::of(hit))).to_owned(),
    ]));
    let palette = study_ui::palette(cx);
    let icon = match hit.kind {
        SearchKind::Project => Page::Projects.icon(),
        SearchKind::Session => IconName::NotebookText,
        SearchKind::Message => IconName::MessageSquareText,
        SearchKind::Source => hit.file_kind.unwrap_or(SourceKind::Other).icon(),
    };
    let title = SharedString::from(hit.title.clone());
    let context = hit.context.clone().map(SharedString::from);
    // Where in the file the passage is, such as a page or a moment of a recording.
    let place = match &hit.target {
        SearchTarget::Source {
            anchor: Some(anchor),
            ..
        } => study_localization::anchor_label(locale, anchor).map(SharedString::from),
        _ => None,
    };
    let when = SharedString::from(crate::features::clock::moment(locale, hit.at));
    let excerpt = hit.excerpt.as_deref().map(|excerpt| {
        let (shown, marked) = snippet(excerpt, query);
        (SharedString::from(shown), marked)
    });
    CommandItem::new()
        .label(title.clone())
        .child(move |_, cx| -> AnyElement {
            let unit = |value| study_ui::scaled_px(cx, value);
            let heading = div()
                .flex()
                .items_center()
                .gap(unit(study_ui::scale::SPACE_XS))
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .text_ellipsis()
                        .whitespace_nowrap()
                        .text_size(unit(study_ui::scale::TEXT_UI))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(palette.foreground)
                        .child(title.clone()),
                )
                .children(place.clone().map(|place| {
                    div()
                        .flex_none()
                        .px(unit(study_ui::scale::SPACE_XS))
                        .rounded(unit(study_ui::scale::RADIUS_SM))
                        .bg(palette.active)
                        .text_size(unit(study_ui::scale::TEXT_CAPTION))
                        .text_color(palette.muted)
                        .child(place)
                }))
                .child(
                    div()
                        .flex_none()
                        .text_size(unit(study_ui::scale::TEXT_CAPTION))
                        .text_color(palette.faint)
                        .child(when.clone()),
                );
            let body = div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .gap(unit(2.))
                .child(heading)
                .children(context.clone().map(|context| {
                    div()
                        .w_full()
                        .min_w_0()
                        .overflow_hidden()
                        .text_ellipsis()
                        .whitespace_nowrap()
                        .text_size(unit(study_ui::scale::TEXT_CAPTION))
                        .text_color(palette.faint)
                        .child(context)
                }))
                .children(excerpt.clone().map(|(shown, marked)| {
                    // A match is washed in the highlighter, as a marker would.
                    let mark = HighlightStyle {
                        color: Some(palette.foreground),
                        background_color: Some(palette.highlighter_wash),
                        ..HighlightStyle::default()
                    };
                    div()
                        .w_full()
                        .min_w_0()
                        .overflow_hidden()
                        .mt(unit(2.))
                        .line_clamp(2)
                        .text_size(unit(study_ui::scale::TEXT_SMALL))
                        .text_color(palette.muted)
                        .child(
                            StyledText::new(shown)
                                .with_highlights(marked.into_iter().map(|range| (range, mark))),
                        )
                }));
            // The palette draws the row around this and names it by nothing, so this names
            // it, under an id that keeps its place on screen.
            div()
                .id((RESULT, row as u64))
                .test_support()
                .aria_label(label.clone())
                .w_full()
                .flex()
                .items_start()
                .gap(unit(study_ui::scale::SPACE_SM))
                .py(unit(study_ui::scale::SPACE_XXS))
                .child(
                    div()
                        .flex_none()
                        .h(unit(20.))
                        .flex()
                        .items_center()
                        .text_color(palette.muted)
                        .child(study_ui::icon(icon).size(unit(16.))),
                )
                .child(body)
                .into_any_element()
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::preferences::Preferences;
    use gpui_kit::component::ThemeMode;
    use gpui_kit::test::TestWindowExt as _;
    use gpui_kit::{AnyWindowHandle, TestAppContext, WindowOptions};
    use study_app::views::MessageRole;
    use study_core::db::{ChunkDraft, Database, NewPart, PartContent, read_nothing};
    use study_core::{Anchor, Block, BlockKind, Document, DocumentMeta};

    fn open_shell(
        cx: &mut TestAppContext,
        path: &std::path::Path,
    ) -> (AnyWindowHandle, Entity<AppShell>) {
        cx.update(gpui_kit::init);
        cx.update(|cx| {
            study_ui::configure_theme(cx, ThemeMode::Light);
            crate::app::desktop::bind_shortcuts(cx);
        });
        let (window, shell) = cx.update(|cx| {
            gpui_kit::open_window(WindowOptions::default(), cx, |window, cx| {
                cx.new(|cx| {
                    AppShell::new(
                        {
                            let app = study_app::App::open(path).expect("the app opens");
                            app.turn_off_search_model();
                            app
                        },
                        Preferences::default(),
                        false,
                        window,
                        cx,
                    )
                })
            })
            .unwrap()
        });
        (window, shell)
    }

    fn with_window(
        cx: &mut TestAppContext,
        window: AnyWindowHandle,
        act: impl FnOnce(&mut Window, &mut gpui_kit::App),
    ) {
        cx.update_window(window, |_, window, cx| {
            window.render_frame(cx);
            act(window, cx);
        })
        .unwrap();
        cx.run_until_parked();
    }

    #[gpui_kit::test]
    fn ctrl_k_finds_a_message_and_opens_its_session(cx: &mut TestAppContext) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("study.sqlite3");
        let database = Database::open(&path).unwrap();
        let project = database.create_project("Biology").unwrap();
        let session = database.create_session(project.id, "Cells").unwrap();
        database
            .post_message(
                session.id,
                MessageRole::User,
                &[NewPart::Text("Mitochondria are the powerhouse".into())],
                &read_nothing,
            )
            .unwrap();
        let (window, shell) = open_shell(cx, &path);

        #[cfg(target_os = "macos")]
        with_window(cx, window, |window, cx| window.press("cmd-k", cx));
        #[cfg(not(target_os = "macos"))]
        with_window(cx, window, |window, cx| window.press("ctrl-k", cx));
        with_window(cx, window, |window, cx| {
            assert!(window.has_active_dialog(cx), "the palette opened");
            window.input("powerhouse", cx);
        });
        // While the query waits out the debounce, the palette does not say nothing matches.
        let empty = |cx: &mut TestAppContext| cx.update(|cx| shell.read(cx).search.empty_message());
        assert_eq!(empty(cx), None);
        // Past the debounce, the search runs and its results render.
        cx.executor().advance_clock(DEBOUNCE * 2);
        cx.run_until_parked();
        let hits = cx.update(|cx| shell.read(cx).search.hits.clone());
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title, "Cells");
        assert_eq!(hits[0].context.as_deref(), Some("Biology"));
        // The row is named by its title and what it is, under an id that keeps its place.
        with_window(cx, window, |window, _| {
            let row = window.try_find((RESULT, 0u64)).expect("the result's row");
            assert_eq!(row.label(), Some("Cells · Message"));
        });

        with_window(cx, window, |window, cx| window.press("enter", cx));
        cx.update(|cx| {
            let shell = shell.read(cx);
            assert_eq!(shell.active, Page::Projects);
            assert_eq!(shell.sessions.session_id(), Some(session.id));
        });
        with_window(cx, window, |window, cx| {
            assert!(!window.has_active_dialog(cx), "the palette closed");
        });
    }

    /// A query says nothing matches only once its search has run and found nothing.
    #[gpui_kit::test]
    fn nothing_matches_only_once_the_search_has_run(cx: &mut TestAppContext) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("study.sqlite3");
        Database::open(&path).unwrap();
        let (window, shell) = open_shell(cx, &path);
        let empty = |cx: &mut TestAppContext| cx.update(|cx| shell.read(cx).search.empty_message());

        with_window(cx, window, |window, cx| {
            shell.update(cx, |shell, cx| shell.open_search(window, cx))
        });
        assert_eq!(empty(cx), Some(Message::SearchPrompt));
        with_window(cx, window, |window, cx| window.input("zebra", cx));
        assert_eq!(empty(cx), None, "nothing is said while the search waits");
        cx.executor().advance_clock(DEBOUNCE * 2);
        cx.run_until_parked();
        assert_eq!(empty(cx), Some(Message::SearchNoResults));
        with_window(cx, window, |window, cx| window.input("s", cx));
        assert_eq!(empty(cx), None, "a newer query waits for its own results");
    }

    /// A query typed over another shows only its own results. Several seeds: without the
    /// generation guard, which of the two searches ends last varies with the seed.
    #[gpui_kit::test(iterations = 10)]
    fn only_the_newest_query_shows_its_results(cx: &mut TestAppContext) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("study.sqlite3");
        let database = Database::open(&path).unwrap();
        database.create_project("Zebra").unwrap();
        database.create_project("Walrus").unwrap();
        let (window, shell) = open_shell(cx, &path);

        with_window(cx, window, |window, cx| {
            shell.update(cx, |shell, cx| {
                shell.open_search(window, cx);
                shell.run_search("zebra".into(), window, cx);
                shell.run_search("walrus".into(), window, cx);
            })
        });
        cx.executor().advance_clock(DEBOUNCE * 2);
        cx.run_until_parked();
        let titles: Vec<String> = cx.update(|cx| {
            let hits = &shell.read(cx).search.hits;
            hits.iter().map(|hit| hit.title.clone()).collect()
        });
        assert_eq!(titles, ["Walrus"]);
    }

    #[gpui_kit::test]
    fn a_passage_of_an_attached_file_opens_beside_its_session(cx: &mut TestAppContext) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("study.sqlite3");
        let database = Database::open(&path).unwrap();
        let project = database.create_project("Biology").unwrap();
        let session = database.create_session(project.id, "Cells").unwrap();
        // A project that matches too, so the results fill more than one section.
        database.create_project("Ribosomes").unwrap();
        let file = dir.path().join("cells.txt");
        std::fs::write(&file, "Ribosomes build proteins").unwrap();
        let message = database
            .post_message(
                session.id,
                MessageRole::User,
                &[NewPart::File(file)],
                &read_nothing,
            )
            .unwrap();
        let PartContent::Source {
            source_id: Some(source),
            ..
        } = message.parts[0].content
        else {
            panic!("expected the attachment");
        };
        let anchor = Anchor::Page { page: 1 };
        let document = database
            .save_document(
                source,
                &Document {
                    blocks: vec![Block {
                        kind: BlockKind::Paragraph,
                        text: "Ribosomes build proteins".into(),
                        anchor: anchor.clone(),
                    }],
                    meta: DocumentMeta {
                        extractor: Some(study_core::processing::ExtractorKind::Text),
                        ..DocumentMeta::default()
                    },
                },
            )
            .unwrap();
        database
            .store_chunks(
                document,
                &[ChunkDraft {
                    first_block: 0,
                    last_block: 0,
                    anchor,
                    text: "Ribosomes build proteins".into(),
                }],
            )
            .unwrap();
        let (window, shell) = open_shell(cx, &path);

        with_window(cx, window, |window, cx| {
            shell.update(cx, |shell, cx| shell.open_search(window, cx))
        });
        with_window(cx, window, |window, cx| window.input("ribosomes", cx));
        cx.executor().advance_clock(DEBOUNCE * 2);
        cx.run_until_parked();
        let hits = cx.update(|cx| shell.read(cx).search.hits.clone());
        let row = hits
            .iter()
            .position(|hit| hit.excerpt.is_some())
            .expect("the passage");
        // Each row's id is its place on screen, down through the sections, even where the
        // ranking puts a later section's hit first.
        let mut ranked = hits.clone();
        ranked.reverse();
        let on_screen: Vec<usize> = grouped(&ranked)
            .into_iter()
            .flat_map(|(_, rows)| rows)
            .collect();
        assert_eq!(on_screen, [1, 0], "the sections reorder the ranking");
        cx.update(|cx| {
            shell.update(cx, |shell, cx| {
                shell.search.hits = ranked.clone();
                cx.notify();
            })
        });
        with_window(cx, window, |window, _| {
            for (place, &index) in on_screen.iter().enumerate() {
                let row = window.try_find((RESULT, place as u64)).expect("a row");
                let hit = &ranked[index];
                let kind = text(Locale::English, kind(Group::of(hit)));
                let label = joined(&[hit.title.clone(), kind.to_owned()]);
                assert_eq!(row.label(), Some(label.as_str()));
            }
        });
        cx.update(|cx| shell.update(cx, |shell, _| shell.search.hits = hits.clone()));
        with_window(cx, window, |window, cx| {
            shell.update(cx, |shell, cx| shell.open_search_hit(row, window, cx))
        });
        cx.update(|cx| {
            let shell = shell.read(cx);
            assert_eq!(shell.active, Page::Projects);
            assert_eq!(shell.sessions.session_id(), Some(session.id));
            assert_eq!(shell.sessions.panel, Some(pages::SidePanel::File(source)));
        });
    }
}
