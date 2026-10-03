//! Page layout in a real window: the gallery fills the page column it is given, and a
//! content page places its header and footer actions.

use gpui_kit::component::button::Button;
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::{
    AppContext as _, Bounds, Context, Render, TestAppContext, Window, WindowBounds, WindowOptions,
    prelude::*, px, size,
};
use study_ui::{ContentPage, Gallery};

struct LibraryHarness;

impl Render for LibraryHarness {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let mut gallery = Gallery::new(90);
        for id in 10..22 {
            gallery = gallery.item(Button::new(id).label("File").w_full().h(px(150.)));
        }
        ContentPage::new("Media", "Saved files")
            .workspace()
            .action(Button::new(1).label("Upload media"))
            .item(gallery)
    }
}

#[gpui_kit::test]
fn gallery_fills_the_page_column_and_keeps_header_action_compact(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    cx.update(|cx| study_ui::configure_theme(cx, gpui_kit::component::ThemeMode::Dark));
    for width in [720., 1500.] {
        let (window, _) = cx.update(|cx| {
            gpui_kit::open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(Bounds {
                        origin: Default::default(),
                        size: size(px(width), px(800.)),
                    })),
                    ..Default::default()
                },
                cx,
                |_, cx| cx.new(|_| LibraryHarness),
            )
            .unwrap()
        });
        // The first frame measures the actual content width; the next lays out the columns.
        cx.update_window(window, |_, window, cx| {
            window.render_frame(cx);
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(window, |_, window, cx| {
            window.render_frame(cx);
            let action = window.find(1).bounds();
            assert!(action.size.width < px(200.));
            assert!(action.right() > px(width - 40.));
            // The page column: the width less two 28-pixel gutters, at most the page width,
            // centred; in it, 220-pixel columns 16 apart.
            let column = (width - 56.).min(study_ui::scale::COLUMN_PAGE);
            let left = (width - column) / 2.;
            let columns = ((column + 16.) / 236.).floor() as usize;
            let first = window.find(10).bounds();
            let last = window.find(10 + columns - 1).bounds();
            assert_eq!(first.top(), last.top());
            assert!(first.left() < px(left + 12.));
            assert!(last.right() > px(left + column - 12.));
            assert!(window.find(10 + columns).bounds().top() > first.top());
        })
        .unwrap();
    }
}

struct StandardPageHarness;

impl Render for StandardPageHarness {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        ContentPage::new("Settings", "Preferences")
            .action(Button::new(101).label("Reset"))
            .footer_action(Button::new(102).label("Save"))
            .empty("No preferences")
    }
}

#[gpui_kit::test]
fn standard_page_renders_configured_actions(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let (window, _) = cx.update(|cx| {
        gpui_kit::open_window(WindowOptions::default(), cx, |_, cx| {
            cx.new(|_| StandardPageHarness)
        })
        .unwrap()
    });
    cx.update_window(window, |_, window, cx| {
        window.render_frame(cx);
        let header = window.find(101).bounds();
        let footer = window.find(102).bounds();
        assert!(header.top() < footer.top());
    })
    .unwrap();
}
