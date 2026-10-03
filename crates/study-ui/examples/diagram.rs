//! A window showing a Mermaid flowchart as a hand-drawn diagram, to see how diagrams
//! look: `cargo run -p study-ui --example diagram -- [chart.mmd] [light]`. Without a file
//! it shows a built-in one; anything the parser leaves out is printed.

use gpui_kit::component::{ActiveTheme as _, ThemeMode};
use gpui_kit::{
    AppContext as _, Context, IntoElement, ParentElement as _, Render, Styled as _, Window,
    WindowOptions, div,
};
use study_diagram::{Diagram, mermaid};
use study_ui::DiagramView;

const SAMPLE: &str = r#"flowchart TD
    cycle(["Cell cycle<br>How one cell becomes two [1]"])
    inter["Interphase<br>About 90% of the cycle<br>The cell grows and copies its DNA [2]"]
    mitosis["Mitosis<br>The nucleus divides<br>Four phases [3]"]
    g1["G1<br>Cell grows<br>Makes proteins and organelles"]
    s["S phase<br>DNA is replicated<br>46 chromosomes become 92 chromatids [2]"]
    g2["G2<br>Checks the copied DNA<br>Gets ready to divide"]
    pro["Prophase<br>Chromosomes condense<br>Spindle starts to form"]
    meta["Metaphase<br>Chromosomes line up at the middle"]
    ana["Anaphase<br>Sister chromatids pulled apart [3]"]
    telo["Telophase<br>Two nuclei form"]
    ok{"Divided correctly?"}
    done(("Two daughter cells"))
    cycle --> inter
    cycle --> mitosis
    inter --> g1 --> s --> g2
    g2 -.->|then| mitosis
    mitosis --> pro --> meta
    meta -->|spindle pulls| ana --> telo
    telo --> ok
    ok ==>|yes| done
"#;

struct Example {
    diagram: Diagram,
}

impl Render for Example {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .bg(cx.theme().background)
            .child(DiagramView::new(self.diagram.clone()))
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mode = if args.iter().any(|arg| arg == "light") {
        ThemeMode::Light
    } else {
        ThemeMode::Dark
    };
    let source = match args.iter().find(|arg| *arg != "light") {
        Some(path) => std::fs::read_to_string(path).expect("failed to read the flowchart"),
        None => SAMPLE.to_owned(),
    };
    let parsed = mermaid::parse(&source);
    if let Some(feedback) = parsed.feedback() {
        #[allow(clippy::print_stderr)]
        {
            eprintln!("{feedback}");
        }
    }
    let diagram = parsed.diagram;
    gpui_kit::application().run(move |cx| {
        gpui_kit::init(cx);
        study_ui::configure_theme(cx, mode);
        gpui_kit::open_window(WindowOptions::default(), cx, |_, cx| {
            cx.new(|_| Example { diagram })
        })
        .expect("failed to open window");
    });
}
