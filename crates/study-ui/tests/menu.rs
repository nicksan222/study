//! Menu rows in a real window: the row and its trailing action click apart, a disabled row
//! blocks both, and a narrow row keeps its action inside.

use gpui_kit::component::button::Button;
use gpui_kit::test::{TestSupportExt as _, TestWindowExt as _};
use gpui_kit::{
    AppContext as _, Bounds, Context, Entity, Point, Render, TestAppContext, Window, WindowBounds,
    WindowOptions, div, prelude::*, px, size,
};
use study_ui::{MenuItem, RoundedClip};

#[derive(Default)]
struct MenuHarness {
    row_clicks: usize,
    action_clicks: usize,
    disabled: bool,
}

impl Render for MenuHarness {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let action = Button::new(2)
            .label("More")
            .on_click(cx.listener(|this, _, _, _| this.action_clicks += 1));

        // Inside a clip, so the tests also show its corner overlay never takes the clicks.
        RoundedClip::new(
            px(14.),
            gpui_kit::rgb(0x282a39).into(),
            div().size_full().child(
                MenuItem::new(1, "Account")
                    .description("Manage profile and sign-in preferences")
                    .disabled(self.disabled)
                    .action(action)
                    .on_click(cx.listener(|this, _, _, _| this.row_clicks += 1)),
            ),
        )
    }
}

fn open_harness(
    cx: &mut TestAppContext,
    width: f32,
    disabled: bool,
) -> (gpui_kit::AnyWindowHandle, Entity<MenuHarness>) {
    cx.update(gpui_kit::init);
    cx.update(|cx| {
        let bounds = Bounds {
            origin: Point::default(),
            size: size(px(width), px(180.)),
        };
        let (window, content) = gpui_kit::open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                ..Default::default()
            },
            cx,
            |_, cx| {
                cx.new(|_| MenuHarness {
                    disabled,
                    ..Default::default()
                })
            },
        )
        .expect("open menu test window");
        (window, content)
    })
}

#[gpui_kit::test]
fn row_and_trailing_action_callbacks_are_isolated(cx: &mut TestAppContext) {
    let (window, harness) = open_harness(cx, 320., false);

    cx.update_window(window, |_, window, cx| {
        window.render_frame(cx);
        window.click(2, cx);
    })
    .unwrap();
    cx.update(|cx| {
        let harness = harness.read(cx);
        assert_eq!(harness.action_clicks, 1);
        assert_eq!(harness.row_clicks, 0);
    });

    cx.update_window(window, |_, window, cx| window.click(1, cx))
        .unwrap();
    cx.update(|cx| {
        let harness = harness.read(cx);
        assert_eq!(harness.action_clicks, 1);
        assert_eq!(harness.row_clicks, 1);
    });
}

#[gpui_kit::test]
fn disabled_row_blocks_primary_and_trailing_actions(cx: &mut TestAppContext) {
    let (window, harness) = open_harness(cx, 320., true);

    cx.update_window(window, |_, window, cx| {
        window.render_frame(cx);
        window.click(1, cx);
        window.click(2, cx);
    })
    .unwrap();
    cx.update(|cx| {
        let harness = harness.read(cx);
        assert_eq!(harness.row_clicks, 0);
        assert_eq!(harness.action_clicks, 0);
    });
}

struct NarrowHarness;

impl Render for NarrowHarness {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().id(30).test_support().w(px(200.)).child(
            MenuItem::new(31, "A long menu item label")
                .description("A description that wraps rather than forcing the action outside.")
                .action(Button::new(32).label("More")),
        )
    }
}

#[gpui_kit::test]
fn narrow_row_keeps_action_inside_parent(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let (window, _) = cx.update(|cx| {
        let (window, content) = gpui_kit::open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds {
                    origin: Point::default(),
                    size: size(px(220.), px(180.)),
                })),
                ..Default::default()
            },
            cx,
            |_, cx| cx.new(|_| NarrowHarness),
        )
        .expect("open narrow menu test window");
        (window, content)
    });

    cx.update_window(window, |_, window, cx| {
        window.render_frame(cx);
        let parent = window.find(30).bounds();
        let row = window.find(31).bounds();
        let action = window.find(32).bounds();
        assert!(row.left() >= parent.left());
        assert!(action.right() <= parent.right());
        assert!(action.left() >= parent.left());
        assert!(row.size.height >= px(56.));
    })
    .unwrap();
}
