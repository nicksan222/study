//! The shell, end to end: the pages and settings sections in order, the history, the
//! sidebar and the zoom.

use super::*;
use gpui_kit::component::Theme;
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::{AnyWindowHandle, AppContext as _, Pixels, TestAppContext, px};
use testing::{click, find, open_shell};

/// Names each page's successor in declaration order. Exhaustive, so a new page does not
/// compile until it is placed here, and the test then fails until it is in `ALL`.
fn next_page(page: Page) -> Option<Page> {
    match page {
        Page::Home => Some(Page::MediaList),
        Page::MediaList => Some(Page::Projects),
        Page::Projects => Some(Page::Settings),
        Page::Settings => Some(Page::Help),
        Page::Help => Some(Page::Pipelines),
        Page::Pipelines => Some(Page::Flashcards),
        Page::Flashcards => Some(Page::Diagrams),
        Page::Diagrams => Some(Page::Practice),
        Page::Practice => None,
    }
}

#[test]
fn every_page_is_listed_in_order_and_on_the_rail() {
    let declared: Vec<Page> =
        std::iter::successors(Some(Page::default()), |&page| next_page(page)).collect();
    assert_eq!(declared, Page::ALL);
    for (index, page) in Page::ALL.into_iter().enumerate() {
        assert_eq!(page as usize, index);
        assert_eq!(
            Page::RAIL.iter().filter(|&&p| p == page).count(),
            1,
            "{page:?}"
        );
        assert!(
            !page.sidebar_open_at_start() || page.has_sidebar(),
            "{page:?}"
        );
        if let Some(kind) = page.material() {
            assert_eq!(Page::of_material(kind), page);
        }
    }
    // Every kind of material has its page.
    for kind in ArtifactKind::ALL {
        assert_eq!(Page::of_material(*kind).material(), Some(*kind));
    }
    // The rail lists its primary pages first, then the utility ones.
    assert!(Page::RAIL.is_sorted_by_key(|page| page.is_utility()));
}

fn next_section(section: SettingsSection) -> Option<SettingsSection> {
    match section {
        SettingsSection::Language => Some(SettingsSection::Appearance),
        SettingsSection::Appearance => Some(SettingsSection::Updates),
        SettingsSection::Updates => Some(SettingsSection::Processing),
        SettingsSection::Processing => Some(SettingsSection::Ai),
        SettingsSection::Ai => Some(SettingsSection::Llm),
        SettingsSection::Llm => Some(SettingsSection::Transcription),
        SettingsSection::Transcription => Some(SettingsSection::System),
        SettingsSection::System => None,
    }
}

#[test]
fn every_settings_section_is_listed_in_order() {
    let declared: Vec<SettingsSection> =
        std::iter::successors(Some(SettingsSection::default()), |&section| {
            next_section(section)
        })
        .collect();
    assert_eq!(declared, SettingsSection::ALL);
    for (index, section) in SettingsSection::ALL.into_iter().enumerate() {
        assert_eq!(section as usize, index);
    }
}

#[gpui_kit::test]
fn back_and_forward_walk_the_history_and_a_new_page_drops_forward(cx: &mut TestAppContext) {
    let temp = crate::testing::TempApp::new();
    let (window, shell) = open_shell(cx, temp.app(), Preferences::default());
    let place = |cx: &mut TestAppContext| {
        cx.update(|cx| {
            let shell = shell.read(cx);
            (shell.active, shell.history.clone(), shell.forward.clone())
        })
    };

    click(cx, window, Page::Help as usize);
    // Opening the page already on screen is not a step of the history.
    click(cx, window, Page::Help as usize);
    click(cx, window, Page::Settings as usize);
    assert_eq!(
        place(cx),
        (Page::Settings, vec![Page::Home, Page::Help], vec![])
    );

    click(cx, window, shell_ids::BACK);
    click(cx, window, shell_ids::BACK);
    assert_eq!(
        place(cx),
        (Page::Home, vec![], vec![Page::Settings, Page::Help])
    );

    click(cx, window, shell_ids::FORWARD);
    assert_eq!(
        place(cx),
        (Page::Help, vec![Page::Home], vec![Page::Settings])
    );

    // Going somewhere new forgets where Back had been.
    click(cx, window, Page::Home as usize);
    assert_eq!(
        place(cx),
        (Page::Home, vec![Page::Home, Page::Help], vec![])
    );
}

#[gpui_kit::test]
fn the_sidebar_holds_every_destination_and_hides_whole(cx: &mut TestAppContext) {
    let temp = crate::testing::TempApp::new();
    let (window, shell) = open_shell(cx, temp.app(), Preferences::default());
    let visible = |cx: &mut TestAppContext| cx.update(|cx| shell.read(cx).sidebar_visible());

    // Home has no list of its own, and its sidebar still lists every destination.
    for page in Page::RAIL {
        assert!(find(cx, window, page as usize).is_some(), "{page:?}");
    }
    assert!(visible(cx));
    click(cx, window, shell_ids::TOGGLE_SIDEBAR);
    assert!(!visible(cx));
    assert!(find(cx, window, Page::Projects as usize).is_none());
    click(cx, window, shell_ids::TOGGLE_SIDEBAR);
    assert!(visible(cx));

    // The Library's own list starts hidden under the destinations; the toggle shows the
    // sidebar whole, then hides it whole.
    click(cx, window, Page::MediaList as usize);
    assert!(!visible(cx));
    assert!(find(cx, window, Page::Home as usize).is_some());
    click(cx, window, shell_ids::TOGGLE_SIDEBAR);
    assert!(visible(cx));
    click(cx, window, shell_ids::TOGGLE_SIDEBAR);
    assert!(!visible(cx));
    assert!(find(cx, window, Page::Home as usize).is_none());
    // Hidden, it stays hidden on the next page too.
    click(cx, window, shell_ids::BACK);
    assert_eq!(cx.update(|cx| shell.read(cx).active), Page::Home);
    assert!(find(cx, window, Page::Projects as usize).is_none());
}

/// Presses the platform's zoom shortcut with `key`.
fn press_zoom_key(cx: &mut TestAppContext, window: AnyWindowHandle, key: &str) {
    cx.update_window(window, |_, window, cx| {
        window.press(&format!("secondary-{key}"), cx)
    })
    .unwrap();
}

/// The theme's font size after drawing a frame.
fn font_size(cx: &mut TestAppContext, window: AnyWindowHandle) -> Pixels {
    cx.update_window(window, |_, window, cx| {
        window.render_frame(cx);
        Theme::global(cx).font_size
    })
    .unwrap()
}

#[gpui_kit::test]
fn keyboard_zoom_shortcuts_work_through_shell_capture(cx: &mut TestAppContext) {
    let temp = crate::testing::TempApp::new();
    let (window, _shell) = open_shell(cx, temp.app(), Preferences::default());
    assert_eq!(font_size(cx, window), px(15.));

    press_zoom_key(cx, window, "=");
    assert_eq!(font_size(cx, window), px(16.5));

    press_zoom_key(cx, window, "0");
    assert_eq!(font_size(cx, window), px(15.));
}

#[gpui_kit::test]
fn the_view_menus_zoom_actions_zoom_and_save(cx: &mut TestAppContext) {
    let temp = crate::testing::TempApp::new();
    let (window, shell) = open_shell(cx, temp.app(), Preferences::default());
    let dispatch = |cx: &mut TestAppContext, action: &dyn gpui_kit::Action| {
        cx.update_window(window, |_, window, cx| {
            window.dispatch_action(action.boxed_clone(), cx)
        })
        .unwrap();
        cx.run_until_parked();
    };

    dispatch(cx, &desktop::ZoomIn);
    assert_eq!(font_size(cx, window), px(16.5));
    assert_eq!(cx.update(|cx| shell.read(cx).preferences.zoom_percent), 110);
    dispatch(cx, &desktop::ZoomOut);
    dispatch(cx, &desktop::ZoomOut);
    assert!(font_size(cx, window) < px(15.));
    dispatch(cx, &desktop::ResetZoom);
    assert_eq!(font_size(cx, window), px(15.));
}
