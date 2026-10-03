//! The Library page, end to end: opening a cited file again, and importing, filing under a
//! project and deleting.

use super::*;
use crate::app::preferences::Preferences;
use crate::features::media::MediaPreview;
use crate::testing::TempApp;
use crate::ui::screens::shell::page::testing::{click, open_shell, wait_until};
use crate::ui::screens::shell::page::*;
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::{AppContext as _, ExternalPaths, TestAppContext};
use study_app::views::{Anchor, Document};
use study_core::processing::Fetched;

/// A file opened again after a citation opened it starts at its beginning.
#[gpui_kit::test]
fn a_file_opened_again_forgets_the_passage_cited_before(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let file = app.dir().join("notes.txt");
    std::fs::write(&file, "Mitochondria make ATP.").unwrap();
    let id = app.import_file(&file, None).unwrap().id;
    let (window, shell) = open_shell(cx, app.app(), Preferences::default());
    cx.update_window(window, |_, window, cx| {
        shell.update(cx, |shell, cx| {
            shell.show_media_at(id, Anchor::Page { page: 1 }, window, cx);
            shell.media.cited_earlier = true;
        })
    })
    .unwrap();
    assert!(cx.update(|cx| shell.read(cx).media.cited.is_some()));
    cx.update(|cx| shell.update(cx, |shell, cx| shell.open_media_detail(id, cx)));
    let media = cx.update(|cx| {
        let media = &shell.read(cx).media;
        (media.cited.is_some(), media.cited_earlier)
    });
    assert_eq!(media, (false, false));
}

#[gpui_kit::test]
fn media_flow_imports_associates_and_deletes(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let file = app.dir().join(text(Locale::English, Message::MediaFile));
    std::fs::write(&file, text(Locale::English, Message::MediaList)).unwrap();
    let project = app
        .create_project(text(Locale::English, Message::Projects))
        .unwrap();

    let (window, shell) = open_shell(cx, app.app(), Preferences::default());

    click(cx, window, Page::MediaList as usize);
    assert!(!cx.update(|cx| shell.read(cx).sidebar_visible()));
    click(cx, window, ids::UPLOAD);
    click(cx, window, ids::CHOOSE_FILE);
    assert!(cx.did_prompt_for_paths());
    cx.simulate_path_prompt_response(|_| None);
    cx.run_until_parked();
    assert!(app.sources().unwrap().is_empty());
    click(cx, window, ids::CHOOSE_FILE);
    cx.simulate_path_prompt_response(|_| Some(vec![file.clone()]));
    cx.run_until_parked();
    let imported = app.sources().unwrap();
    click(cx, window, (ids::TILE, imported[0].id.get() as u64));
    cx.update(|cx| {
        shell.update(cx, |shell, cx| {
            shell.associate_media(imported[0].id, Some(project.id), cx)
        })
    });
    cx.run_until_parked();
    let items = app.sources().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].project_id, Some(project.id));
    assert_eq!(items[0].name, text(Locale::English, Message::MediaFile));
    for (query, expected) in [
        (items[0].name.to_uppercase(), 1),
        ("no matching file".to_owned(), 0),
    ] {
        cx.update_window(window, |_, window, cx| {
            shell.update(cx, |shell, cx| {
                shell
                    .media
                    .search
                    .update(cx, |input, cx| input.set_value(query, window, cx))
            });
        })
        .unwrap();
        cx.run_until_parked();
        assert_eq!(
            cx.update(|cx| shell.read(cx).visible_media(cx).count()),
            expected
        );
    }
    cx.update_window(window, |_, window, cx| {
        shell.update(cx, |shell, cx| {
            shell.show_project_media(project.id, window, cx)
        });
    })
    .unwrap();
    cx.run_until_parked();
    assert_eq!(
        cx.update(|cx| shell.read(cx).media.filter_project),
        Some(project.id)
    );
    assert!(cx.update(|cx| shell.read(cx).media.search.read(cx).value().is_empty()));
    assert_eq!(cx.update(|cx| shell.read(cx).visible_media(cx).count()), 1);

    click(cx, window, shell_ids::TOGGLE_SIDEBAR);
    assert!(cx.update(|cx| shell.read(cx).sidebar_visible()));
    click(cx, window, ids::SIDEBAR_ALL);
    click(cx, window, (ids::TILE, items[0].id.get() as u64));
    click(cx, window, ids::BACK_TO_ALL);
    click(cx, window, (ids::TILE, items[0].id.get() as u64));
    click(cx, window, Page::Projects as usize);
    assert!(cx.update(|cx| shell.read(cx).sidebar_visible()));
    click(cx, window, Page::MediaList as usize);
    assert!(cx.update(|cx| shell.read(cx).sidebar_visible()));

    // A change waits out a load under way: this one is refused.
    cx.update(|cx| {
        shell.update(cx, |shell, cx| {
            shell.media.loading = true;
            cx.notify();
        });
    });
    cx.update(|cx| shell.update(cx, |shell, cx| shell.associate_media(items[0].id, None, cx)));
    cx.run_until_parked();
    assert_eq!(app.sources().unwrap()[0].project_id, Some(project.id));
    cx.update(|cx| {
        shell.update(cx, |shell, cx| {
            shell.media.loading = false;
            cx.notify();
        });
    });
    cx.update(|cx| shell.update(cx, |shell, cx| shell.associate_media(items[0].id, None, cx)));
    cx.run_until_parked();
    assert_eq!(app.sources().unwrap()[0].project_id, None);
    click(cx, window, ids::BACK_TO_ALL);
    cx.update_window(window, |_, window, cx| {
        window.right_click((ids::TILE, items[0].id.get() as u64), cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(window, |_, window, cx| {
        // The tile's menu: Up picks its last item, Delete.
        window.render_frame(cx);
        window.press("up", cx);
        window.press("enter", cx);
    })
    .unwrap();
    cx.run_until_parked();
    // As if what was read from the file had been loaded when it was opened.
    cx.update(|cx| {
        shell.update(cx, |shell, _| {
            shell
                .media
                .documents
                .insert(items[0].id, Document::default())
        })
    });
    click(cx, window, ids::CONFIRM_DELETE);
    assert!(app.sources().unwrap().is_empty());
    assert!(cx.update(|cx| shell.read(cx).media.documents.is_empty()));
    // Exercise real external file-drop dispatch, including partial batch failure.
    click(cx, window, ids::UPLOAD);
    cx.update_window(window, |_, window, cx| {
        use gpui_kit::{FileDropEvent, InputEvent as _};
        window.render_frame(cx);
        let mut position = window.find(ids::CHOOSE_FILE).bounds().center();
        // Over the drop zone, which sits above the button.
        position.x = window.viewport_size().width / 2.;
        position.y -= study_ui::scaled_px(cx, 140.);
        let missing = app
            .dir()
            .join(text(Locale::English, Message::MediaImportError));
        window.dispatch_event(
            FileDropEvent::Entered {
                position,
                paths: ExternalPaths([file, missing].into_iter().collect()),
            }
            .to_platform_input(),
            cx,
        );
        window.render_frame(cx);
        window.dispatch_event(FileDropEvent::Submit { position }.to_platform_input(), cx);
    })
    .unwrap();
    cx.run_until_parked();
    assert_eq!(app.sources().unwrap().len(), 1);
    assert_eq!(
        cx.update(|cx| shell.read(cx).media.error),
        Some(Message::MediaImportError)
    );
    click(cx, window, ids::CANCEL_UPLOAD);
    cx.update(|cx| shell.update(cx, |shell, _| shell.media.filter_project = Some(project.id)));
    app.delete_project(project.id).unwrap();
    cx.update(|cx| shell.update(cx, |shell, cx| shell.load_media(cx)));
    cx.run_until_parked();
    assert_eq!(cx.update(|cx| shell.read(cx).media.filter_project), None);
}

/// A link that its Fetch job brought in shows as what it now holds once the Library reads
/// it again (as it does when a job reports): its new name, and a preview of its new
/// contents rather than the link's.
#[gpui_kit::test]
fn a_fetched_link_shows_as_its_page_in_the_library(cx: &mut TestAppContext) {
    let app = TempApp::new();
    // Stored as the app stores it, without starting the background work that would fetch it.
    let (link, _) = app
        .database()
        .add_link(None, "https://example.com/cells")
        .unwrap();
    let (window, shell) = open_shell(cx, app.app(), Preferences::default());
    click(cx, window, Page::MediaList as usize);
    let shown = |cx: &mut TestAppContext| {
        cx.update(|cx| {
            let media = &shell.read(cx).media;
            let name = media.item(link.id).map(|item| item.name.clone());
            let text = match media.previews.get(&link.id) {
                Some(MediaPreview::Text(text)) => Some(text.clone()),
                _ => None,
            };
            (name, text)
        })
    };
    wait_until(cx, |cx| {
        cx.update(|cx| shell.read(cx).media.previews.contains_key(&link.id))
    });
    // Until then, the link shows as its address.
    let address = "https://example.com/cells".to_owned();
    assert_eq!(shown(cx), (Some(address.clone()), Some(address)));

    let fetched = Fetched::sniffed(
        "Cells.txt".into(),
        b"Mitochondria make ATP.".to_vec(),
        "https://example.com/cells".into(),
    );
    app.database().store_fetched(link.id, &fetched).unwrap();
    cx.update(|cx| shell.update(cx, |shell, cx| shell.load_media(cx)));
    wait_until(cx, |cx| shown(cx).0.as_deref() == Some("Cells.txt"));
    assert_eq!(
        shown(cx),
        (
            Some("Cells.txt".to_owned()),
            Some("Mitochondria make ATP.".to_owned())
        )
    );
}

/// Renaming a project changes nothing a preview shows, so its files keep the previews
/// already on screen; a picture made again would take its file away under the window.
#[gpui_kit::test]
fn a_renamed_projects_files_keep_their_previews(cx: &mut TestAppContext) {
    let app = TempApp::new();
    let project = app.create_project("Biology").unwrap();
    let path = app.dir().join("cell.png");
    image::RgbaImage::from_pixel(4, 4, image::Rgba([20, 40, 60, 255]))
        .save(&path)
        .unwrap();
    let id = app.import_file(&path, Some(project.id)).unwrap().id;
    let (window, shell) = open_shell(cx, app.app(), Preferences::default());
    click(cx, window, Page::MediaList as usize);
    let picture = |cx: &mut TestAppContext| {
        cx.update(|cx| match shell.read(cx).media.previews.get(&id) {
            Some(MediaPreview::Image { path, .. }) => Some(path.clone()),
            _ => None,
        })
    };
    wait_until(cx, |cx| picture(cx).is_some());
    let shown = picture(cx);

    assert!(app.rename_project(project.id, "Cell biology").unwrap());
    cx.update(|cx| shell.update(cx, |shell, cx| shell.load_media(cx)));
    wait_until(cx, |cx| {
        cx.update(|cx| {
            let item = shell.read(cx).media.item(id).cloned();
            item.and_then(|item| item.project_name).as_deref() == Some("Cell biology")
        })
    });
    assert_eq!(picture(cx), shown);
}
