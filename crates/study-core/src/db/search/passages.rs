//! Passages (`chunks`) and their embeddings: storing a document's passages, embedding each
//! distinct text once per model, and reading passages back.

use super::super::{Database, json_column};
use super::{ChunkDraft, PendingPassage};
use crate::processing::Excerpt;
use crate::{ChunkId, DocumentId, ProjectId};
use crate::{Context as _, Result};
use rusqlite::{OptionalExtension as _, Rows, params};
use sha2::{Digest as _, Sha256};
use std::collections::HashMap;

impl Database {
    /// Makes a document's passages equal `chunks`, keeping unchanged ones as they are.
    pub fn store_chunks(&self, document: DocumentId, chunks: &[ChunkDraft]) -> Result<()> {
        let tx = self.immediate()?;
        let existing: HashMap<i64, Vec<u8>> = tx
            .prepare("SELECT ordinal, content_hash FROM chunks WHERE document_id = ?1")?
            .query_map(params![document], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        for (ordinal, chunk) in chunks.iter().enumerate() {
            let ordinal = ordinal as i64;
            let hash = content_hash(&chunk.text);
            let anchor = serde_json::to_string(&chunk.anchor)?;
            match existing.get(&ordinal) {
                // The same text: only where it sits may have changed; its embedding stays.
                Some(stored) if *stored == hash => tx.execute(
                    "UPDATE chunks SET first_block = ?1, last_block = ?2, anchor = ?3
                     WHERE document_id = ?4 AND ordinal = ?5",
                    params![
                        chunk.first_block,
                        chunk.last_block,
                        anchor,
                        document,
                        ordinal
                    ],
                )?,
                Some(_) => tx.execute(
                    "UPDATE chunks SET first_block = ?1, last_block = ?2, anchor = ?3,
                         text = ?4, content_hash = ?5
                     WHERE document_id = ?6 AND ordinal = ?7",
                    params![
                        chunk.first_block,
                        chunk.last_block,
                        anchor,
                        chunk.text,
                        hash,
                        document,
                        ordinal
                    ],
                )?,
                None => tx.execute(
                    "INSERT INTO chunks (document_id, ordinal, first_block, last_block, anchor,
                         text, content_hash)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        document,
                        ordinal,
                        chunk.first_block,
                        chunk.last_block,
                        anchor,
                        chunk.text,
                        hash
                    ],
                )?,
            };
        }
        tx.execute(
            "DELETE FROM chunks WHERE document_id = ?1 AND ordinal >= ?2",
            params![document, chunks.len() as i64],
        )?;
        // Embeddings of text no passage holds any more go too, including those left by files
        // deleted since the last index.
        tx.execute(
            "DELETE FROM embeddings WHERE NOT EXISTS
                 (SELECT 1 FROM chunks c WHERE c.content_hash = embeddings.content_hash)",
            [],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// A document's passages that have no embedding from `model` yet, one per distinct text.
    pub fn passages_to_embed(
        &self,
        document: DocumentId,
        model: &str,
    ) -> Result<Vec<PendingPassage>> {
        // One row per hash; rows sharing a hash share their text, so any one's will do.
        let mut statement = self.connection.prepare(
            "SELECT c.content_hash, c.text FROM chunks c
             WHERE c.document_id = ?1 AND NOT EXISTS (
                 SELECT 1 FROM embeddings e WHERE e.content_hash = c.content_hash AND e.model = ?2)
             GROUP BY c.content_hash
             ORDER BY min(c.ordinal)",
        )?;
        let passages = statement
            .query_map(params![document, model], |row| {
                Ok((row.get::<_, Vec<u8>>(0)?, row.get::<_, String>(1)?))
            })?
            .map(|row| {
                let (hash, text) = row?;
                let content_hash = <[u8; 32]>::try_from(hash.as_slice())
                    .context("a stored passage hash is not 32 bytes")?;
                Ok(PendingPassage { content_hash, text })
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(passages)
    }

    /// Stores embeddings from `model` for passage texts.
    pub fn set_embeddings(&self, model: &str, embedded: &[([u8; 32], Vec<f32>)]) -> Result<()> {
        let tx = self.immediate()?;
        {
            let mut statement = tx.prepare(
                // Only for text a passage still holds: it may have changed while the model ran.
                "INSERT OR REPLACE INTO embeddings (content_hash, model, vector)
                 SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM chunks WHERE content_hash = ?1)",
            )?;
            for (hash, vector) in embedded {
                statement.execute(params![hash.as_slice(), model, encode_vector(vector)])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// Documents with passages that have no embedding from `model`, such as everything read
    /// before the search model was installed.
    pub fn documents_missing_embeddings(&self, model: &str) -> Result<Vec<DocumentId>> {
        let mut statement = self.connection.prepare(
            "SELECT DISTINCT c.document_id FROM chunks c
             WHERE NOT EXISTS (
                 SELECT 1 FROM embeddings e WHERE e.content_hash = c.content_hash AND e.model = ?1)
             ORDER BY c.document_id",
        )?;
        let documents = statement
            .query_map(params![model], |row| row.get(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(documents)
    }

    /// Calls `visit` with every passage embedded by `model`.
    pub fn for_each_embedding(
        &self,
        model: &str,
        visit: impl FnMut(ChunkId, &[f32]),
    ) -> Result<()> {
        let mut statement = self.connection.prepare(
            "SELECT c.id, e.vector FROM chunks c
             JOIN embeddings e ON e.content_hash = c.content_hash AND e.model = ?1",
        )?;
        visit_vectors(statement.query(params![model])?, visit)
    }

    /// Like [`for_each_embedding`](Self::for_each_embedding), for passages in `project` only.
    pub fn for_each_embedding_in(
        &self,
        model: &str,
        project: ProjectId,
        visit: impl FnMut(ChunkId, &[f32]),
    ) -> Result<()> {
        let mut statement = self.connection.prepare(
            "SELECT c.id, e.vector FROM chunks c
             JOIN embeddings e ON e.content_hash = c.content_hash AND e.model = ?1
             JOIN documents d ON d.id = c.document_id
             JOIN sources s ON s.id = d.source_id
             WHERE s.project_id = ?2",
        )?;
        visit_vectors(statement.query(params![model, project])?, visit)
    }

    /// The passages with these ids, in the same order, with where they come from, for
    /// answers that cite them; ids no longer stored are skipped.
    pub fn passages(&self, ids: &[ChunkId]) -> Result<Vec<Excerpt>> {
        let mut statement = self.connection.prepare(
            "SELECT s.id, s.name, c.anchor, c.text FROM chunks c
             JOIN documents d ON d.id = c.document_id
             JOIN sources s ON s.id = d.source_id
             WHERE c.id = ?1",
        )?;
        let mut passages = Vec::with_capacity(ids.len());
        for &id in ids {
            let passage = statement
                .query_row(params![id], |row| {
                    Ok(Excerpt {
                        source_id: row.get(0)?,
                        source_name: row.get(1)?,
                        anchor: json_column(row, 2)?,
                        text: row.get(3)?,
                    })
                })
                .optional()?;
            passages.extend(passage);
        }
        Ok(passages)
    }
}

/// Calls `visit` with each `(chunk id, vector)` row, decoding into one reused buffer.
fn visit_vectors(mut rows: Rows<'_>, mut visit: impl FnMut(ChunkId, &[f32])) -> Result<()> {
    let mut vector = Vec::new();
    while let Some(row) = rows.next()? {
        decode_vector(row.get_ref(1)?.as_blob()?, &mut vector);
        visit(row.get(0)?, &vector);
    }
    Ok(())
}

/// The SHA-256 of a passage's text, which identifies its embedding.
fn content_hash(text: &str) -> Vec<u8> {
    Sha256::digest(text.as_bytes()).to_vec()
}

/// A vector as stored in `embeddings.vector`: little-endian `f32`s.
fn encode_vector(vector: &[f32]) -> Vec<u8> {
    vector
        .iter()
        .flat_map(|value| value.to_le_bytes())
        .collect()
}

/// The inverse of [`encode_vector`], reusing `into`'s allocation.
fn decode_vector(bytes: &[u8], into: &mut Vec<f32>) {
    into.clear();
    into.extend(
        bytes
            .as_chunks::<4>()
            .0
            .iter()
            .map(|bytes| f32::from_le_bytes(*bytes)),
    );
}
