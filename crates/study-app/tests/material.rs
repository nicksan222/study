//! Study material end to end: artifact jobs against a mock chat API, reviewing the
//! flashcards they make, and diagrams drawn from a whole project.

mod common;

use common::{Fixture, eventually};
use study_app::views::{
    ArtifactBody, ArtifactKind, ArtifactStatus, Flashcard, JobKind, JobStatus, Rating,
};

/// Words from the flashcard writer's instructions, which tell its requests apart.
const CARDS: &str = "You write flashcards";
const DIAGRAM: &str = "You draw diagrams";

#[tokio::test(flavor = "multi_thread")]
async fn flashcards_from_a_project_are_written_citing_it_and_can_be_reviewed()
-> study_core::Result<()> {
    let fixture = Fixture::start().await?;
    fixture
        .answer(
            CARDS,
            "```json\n{\"cards\": [{\"front\": \"What powers the cell?\", \"back\": \
\"Mitochondria\", \"cites\": [1]}, {\"front\": \"Protein builders?\", \"back\": \
\"Ribosomes\", \"cites\": [9]}]}\n```",
        )
        .await;
    fixture
        .import(
            "cells.txt",
            "mitochondria power the cell\nribosomes build proteins",
        )
        .await?;
    let project = fixture.project;
    fixture
        .blocking(move |app| {
            let id = app.update_material(project, ArtifactKind::Flashcards)?;
            eventually(|| {
                Ok(app.artifact(id)?.is_some_and(|artifact| {
                    artifact.job.is_some_and(|job| job.status.is_terminal())
                }))
            })?;
            let artifact = app.artifact(id)?.unwrap();
            assert_eq!(
                artifact.status,
                ArtifactStatus::Complete,
                "{:?}",
                artifact.job
            );
            let Some(ArtifactBody::Flashcards { cards }) = &artifact.body else {
                panic!("flashcards");
            };
            assert_eq!(cards.len(), 2);
            // Only markers that name a passage become citations.
            assert_eq!(artifact.citations.len(), 1);
            assert_eq!(artifact.citations[0].source_name, "cells.txt");

            assert_eq!(app.due_count(Some(project))?, 2);
            let due = app.due_cards(None, 10)?;
            assert_eq!(due[0].artifact_title, "Biology");
            app.review(due[0].card.id, Rating::Easy)?;
            assert_eq!(app.due_count(Some(project))?, 1);
            assert_eq!(app.material(project)?.len(), 1);
            Ok(())
        })
        .await
}

#[tokio::test(flavor = "multi_thread")]
async fn flashcards_wait_for_their_file_to_be_read() -> study_core::Result<()> {
    let fixture = Fixture::start().await?;
    fixture
        .answer(
            CARDS,
            "{\"cards\": [{\"front\": \"What powers the cell?\", \"back\": \
\"Mitochondria power the cell\", \"cites\": [1]}]}",
        )
        .await;
    fixture
        .import("cells.txt", "mitochondria power the cell")
        .await?;
    let project = fixture.project;
    let id = fixture
        .blocking(move |app| app.update_material(project, ArtifactKind::Flashcards))
        .await?;

    let job = fixture.finished(JobKind::Artifact).await?;
    assert_eq!(job.status, JobStatus::Succeeded, "{:?}", job.error);
    let artifact = fixture.app.artifact(id)?.unwrap();
    assert_eq!(
        artifact.body,
        Some(ArtifactBody::Flashcards {
            cards: vec![Flashcard {
                front: "What powers the cell?".into(),
                back: "Mitochondria power the cell".into(),
                cites: vec![1],
            }]
        })
    );
    let prompts = fixture.prompts(CARDS).await;
    assert!(prompts[0].contains("MITOCHONDRIA POWER THE CELL"));
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn a_diagram_is_drawn_from_every_file_asked_again_when_flawed_and_cites_its_cards()
-> study_core::Result<()> {
    let fixture = Fixture::start().await?;
    // The first draft puts its card in a subgraph, which a diagram has no place for.
    fixture
        .answer(
            DIAGRAM,
            "```mermaid\nflowchart TD\nsubgraph Cell\nmito[\"Mitochondria<br>Make ATP [1]\"]\nend\n```",
        )
        .await;
    // Told what was left out, it draws cards with details citing both files.
    fixture
        .answer_when(
            DIAGRAM,
            "needs fixing",
            "flowchart LR\n\
             mito[\"Mitochondria<br>- Power the cell [1]\"] -->|feeds| ribo[\"Ribosomes<br>- Build proteins [2]<br>- Found in every cell\"]\n\
             ribo --> guess[\"A made-up passage [9]\"]",
        )
        .await;
    fixture
        .import("cells.txt", "mitochondria power the cell")
        .await?;
    fixture
        .import("proteins.txt", "ribosomes build proteins")
        .await?;
    let project = fixture.project;
    // No files named: the diagram is drawn from all of the project's.
    let id = fixture
        .blocking(move |app| app.update_material(project, ArtifactKind::Diagram))
        .await?;

    let job = fixture.finished(JobKind::Artifact).await?;
    assert_eq!(job.status, JobStatus::Succeeded, "{:?}", job.error);
    let artifact = fixture.app.artifact(id)?.unwrap();
    assert_eq!(artifact.status, ArtifactStatus::Complete);
    let Some(ArtifactBody::Diagram { mermaid }) = &artifact.body else {
        panic!("a diagram: {:?}", artifact.body);
    };
    // What is stored reads back whole, as the second draft drew it.
    let parsed = study_diagram::mermaid::parse(mermaid);
    assert!(parsed.problems.is_empty(), "{mermaid}");
    let diagram = &parsed.diagram;
    assert_eq!(diagram.direction, study_diagram::Direction::Right);
    let titles: Vec<_> = diagram.nodes().iter().map(|n| n.title.as_str()).collect();
    assert_eq!(titles, ["Mitochondria", "Ribosomes", "A made-up passage"]);
    assert_eq!(
        diagram.nodes()[1].rows,
        ["Build proteins", "Found in every cell"]
    );
    assert_eq!(diagram.edges()[0].label, "feeds");
    // Its cards cite both files; a marker naming no passage cites nothing.
    let mut cited: Vec<_> = artifact
        .citations
        .iter()
        .map(|c| c.source_name.as_str())
        .collect();
    cited.sort_unstable();
    assert_eq!(cited, ["cells.txt", "proteins.txt"]);

    let prompts = fixture.prompts(DIAGRAM).await;
    assert_eq!(
        prompts.len(),
        2,
        "one draft, and one more after the feedback"
    );
    for prompt in &prompts {
        assert!(prompt.contains("MITOCHONDRIA POWER THE CELL"), "{prompt}");
        assert!(prompt.contains("RIBOSOMES BUILD PROTEINS"), "{prompt}");
    }
    assert!(!prompts[0].contains("needs fixing"));
    assert!(prompts[1].contains("subgraph Cell"), "it sees its draft");
    assert!(prompts[1].contains("was left out"), "and what was wrong");
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn updating_twice_keeps_one_piece_over_the_whole_project_and_the_second_revises_the_first()
-> study_core::Result<()> {
    let fixture = Fixture::start().await?;
    fixture
        .answer(
            CARDS,
            "{\"cards\": [{\"front\": \"What powers the cell?\", \"back\": \
\"Mitochondria power the cell\", \"cites\": [1]}]}",
        )
        .await;
    // A file in no session, and a session with a note and a file.
    fixture.import("history.txt", "the roman senate").await?;
    let session = fixture.app.create_session(fixture.project, "Cells")?;
    fixture
        .post(
            session.id,
            "Mitochondria make ATP",
            &[("cells.txt", "mitochondria power the cell")],
        )
        .await?;
    let project = fixture.project;
    let first = fixture
        .blocking(move |app| app.update_material(project, ArtifactKind::Flashcards))
        .await?;
    fixture.finished(JobKind::Artifact).await?;
    let piece = fixture.app.artifact(first)?.unwrap();
    assert_eq!(piece.sources.len(), 2, "every file of the project");
    assert!(piece.notes.contains("Mitochondria make ATP"));
    let changes = fixture
        .blocking(move |app| app.material_changes(first))
        .await?;
    assert!(changes.unwrap().is_none(), "up to date");

    // A note written after makes it outdated; updating rewrites the piece.
    let thoughts = fixture.app.create_session(project, "Thoughts")?;
    fixture
        .post(thoughts.id, "Ask about the Krebs cycle", &[])
        .await?;
    let changes = fixture
        .blocking(move |app| app.material_changes(first))
        .await?;
    assert_eq!(changes.unwrap().notes, 1);
    let second = fixture
        .blocking(move |app| app.update_material(project, ArtifactKind::Flashcards))
        .await?;
    assert_ne!(second, first);
    eventually_complete(&fixture, second).await?;
    let material = fixture.app.material(project)?;
    assert_eq!(material.len(), 1, "one piece, nothing old kept");
    let current = material[0].current.as_ref().expect("the update is current");
    assert_eq!(current.id, second);
    assert!(current.notes.contains("Krebs"));
    assert!(material[0].update.is_none());
    assert!(
        fixture.app.artifact(first)?.is_none(),
        "the old text is gone"
    );
    let prompts = fixture.prompts(CARDS).await;
    assert_eq!(prompts.len(), 2);
    assert!(!prompts[0].contains("<previous_version>"));
    assert!(prompts[1].contains("<previous_version>"), "{}", prompts[1]);
    assert!(prompts[1].contains("Back: Mitochondria power the cell"));

    // Deleting the piece deletes it.
    assert!(
        fixture
            .blocking(move |app| app.delete_material(project, ArtifactKind::Flashcards))
            .await?
    );
    assert!(fixture.app.material(project)?.is_empty());
    Ok(())
}

/// Waits until artifact `id` is finished.
async fn eventually_complete(
    fixture: &Fixture,
    id: study_core::ArtifactId,
) -> study_core::Result<()> {
    fixture
        .blocking(move |app| {
            eventually(|| {
                Ok(app
                    .artifact(id)?
                    .is_some_and(|piece| piece.status == ArtifactStatus::Complete))
            })
        })
        .await
}

#[tokio::test(flavor = "multi_thread")]
async fn notes_alone_are_enough_and_nothing_at_all_is_refused() -> study_core::Result<()> {
    let fixture = Fixture::start().await?;
    let project = fixture.project;
    let refused = fixture
        .blocking(move |app| app.update_material(project, ArtifactKind::Flashcards))
        .await
        .unwrap_err();
    assert_eq!(refused.kind(), study_core::ErrorKind::Unsupported);

    let session = fixture.app.create_session(project, "Thoughts")?;
    fixture
        .post(session.id, "Ask about the Krebs cycle", &[])
        .await?;
    let id = fixture
        .blocking(move |app| app.update_material(project, ArtifactKind::Flashcards))
        .await?;
    let update = fixture.app.artifact(id)?.unwrap();
    assert!(update.sources.is_empty());
    assert!(update.notes.contains("Krebs"));
    // Asked again before it is written, it is the same update.
    let again = fixture
        .blocking(move |app| app.update_material(project, ArtifactKind::Flashcards))
        .await?;
    assert_eq!(again, id);
    Ok(())
}
