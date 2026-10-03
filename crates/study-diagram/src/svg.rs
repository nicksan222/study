//! [`svg`]: a [`Scene`] as an SVG image, to save or share outside Study. The strokes keep
//! their hand-drawn paths, and the text is written in Excalidraw's handwriting where the
//! viewer has it, else a hand-lettered font it has.

use std::fmt::Write as _;

use crate::scene::Scene;
use crate::sketch::{Op, Paint, Palette};

/// The handwriting the text asks for, best first.
const FONT_FAMILY: &str = "Excalifont, Virgil, 'Segoe Print', 'Comic Sans MS', cursive";

/// `scene` as a standalone SVG document in `palette`, whose colours are `0xRRGGBB`.
pub fn svg(scene: &Scene, palette: Palette<'_, u32>) -> String {
    let colour = |rgb: u32| format!("#{rgb:06x}");
    let (width, height) = (scene.width.ceil(), scene.height.ceil());
    let mut out = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{width}\" height=\"{height}\" \
         viewBox=\"0 0 {width} {height}\">\n<rect width=\"100%\" height=\"100%\" fill=\"{}\"/>\n",
        colour(palette.paper)
    );
    for stroke in &scene.strokes {
        let mut path = String::new();
        for op in &stroke.path {
            let _ = match *op {
                Op::Move((x, y)) => write!(path, "M{x:.2} {y:.2}"),
                Op::Line((x, y)) => write!(path, "L{x:.2} {y:.2}"),
                Op::Curve { a, b, to } => write!(
                    path,
                    "C{:.2} {:.2} {:.2} {:.2} {:.2} {:.2}",
                    a.0, a.1, b.0, b.1, to.0, to.1
                ),
            };
        }
        let ink = palette.colour(stroke.ink);
        let _ = match stroke.paint {
            Paint::Stroke { width, dash } => {
                let dashes = dash.map_or(String::new(), |dash| {
                    format!(" stroke-dasharray=\"{:.2} {:.2}\"", dash.on, dash.off)
                });
                writeln!(
                    out,
                    "<path d=\"{path}\" fill=\"none\" stroke=\"{}\" stroke-width=\"{width:.2}\" \
                     stroke-linecap=\"round\" stroke-linejoin=\"round\"{dashes}/>",
                    colour(ink)
                )
            }
            Paint::Fill => writeln!(
                out,
                "<path d=\"{path}\" fill=\"{}\" fill-rule=\"nonzero\"/>",
                colour(ink)
            ),
        };
    }
    for text in &scene.texts {
        let (x, y) = text.origin;
        let size = scene.metrics.size(text.style);
        let line_height = scene.metrics.line_height(text.style);
        let _ = writeln!(
            out,
            "<text x=\"{x:.2}\" y=\"{:.2}\" font-family=\"{FONT_FAMILY}\" font-size=\"{size:.2}\" \
             dominant-baseline=\"central\" fill=\"{}\">{}</text>",
            y + line_height / 2.,
            colour(palette.ink),
            escape(&text.text)
        );
    }
    out.push_str("</svg>\n");
    out
}

/// `text` safe inside an SVG element.
fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Metrics, mermaid, scene};

    #[test]
    fn a_scene_becomes_an_svg_with_its_shapes_and_words() {
        let diagram =
            mermaid::parse("flowchart LR\n  a[\"Cells & ATP\"] -.->|makes| b((Energy))").diagram;
        let scene = scene(&diagram, Metrics::for_font_size(20.), |text, _| {
            text.len() as f32 * 10.
        });
        let image = svg(
            &scene,
            Palette {
                ink: 0x1e1e1e,
                paper: 0xffffff,
                tones: &[0xa5d8ff],
            },
        );
        assert!(image.starts_with("<svg xmlns=\"http://www.w3.org/2000/svg\""));
        assert!(image.trim_end().ends_with("</svg>"));
        assert!(image.contains(">Cells &amp; ATP</text>"), "{image}");
        assert!(image.contains(">makes</text>"));
        assert!(image.contains("fill=\"#a5d8ff\""));
        assert!(
            image.contains("stroke-dasharray"),
            "the dotted arrow stays dotted"
        );
        assert_eq!(
            image.matches("<text").count(),
            scene.texts.len(),
            "every line of text"
        );
    }
}
