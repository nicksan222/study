//! Study's icons, drawn at one optical weight across navigation, menus and editor controls.
//! Study's own drawings live in `assets/icons/`; any icon not listed here falls back to
//! GPUI Kit's stock set.
//!
//! To add a drawing: put the Lucide SVG in `assets/icons/`, named as Lucide names it, and add
//! its arm below in alphabetical order. The `every_drawing_is_mapped` test fails on an SVG
//! without an arm.

use gpui_kit::{assets::IconName, component::Icon};

/// An icon in Study's own drawing where one exists, else the stock one.
pub fn icon(name: IconName) -> Icon {
    let bytes: &[u8] = match name {
        IconName::ArrowLeft => include_bytes!("../assets/icons/arrow-left.svg"),
        IconName::ArrowRight => include_bytes!("../assets/icons/arrow-right.svg"),
        IconName::ArrowUp => include_bytes!("../assets/icons/arrow-up.svg"),
        IconName::BookOpen => include_bytes!("../assets/icons/book-open.svg"),
        IconName::Check => include_bytes!("../assets/icons/check.svg"),
        IconName::ChevronDown => include_bytes!("../assets/icons/chevron-down.svg"),
        IconName::ChevronRight => include_bytes!("../assets/icons/chevron-right.svg"),
        IconName::CircleQuestionMark => include_bytes!("../assets/icons/circle-question-mark.svg"),
        IconName::FileText => include_bytes!("../assets/icons/file-text.svg"),
        IconName::Folder => include_bytes!("../assets/icons/folder.svg"),
        IconName::FolderOpen => include_bytes!("../assets/icons/folder-open.svg"),
        IconName::Globe => include_bytes!("../assets/icons/globe.svg"),
        IconName::GraduationCap => include_bytes!("../assets/icons/graduation-cap.svg"),
        IconName::House => include_bytes!("../assets/icons/house.svg"),
        IconName::Images => include_bytes!("../assets/icons/images.svg"),
        IconName::Languages => include_bytes!("../assets/icons/languages.svg"),
        IconName::LibraryBig => include_bytes!("../assets/icons/library-big.svg"),
        IconName::ListChecks => include_bytes!("../assets/icons/list-checks.svg"),
        IconName::Maximize => include_bytes!("../assets/icons/maximize.svg"),
        IconName::Minus => include_bytes!("../assets/icons/minus.svg"),
        IconName::NotebookText => include_bytes!("../assets/icons/notebook-text.svg"),
        IconName::Moon => include_bytes!("../assets/icons/moon.svg"),
        IconName::Palette => include_bytes!("../assets/icons/palette.svg"),
        IconName::PanelLeft => include_bytes!("../assets/icons/panel-left.svg"),
        IconName::Play => include_bytes!("../assets/icons/play.svg"),
        IconName::Plus => include_bytes!("../assets/icons/plus.svg"),
        IconName::Reply => include_bytes!("../assets/icons/reply.svg"),
        IconName::Settings => include_bytes!("../assets/icons/settings.svg"),
        IconName::Shapes => include_bytes!("../assets/icons/shapes.svg"),
        IconName::Square => include_bytes!("../assets/icons/square.svg"),
        IconName::SquarePen => include_bytes!("../assets/icons/square-pen.svg"),
        IconName::Sun => include_bytes!("../assets/icons/sun.svg"),
        IconName::Video => include_bytes!("../assets/icons/video.svg"),
        IconName::WandSparkles => include_bytes!("../assets/icons/wand-sparkles.svg"),
        IconName::Workflow => include_bytes!("../assets/icons/workflow.svg"),
        IconName::X => include_bytes!("../assets/icons/x.svg"),
        IconName::ZoomIn => include_bytes!("../assets/icons/zoom-in.svg"),
        IconName::ZoomOut => include_bytes!("../assets/icons/zoom-out.svg"),
        _ => return Icon::new(name),
    };
    Icon::default().data(bytes)
}

#[cfg(test)]
mod tests {
    #[test]
    fn every_drawing_is_mapped() {
        let source = include_str!("icon.rs");
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("assets/icons");
        for entry in std::fs::read_dir(dir).expect("assets/icons is readable") {
            let name = entry.expect("icon entry").file_name();
            let name = name.to_string_lossy();
            if name.ends_with(".svg") {
                let path = format!("\"../assets/icons/{name}\"");
                assert!(source.contains(&path), "{name} has no arm in icon.rs");
            }
        }
    }
}
