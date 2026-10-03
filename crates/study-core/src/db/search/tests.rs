//! Storing passages and embeddings, and finding passages, names and messages.

use super::*;
use crate::Result;
use crate::db::{Database, MessageRole, NewPart, read_nothing};
use crate::{Anchor, Block, BlockKind, Document, DocumentId, DocumentMeta, ProjectId, SourceId};

fn page(page: u32) -> Anchor {
    Anchor::Page { page }
}

fn draft(text: &str, anchor: Anchor) -> ChunkDraft {
    ChunkDraft {
        first_block: 0,
        last_block: 0,
        anchor,
        text: text.into(),
    }
}

/// A source with a stored document.
fn read_source(
    db: &Database,
    dir: &tempfile::TempDir,
    name: &str,
    project: Option<ProjectId>,
) -> Result<(SourceId, DocumentId)> {
    let path = dir.path().join(name);
    std::fs::write(&path, name)?;
    let source = db.import_source(&path, project)?;
    let document = Document {
        blocks: vec![Block {
            kind: BlockKind::Paragraph,
            text: name.into(),
            anchor: page(1),
        }],
        meta: DocumentMeta {
            extractor: Some(crate::processing::ExtractorKind::Text),
            ..DocumentMeta::default()
        },
    };
    Ok((source.id, db.save_document(source.id, &document)?))
}

#[test]
fn passages_are_found_by_keyword_with_their_place_in_the_source() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let project = db.create_project("Biology")?;
    let (source, document) = read_source(&db, &dir, "cells.pdf", Some(project.id))?;
    db.store_chunks(
        document,
        &[
            draft("Mitochondria are the powerhouse of the cell", page(1)),
            draft("Ribosomes build proteins", page(2)),
        ],
    )?;
    let hits = db.passage_hits(&db.keyword_chunks("ribo", 10)?)?;
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].title, "cells.pdf");
    assert_eq!(hits[0].context.as_deref(), Some("Biology"));
    assert_eq!(
        hits[0].target,
        SearchTarget::Source {
            source_id: source,
            anchor: Some(page(2)),
            session_id: None,
        }
    );
    // Operators typed by the user are only words.
    assert!(db.keyword_chunks("\"OR* (", 10)?.is_empty());
    Ok(())
}

#[test]
fn a_passage_of_an_attached_file_leads_to_its_session() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let project = db.create_project("Biology")?;
    let first = db.create_session(project.id, "Cells")?;
    let path = dir.path().join("cells.txt");
    std::fs::write(&path, "cells")?;
    let message = db.post_message(
        first.id,
        MessageRole::User,
        &[NewPart::File(path)],
        &read_nothing,
    )?;
    let source = message.parts[0].content.source_id.expect("the file");
    let document = Document {
        blocks: vec![Block {
            kind: BlockKind::Paragraph,
            text: "Ribosomes build proteins".into(),
            anchor: page(1),
        }],
        meta: DocumentMeta {
            extractor: Some(crate::processing::ExtractorKind::Text),
            ..DocumentMeta::default()
        },
    };
    let document = db.save_document(source, &document)?;
    db.store_chunks(document, &[draft("Ribosomes build proteins", page(1))])?;
    let hits = db.passage_hits(&db.keyword_chunks("ribosomes", 10)?)?;
    assert_eq!(
        hits[0].target,
        SearchTarget::Source {
            source_id: source,
            anchor: Some(page(1)),
            session_id: Some(first.id),
        }
    );
    Ok(())
}

#[test]
fn a_question_draws_on_passages_of_its_project_with_any_of_its_words() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let biology = db.create_project("Biology")?;
    let history = db.create_project("History")?;
    let (cells, document) = read_source(&db, &dir, "cells.pdf", Some(biology.id))?;
    db.store_chunks(
        document,
        &[
            draft("Mitochondria are the powerhouse of the cell", page(1)),
            draft("Ribosomes build proteins", page(2)),
        ],
    )?;
    let (_, other) = read_source(&db, &dir, "rome.pdf", Some(history.id))?;
    db.store_chunks(
        other,
        &[draft("The powerhouse of Rome was its army", page(1))],
    )?;

    let found = db.passages_about("What is the powerhouse of a cell?", biology.id, 10)?;
    let passages = db.passages(&found)?;
    assert_eq!(passages.len(), 1);
    assert_eq!(
        (passages[0].source_id, &passages[0].anchor),
        (cells, &page(1))
    );
    assert!(db.passages_about("a of", biology.id, 10)?.is_empty());
    Ok(())
}

#[test]
fn unchanged_passages_keep_their_embeddings_and_identical_text_shares_one() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let (_, first) = read_source(&db, &dir, "a.pdf", None)?;
    let (_, second) = read_source(&db, &dir, "b.pdf", None)?;
    db.store_chunks(
        first,
        &[draft("shared words", page(1)), draft("only here", page(2))],
    )?;
    db.store_chunks(second, &[draft("shared words", page(1))])?;
    let pending = db.passages_to_embed(first, "model")?;
    assert_eq!(pending.len(), 2);
    let embedded: Vec<_> = pending
        .iter()
        .map(|passage| (passage.content_hash, vec![1.0, 0.0]))
        .collect();
    db.set_embeddings("model", &embedded)?;
    assert!(db.passages_to_embed(second, "model")?.is_empty());
    assert!(db.documents_missing_embeddings("model")?.is_empty());
    assert_eq!(db.documents_missing_embeddings("other")?, [first, second]);

    // Re-chunking with a changed second passage leaves only that one to embed.
    db.store_chunks(
        first,
        &[draft("shared words", page(1)), draft("changed", page(2))],
    )?;
    let pending = db.passages_to_embed(first, "model")?;
    let texts: Vec<_> = pending
        .iter()
        .map(|passage| passage.text.as_str())
        .collect();
    assert_eq!(texts, ["changed"]);
    let mut seen = 0;
    db.for_each_embedding("model", |_, vector| {
        assert_eq!(vector, [1.0, 0.0]);
        seen += 1;
    })?;
    assert_eq!(seen, 2);
    Ok(())
}

#[test]
fn names_and_messages_are_found_too() -> Result<()> {
    let (dir, db) = Database::temporary()?;
    let project = db.create_project("Biologia cellulare")?;
    let session = db.create_session(project.id, "Mitochondria")?;
    db.post_message(
        session.id,
        MessageRole::User,
        &[NewPart::Text("The powerhouse of the cell".into())],
        &read_nothing,
    )?;
    read_source(&db, &dir, "mito-notes.txt", Some(project.id))?;
    let names = db.name_hits("mito", 10)?;
    let kinds: Vec<_> = names.iter().map(|hit| hit.kind).collect();
    assert_eq!(kinds, [SearchKind::Session, SearchKind::Source]);
    assert_eq!(db.name_hits("100%", 10)?, []);
    let messages = db.message_hits("power", 10)?;
    assert_eq!(
        messages[0].excerpt.as_deref(),
        Some("The powerhouse of the cell")
    );
    assert_eq!(messages[0].title, "Mitochondria");
    Ok(())
}
