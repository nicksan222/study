//! The showcase's diagrams are the ones the GIF shows, so they must read as trees: each parses
//! without feedback, has a sensible size, and some box branches three ways.

use study_core::{ArtifactBody, ArtifactKind, db::Database};
use study_diagram::mermaid::parse;

#[test]
fn seeded_diagrams_parse_and_branch() -> study_core::Result<()> {
    let (_dir, db) = Database::temporary()?;
    assert!(study_seed::showcase(&db)?);
    let mut seen = 0;
    for project in db.list_projects()? {
        for piece in db.list_material(project.id)? {
            let Some(current) = piece.current else {
                continue;
            };
            if current.kind != ArtifactKind::Diagram {
                continue;
            }
            let Some(ArtifactBody::Diagram { mermaid }) = current.body else {
                panic!("{}: a diagram without a body", project.name);
            };
            seen += 1;
            let parsed = parse(&mermaid);
            assert_eq!(parsed.feedback(), None, "{}", project.name);
            let diagram = &parsed.diagram;
            let nodes = diagram.nodes().len();
            assert!((9..=14).contains(&nodes), "{}: {nodes} nodes", project.name);
            let widest = (0..nodes)
                .map(|node| diagram.edges().iter().filter(|e| e.from == node).count())
                .max()
                .unwrap_or(0);
            assert!(widest >= 3, "{}: widest {widest}", project.name);
        }
    }
    assert_eq!(seen, 5, "one diagram per course");
    Ok(())
}
