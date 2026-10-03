//! The project tree in a real window: sessions open, the folder's action stays apart from
//! the folder and shows only while the row is hovered, focused or open, and folding hides
//! and restores the sessions.

use gpui_kit::component::button::Button;
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::{
    AnyWindowHandle, AppContext as _, Bounds, Context, Entity, IntoElement, Point, Render,
    TestAppContext, Window, WindowBounds, WindowOptions, div, prelude::*, px, size,
};
use study_ui::{ProjectGroup, SessionRow};

const GROUP: usize = 1;
const NEW_SESSION: usize = 2;
const SESSION: usize = 3;
const BUSY_SESSION: usize = 4;

/// One project with two sessions, the second one disabled; the group folds on its own clicks.
#[derive(Default)]
struct TreeHarness {
    folded: bool,
    /// Whether the open session is one of the project's.
    active: bool,
    toggles: usize,
    new_sessions: usize,
    opened: usize,
}

impl Render for TreeHarness {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div().w(px(280.)).child(
            ProjectGroup::new(GROUP, "Biology")
                .count(2)
                .expanded(!self.folded)
                .active(self.active)
                .on_toggle(cx.listener(|this, _, _, cx| {
                    this.folded = !this.folded;
                    this.toggles += 1;
                    cx.notify();
                }))
                .action(
                    Button::new(NEW_SESSION)
                        .label("New")
                        .on_click(cx.listener(|this, _, _, _| this.new_sessions += 1)),
                )
                .row(
                    SessionRow::new(SESSION, "Cells")
                        .age("2m")
                        .on_click(cx.listener(|this, _, _, _| this.opened += 1)),
                )
                .row(
                    SessionRow::new(BUSY_SESSION, "Mitosis")
                        .disabled(true)
                        .on_click(cx.listener(|this, _, _, _| this.opened += 1)),
                ),
        )
    }
}

fn open_harness(cx: &mut TestAppContext) -> (AnyWindowHandle, Entity<TreeHarness>) {
    cx.update(gpui_kit::init);
    cx.update(|cx| {
        cx.set_reduce_motion(true);
        let bounds = Bounds {
            origin: Point::default(),
            size: size(px(320.), px(240.)),
        };
        gpui_kit::open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                ..Default::default()
            },
            cx,
            |_, cx| cx.new(|_| TreeHarness::default()),
        )
        .expect("open tree test window")
    })
}

#[gpui_kit::test]
fn sessions_open_and_the_action_stays_apart_from_the_folder(cx: &mut TestAppContext) {
    let (window, harness) = open_harness(cx);

    cx.update_window(window, |_, window, cx| {
        window.render_frame(cx);
        window.click(SESSION, cx);
        window.click(BUSY_SESSION, cx);
        window.hover(GROUP, cx);
        window.render_frame(cx);
        window.click(NEW_SESSION, cx);
    })
    .unwrap();
    cx.update(|cx| {
        let harness = harness.read(cx);
        assert_eq!(harness.opened, 1, "a disabled session does not open");
        assert_eq!(harness.new_sessions, 1);
        assert_eq!(harness.toggles, 0, "the action does not fold the group");
    });
}

#[gpui_kit::test]
fn the_name_takes_the_whole_row_and_the_action_stays_in_reach(cx: &mut TestAppContext) {
    let (window, harness) = open_harness(cx);
    for active in [false, true] {
        cx.update(|cx| {
            harness.update(cx, |harness, cx| {
                harness.active = active;
                cx.notify();
            })
        });
        cx.run_until_parked();
        cx.update_window(window, |_, window, cx| {
            window.render_frame(cx);
            // The action lies over the end of the row rather than taking width from the
            // name, whether it shows or not.
            let row = window.find(GROUP).bounds();
            let action = window.find(NEW_SESSION).bounds();
            assert_eq!(row.size.width, px(280.), "active: {active}");
            assert!(row.contains(&action.center()), "active: {active}");
        })
        .unwrap();
    }

    // From the keyboard, Tab reaches the folder and then its action.
    cx.update_window(window, |_, window, cx| {
        window.blur(cx);
        window.focus_next(cx);
        window.render_frame(cx);
        assert_eq!(window.find(GROUP).focused(), Some(true));
        window.focus_next(cx);
        window.render_frame(cx);
        assert_eq!(window.find(NEW_SESSION).focused(), Some(true));
        window.press("enter", cx);
    })
    .unwrap();
    assert_eq!(cx.update(|cx| harness.read(cx).new_sessions), 1);
}

#[gpui_kit::test]
fn folding_hides_the_sessions_and_unfolding_brings_them_back(cx: &mut TestAppContext) {
    let (window, harness) = open_harness(cx);

    for expect_shown in [false, true] {
        cx.update_window(window, |_, window, cx| {
            window.render_frame(cx);
            window.click(GROUP, cx);
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(window, |_, window, cx| {
            window.render_frame(cx);
            assert_eq!(window.try_find(SESSION).is_some(), expect_shown);
        })
        .unwrap();
    }
    assert_eq!(cx.update(|cx| harness.read(cx).toggles), 2);
}
