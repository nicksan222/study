//! Documents: the canonical text of each source, as anchored blocks.

use super::jobs::{cancel_unfinished, enqueue};
use super::{Database, JobTarget, NewJob, json_column, unix_timestamp};
use crate::processing::{ExtractorKind, RefinerKind};
use crate::{Block, Document, DocumentId, DocumentMeta, JobId, JobKind, SourceId, SourceKind};
use crate::{Context as _, Result};
use rusqlite::{Connection, OptionalExtension as _, params};

impl Database {
    /// Replaces the document of a source with `document`, blocks and all, in one transaction.
    /// Search passages and pending work of the old document go with it.
    pub fn save_document(&self, source: SourceId, document: &Document) -> Result<DocumentId> {
        let tx = self.immediate()?;
        let id = insert_document(&tx, source, document)?;
        tx.commit()?;
        Ok(id)
    }

    /// Saves what the running job `read` read as the source's document, as
    /// [`save_document`](Self::save_document) does, unless the job has ended meanwhile:
    /// cancelled because the user corrected the document while it read. A read that started
    /// before a correction never replaces it. Returns `None`, saving nothing, then.
    pub fn save_read(
        &self,
        read: JobId,
        source: SourceId,
        document: &Document,
    ) -> Result<Option<DocumentId>> {
        let tx = self.immediate()?;
        let running = tx
            .query_row(
                "SELECT status = 'running' FROM jobs WHERE id = ?1",
                params![read],
                |row| row.get::<_, bool>(0),
            )
            .optional()?
            .unwrap_or(false);
        if !running {
            return Ok(None);
        }
        let id = insert_document(&tx, source, document)?;
        tx.commit()?;
        Ok(Some(id))
    }

    /// Replaces the text of block `ordinal` of a source's document with the user's
    /// correction, such as a misheard word in a transcript, and queues `next` (the stage that
    /// follows reading, if any) on the corrected document in the same transaction, so search
    /// catches up. The document is replaced whole, taking its old passages and pending work
    /// with it.
    ///
    /// Reads of the source queued, running or failed are cancelled in the same transaction,
    /// as they started from what the user just corrected: one queued automatically, such as
    /// to correct a transcript after signing in, or a failed one a sign-in or install would
    /// retry, would otherwise replace the correction. A read asked for after the correction
    /// replaces it, as asked.
    ///
    /// The document is marked [`corrected`](DocumentMeta::corrected), so it is never handed
    /// to another source by [`document_for_same_bytes`](Self::document_for_same_bytes).
    ///
    /// Only applies while the block still reads `before`: returns `None` when the source was
    /// read again, deleted, or the block changed since the caller saw it.
    pub fn correct_block(
        &self,
        source: SourceId,
        ordinal: usize,
        before: &str,
        after: &str,
        next: Option<JobKind>,
    ) -> Result<Option<DocumentId>> {
        // Read under the write lock, so the block cannot change between the check and the
        // write.
        let tx = self.immediate()?;
        let Some((_, mut document)) = self.document_of(source)? else {
            return Ok(None);
        };
        let Some(block) = document
            .blocks
            .get_mut(ordinal)
            .filter(|block| block.text == before)
        else {
            return Ok(None);
        };
        block.text = after.trim().to_owned();
        document.meta.corrected = true;
        cancel_unfinished(&tx, JobKind::Extract, JobTarget::Source(source))?;
        let id = insert_document(&tx, source, &document)?;
        if let Some(next) = next {
            enqueue(&tx, &NewJob::new(next, JobTarget::Document(id)))?;
        }
        tx.commit()?;
        Ok(Some(id))
    }

    /// A source's document, or `None` until it has been read.
    pub fn document_of(&self, source: SourceId) -> Result<Option<(DocumentId, Document)>> {
        let id: Option<DocumentId> = self
            .connection
            .query_row(
                "SELECT id FROM documents WHERE source_id = ?1",
                params![source],
                |row| row.get(0),
            )
            .optional()?;
        let Some(id) = id else {
            return Ok(None);
        };
        Ok(self.document(id)?.map(|document| (id, document)))
    }

    /// The source a document was read from, or `None` once the document is gone.
    pub fn source_of_document(&self, id: DocumentId) -> Result<Option<SourceId>> {
        Ok(self
            .connection
            .query_row(
                "SELECT source_id FROM documents WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()?)
    }

    /// A document by its id, or `None` once it was replaced or its source deleted.
    pub fn document(&self, id: DocumentId) -> Result<Option<Document>> {
        let meta: Option<String> = self
            .connection
            .query_row(
                "SELECT meta FROM documents WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()?;
        let Some(meta) = meta else {
            return Ok(None);
        };
        let meta = parse_meta(&meta)?;
        let mut statement = self.connection.prepare(
            "SELECT kind, text, anchor FROM blocks WHERE document_id = ?1 ORDER BY ordinal",
        )?;
        let blocks = statement
            .query_map(params![id], |row| {
                Ok(Block {
                    kind: row.get(0)?,
                    text: row.get(1)?,
                    anchor: json_column(row, 2)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(Some(Document { blocks, meta }))
    }

    /// A document already read from other bytes identical to `source`'s by the same
    /// extractor version, the newest whose meta `accept`s (such as refined the same way), so
    /// reading them again can be skipped. A document the user
    /// [`corrected`](DocumentMeta::corrected) is never one: the correction belongs to its source.
    pub fn document_for_same_bytes(
        &self,
        source: SourceId,
        extractor: ExtractorKind,
        extractor_version: u32,
        accept: impl Fn(&DocumentMeta) -> bool,
    ) -> Result<Option<Document>> {
        let mut statement = self.connection.prepare(
            "SELECT d.id, d.meta FROM documents d
             JOIN sources other ON other.id = d.source_id
             JOIN sources this ON this.sha256 = other.sha256
             WHERE this.id = ?1 AND other.id != ?1
               AND d.extractor = ?2 AND d.extractor_version = ?3
             ORDER BY d.id DESC",
        )?;
        let candidates = statement
            .query_map(params![source, extractor, extractor_version], |row| {
                Ok((row.get::<_, DocumentId>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (id, meta) in candidates {
            let meta = parse_meta(&meta)?;
            if !meta.corrected && accept(&meta) {
                return self.document(id);
            }
        }
        Ok(None)
    }

    /// Sources whose document is [`waiting_for`](DocumentMeta::waiting_for) a refiner that
    /// `planned` names for a source of its kind and media type: one that failed when it was
    /// read, such as a transcript read before anyone signed in, and is still switched on. A
    /// refiner that was switched off when it was read leaves no mark, so switching it on
    /// reads nothing again. Documents the user corrected by hand are left out, as reading
    /// them again would lose the correction.
    pub fn sources_missing_refiners(
        &self,
        planned: impl Fn(SourceKind, &str) -> Vec<RefinerKind>,
    ) -> Result<Vec<SourceId>> {
        let mut statement = self.connection.prepare(
            "SELECT s.id, s.kind, s.mime, d.meta FROM documents d
             JOIN sources s ON s.id = d.source_id
             ORDER BY s.id",
        )?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, SourceId>(0)?,
                    row.get::<_, SourceKind>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut missing = Vec::new();
        for (source, kind, mime, meta) in rows {
            let meta = parse_meta(&meta)?;
            let waiting = |refiner: &RefinerKind| meta.waiting_for.contains(refiner);
            if !meta.corrected && planned(kind, &mime).iter().any(waiting) {
                missing.push(source);
            }
        }
        Ok(missing)
    }

    /// Documents that were read but have no search passages, and some text to split: what
    /// an Index job that never ran (such as one cancelled as it finished reading) left.
    pub fn documents_missing_passages(&self) -> Result<Vec<DocumentId>> {
        // SQLite's `trim` strips only spaces by default; the list adds tabs, line breaks and
        // the no-break space, so a blank block is not text to split.
        let mut statement = self.connection.prepare(
            "SELECT d.id FROM documents d
             WHERE NOT EXISTS (SELECT 1 FROM chunks c WHERE c.document_id = d.id)
               AND EXISTS (SELECT 1 FROM blocks b WHERE b.document_id = d.id
                           AND length(trim(b.text, ' ' || char(9, 10, 11, 12, 13, 160))) > 0)
             ORDER BY d.id",
        )?;
        let ids = statement
            .query_map([], |row| row.get(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(ids)
    }
}

/// Reads a document's stored `meta` column.
fn parse_meta(json: &str) -> Result<DocumentMeta> {
    serde_json::from_str(json).context("a stored document has invalid metadata")
}

/// Replaces a source's document inside the caller's transaction.
fn insert_document(
    connection: &Connection,
    source: SourceId,
    document: &Document,
) -> Result<DocumentId> {
    connection.execute(
        "DELETE FROM documents WHERE source_id = ?1",
        params![source],
    )?;
    connection.execute(
        "INSERT INTO documents (source_id, extractor, extractor_version, meta, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            source,
            document.meta.extractor,
            document.meta.extractor_version,
            serde_json::to_string(&document.meta)?,
            unix_timestamp()
        ],
    )?;
    let id = DocumentId::new(connection.last_insert_rowid());
    let mut statement = connection.prepare(
        "INSERT INTO blocks (document_id, ordinal, kind, text, anchor) VALUES (?1, ?2, ?3, ?4, ?5)",
    )?;
    for (ordinal, block) in document.blocks.iter().enumerate() {
        statement.execute(params![
            id,
            ordinal as i64,
            block.kind,
            block.text,
            serde_json::to_string(&block.anchor)?
        ])?;
    }
    Ok(id)
}

#[cfg(test)]
mod tests {
    use crate::db::{ChunkDraft, Database, JobTarget, NewJob};
    use crate::processing::ExtractorKind;
    use crate::{
        Anchor, Block, BlockKind, Document, DocumentMeta, ErrorKind, Failure, JobKind, JobStatus,
        Result, SourceId,
    };
    use std::path::Path;

    /// A file `name` in `dir` holding `bytes`, imported.
    fn import(db: &Database, dir: &Path, name: &str, bytes: &[u8]) -> Result<SourceId> {
        let file = dir.join(name);
        std::fs::write(&file, bytes)?;
        Ok(db.import_source(&file, None)?.id)
    }

    /// One passage over the first block.
    fn passage(text: &str) -> ChunkDraft {
        ChunkDraft {
            first_block: 0,
            last_block: 0,
            anchor: Anchor::Page { page: 1 },
            text: text.into(),
        }
    }

    #[test]
    fn sources_waiting_for_a_refiner_still_on_are_found_unless_corrected_by_hand() -> Result<()> {
        use crate::processing::{
            ProcessingPreferences, Processor, RefinerKind, sources_missing_refiners,
        };
        use crate::{Requirement, SourceKind, Stamp};

        let waiting = |text: &str| {
            let mut document = document(text);
            document.meta.waiting_for = vec![RefinerKind::Transcript];
            document
        };
        let (dir, db) = Database::temporary()?;
        let heard = import(&db, dir.path(), "heard.wav", b"one")?;
        db.save_document(heard, &waiting("uncorrected"))?;
        let refined = import(&db, dir.path(), "refined.wav", b"two")?;
        let mut stamped = document("corrected by a model");
        stamped.meta.refiners = vec![Stamp {
            refiner: RefinerKind::Transcript,
            version: 1,
        }];
        db.save_document(refined, &stamped)?;
        // Read while correction was switched off: switching it on applies from then on.
        let switched_off = import(&db, dir.path(), "switched-off.wav", b"three")?;
        db.save_document(switched_off, &document("as heard"))?;
        let by_hand = import(&db, dir.path(), "by-hand.wav", b"four")?;
        db.save_document(by_hand, &waiting("misheard"))?;
        db.correct_block(by_hand, 0, "misheard", "heard right", None)?;
        // Tidying needs nothing set up, so a note waiting for it is not caught up.
        let note = import(&db, dir.path(), "note.txt", b"five")?;
        let mut untidy = document("untidy");
        untidy.meta.waiting_for = vec![RefinerKind::Whitespace];
        db.save_document(note, &untidy)?;

        assert_eq!(
            sources_missing_refiners(&db, Requirement::LanguageModels)?,
            [heard]
        );

        // Switched off since, the refiner it waits for no longer brings it back.
        let correction = Processor::Refiner(RefinerKind::Transcript);
        ProcessingPreferences::save_switch(&db, SourceKind::Audio, correction, false)?;
        assert_eq!(
            sources_missing_refiners(&db, Requirement::LanguageModels)?,
            []
        );
        ProcessingPreferences::save_switch(&db, SourceKind::Audio, correction, true)?;
        assert_eq!(
            sources_missing_refiners(&db, Requirement::LanguageModels)?,
            [heard]
        );
        Ok(())
    }

    fn document(text: &str) -> Document {
        Document {
            blocks: vec![Block {
                kind: BlockKind::Segment,
                text: text.into(),
                anchor: Anchor::Time {
                    start_ms: 0,
                    end_ms: 2_000,
                },
            }],
            meta: DocumentMeta {
                extractor: Some(ExtractorKind::Transcription),
                extractor_version: 1,
                ..DocumentMeta::default()
            },
        }
    }

    #[test]
    fn a_source_has_one_document_replaced_whole() -> Result<()> {
        let (dir, db) = Database::temporary()?;
        let source = import(&db, dir.path(), "talk.wav", b"RIFF")?;
        assert_eq!(db.document_of(source)?, None);

        let first = db.save_document(source, &document("hello"))?;
        let second = db.save_document(source, &document("hello again"))?;
        assert_ne!(first, second);
        assert_eq!(db.document(first)?, None);
        let (id, stored) = db.document_of(source)?.unwrap();
        assert_eq!((id, stored), (second, document("hello again")));

        db.delete_source(source)?;
        assert_eq!(db.document(second)?, None);
        Ok(())
    }

    #[test]
    fn a_corrected_block_replaces_the_document_and_queues_indexing() -> Result<()> {
        let (dir, db) = Database::temporary()?;
        let source = import(&db, dir.path(), "talk.wav", b"RIFF")?;
        let read = db.save_document(source, &document("the sell divides"))?;
        db.store_chunks(read, &[passage("the sell divides")])?;

        let corrected = db
            .correct_block(
                source,
                0,
                "the sell divides",
                " the cell divides\n",
                Some(JobKind::Index),
            )?
            .unwrap();
        assert_eq!(db.document(read)?, None, "the old document goes");
        let (id, stored) = db.document_of(source)?.unwrap();
        assert_eq!(id, corrected);
        assert_eq!(stored.blocks[0].text, "the cell divides");
        assert_eq!(stored.blocks[0].anchor, document("").blocks[0].anchor);
        let read_meta = document("").meta;
        assert_eq!(
            stored.meta,
            DocumentMeta {
                corrected: true,
                ..read_meta
            }
        );
        assert!(db.documents_missing_passages()?.contains(&corrected));
        let jobs = db.jobs_for(JobTarget::Document(corrected))?;
        assert_eq!(
            jobs.iter().map(|job| job.kind).collect::<Vec<_>>(),
            [JobKind::Index]
        );

        // Stale: the block no longer reads what the caller saw.
        let stale = db.correct_block(source, 0, "the sell divides", "x", None)?;
        assert_eq!(stale, None);
        assert_eq!(db.correct_block(source, 7, "", "x", None)?, None);
        assert_eq!(db.document_of(source)?.unwrap().0, corrected);
        Ok(())
    }

    /// Reads queued or running when the user corrects the document are cancelled, and what
    /// they read is not saved; a read asked for after the correction replaces it.
    #[test]
    fn a_read_started_before_a_correction_never_replaces_it() -> Result<()> {
        for waits_for_setup in [false, true] {
            let (dir, db) = Database::temporary()?;
            let source = import(&db, dir.path(), "talk.wav", b"RIFF")?;
            db.save_document(source, &document("the sell divides"))?;
            let read = NewJob::new(JobKind::Extract, JobTarget::Source(source));
            // A terminal failure, a running read, and a queued or setup-waiting read.
            let failed = db.enqueue_job(&read)?;
            assert_eq!(db.claim_job(&[JobKind::Extract])?.unwrap().id, failed);
            db.fail_job(failed, &Failure::new(ErrorKind::Transient, "offline"), None)?;
            let running = db.enqueue_job(&read)?;
            assert_eq!(db.claim_job(&[JobKind::Extract])?.unwrap().id, running);
            let pending = db.enqueue_job(&read)?;
            if waits_for_setup {
                assert_eq!(db.claim_job(&[JobKind::Extract])?.unwrap().id, pending);
                db.fail_job(
                    pending,
                    &Failure::new(ErrorKind::Config, "not installed"),
                    None,
                )?;
                assert_eq!(db.job(pending)?.unwrap().status, JobStatus::Waiting);
            }

            let corrected = db
                .correct_block(source, 0, "the sell divides", "the cell divides", None)?
                .unwrap();
            for job in [failed, running, pending] {
                assert_eq!(db.job(job)?.unwrap().status, JobStatus::Cancelled);
            }
            assert_eq!(
                db.retry_failed_jobs(
                    &[JobKind::Extract],
                    &[ErrorKind::Transient, ErrorKind::Config]
                )?,
                0
            );
            assert_eq!(db.release_waiting(crate::Requirement::Transcription)?, 0);
            assert_eq!(
                db.save_read(running, source, &document("the sell divides"))?,
                None
            );
            assert_eq!(db.document_of(source)?.unwrap().0, corrected);

            let again = db.enqueue_job(&read)?;
            assert_eq!(db.claim_job(&[JobKind::Extract])?.unwrap().id, again);
            let fresh = db.save_read(again, source, &document("the sell divides"))?;
            assert!(fresh.is_some());
            assert_eq!(db.document_of(source)?.unwrap().0, fresh.unwrap());
        }
        Ok(())
    }

    #[test]
    fn identical_bytes_reuse_a_document_read_the_same_way() -> Result<()> {
        let (dir, db) = Database::temporary()?;
        let first = import(&db, dir.path(), "a.wav", b"same")?;
        let copy = import(&db, dir.path(), "b.wav", b"same")?;
        db.save_document(first, &document("shared"))?;
        let any = |_: &DocumentMeta| true;
        let reused = db.document_for_same_bytes(copy, ExtractorKind::Transcription, 1, any)?;
        assert_eq!(reused, Some(document("shared")));
        assert_eq!(
            db.document_for_same_bytes(copy, ExtractorKind::Transcription, 2, any)?,
            None
        );
        assert_eq!(
            db.document_for_same_bytes(first, ExtractorKind::Transcription, 1, any)?,
            None
        );
        let refined = |meta: &DocumentMeta| !meta.refiners.is_empty();
        assert_eq!(
            db.document_for_same_bytes(copy, ExtractorKind::Transcription, 1, refined)?,
            None
        );

        // A hand correction belongs to its source: the copy reads its own bytes.
        db.correct_block(first, 0, "shared", "corrected by hand", None)?
            .unwrap();
        assert_eq!(
            db.document_for_same_bytes(copy, ExtractorKind::Transcription, 1, any)?,
            None
        );
        Ok(())
    }

    #[test]
    fn a_document_knows_its_source_until_it_is_replaced_or_deleted() -> Result<()> {
        let (dir, db) = Database::temporary()?;
        let source = import(&db, dir.path(), "talk.wav", b"RIFF")?;
        let first = db.save_document(source, &document("one"))?;
        assert_eq!(db.source_of_document(first)?, Some(source));
        let second = db.save_document(source, &document("two"))?;
        assert_eq!(db.source_of_document(first)?, None);
        db.delete_source(source)?;
        assert_eq!(db.source_of_document(second)?, None);
        Ok(())
    }

    #[test]
    fn documents_without_passages_are_found_until_indexed() -> Result<()> {
        let (dir, db) = Database::temporary()?;
        let source = import(&db, dir.path(), "talk.wav", b"RIFF")?;
        let id = db.save_document(source, &document("hello"))?;
        assert_eq!(db.documents_missing_passages()?, [id]);
        db.store_chunks(id, &[passage("hello")])?;
        assert!(db.documents_missing_passages()?.is_empty());
        // Blank text has nothing to index, so it is never queued again.
        let blank = import(&db, dir.path(), "blank.wav", b"RIFF blank")?;
        db.save_document(blank, &document("\t\n \r"))?;
        assert!(db.documents_missing_passages()?.is_empty());
        Ok(())
    }

    #[test]
    fn the_extractor_column_takes_every_extractor_kind_and_nothing_else() -> Result<()> {
        let (dir, db) = Database::temporary()?;
        let source = import(&db, dir.path(), "talk.wav", b"RIFF")?;
        for kind in ExtractorKind::ALL {
            let mut read = document("text");
            read.meta.extractor = Some(*kind);
            db.save_document(source, &read)?;
        }
        let unknown = db.connection.execute(
            "UPDATE documents SET extractor = 'pdf' WHERE source_id = ?1",
            rusqlite::params![source],
        );
        assert!(unknown.is_err());
        Ok(())
    }
}
