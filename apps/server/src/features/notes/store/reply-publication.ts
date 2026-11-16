/** @file Builds notes reply publication queries and mutations with bound store resources. */

import {
  StudyError,
  anchorSchema,
  publishReplyInputSchema,
  runPreferencesSchema,
  selectionReferenceKey,
  versionIdSchema
} from '@study/contracts';
/** Owns reply publication within this feature. */
import {
  and,
  asc,
  blocks,
  citations,
  content_snapshots,
  eq,
  message_versions,
  messages,
  note_reply_requests,
  notes,
  sources,
  sql
} from '@study/db';
import { storeMutation, unixSeconds } from '@study/server';
import type { StoreResources } from '@study/server';
import { Schema } from 'effect';

import {
  citationExcerpt,
  sameReceiptCitation,
  selectedCitationIdentity
} from './reply-citations.ts';
import {
  allowsLiteralReferences,
  answerPublicationText,
  generationMatches,
  matchesRequest,
  replyContextMatches,
  replyVersionSelection
} from './reply-identity.ts';
import { persistedCodec } from './reply-schemas.ts';
import { makeReplySnapshots } from './reply-snapshots.ts';

export function makeReplyPublicationMutations({ db, clock, timestampClock }: StoreResources) {
  const { replyContext } = makeReplySnapshots({ db, clock, timestampClock });

  return {
    publishReply: storeMutation({
      changes: ['notes'],
      input: Schema.Struct({
        ...publishReplyInputSchema.fields,
        language: runPreferencesSchema.fields.language
      }),
      output: versionIdSchema,
      run: (input) => {
        const invalid = (): never => {
          throw new StudyError('invalid_input', 'invalid reply publication');
        };

        function assertCitation(citation: (typeof input.citations)[number], markers: Set<number>) {
          if (
            !Number.isInteger(citation.marker) ||
            citation.marker < 1 ||
            citation.marker > 4294967295 ||
            markers.has(citation.marker) ||
            !Number.isSafeInteger(citation.blockOrdinal) ||
            citation.blockOrdinal < 0 ||
            !citation.quote.trim()
          )
            invalid();
        }

        const { row, result: snapshot, note, target, version } = replyContext(input.requestId);

        validatePublicationInput();

        function validatePublicationInput() {
          if (!input.text.trim() || [...input.text].length > 100_000) invalid();

          if (allowsLiteralReferences(snapshot, note?.mode)) {
            if (input.citations.length) invalid();

            return;
          }

          const markers = new Set<number>();

          for (const citation of input.citations) {
            assertCitation(citation, markers);

            markers.add(citation.marker);
          }

          const references = new Set(
            Array.from(input.text.matchAll(/\[(\d+)\]/g), (match) => Number(match[1]))
          );

          if (
            references.size !== markers.size ||
            [...references].some((marker) => !markers.has(marker))
          )
            invalid();
        }

        assertPublicationIdentity();

        function assertPublicationIdentity() {
          if (
            !note ||
            !matchesRequest(snapshot, row) ||
            target?.note_id !== note.id ||
            version?.message_id !== target.id ||
            !generationMatches(version, snapshot, target.role)
          )
            invalid();
        }

        const payload = JSON.stringify(
          { requestId: input.requestId, text: input.text, citations: input.citations },
          (_key, value) => (typeof value === 'bigint' ? value.toString() : value)
        );

        const saved = Schema.decodeUnknownSync(persistedCodec)(row.snapshot);
        const publishedText = answerPublicationText(snapshot, input);

        function selectedCitation(
          citation: (typeof publishReplyInputSchema.Type.citations)[number]
        ) {
          const selected = snapshot.context?.inputs.find(
            (item) =>
              citation.input !== undefined &&
              selectionReferenceKey(item.input) === selectionReferenceKey(citation.input) &&
              item.snapshotId === citation.documentId
          );

          const range = citation.selectedRange;

          if (!selected || !range || selected.snapshotId !== citation.documentId) return invalid();

          const excerpt = citationExcerpt(selected, citation);

          const document = db.orm
            .select()
            .from(content_snapshots)
            .where(eq(content_snapshots.id, citation.documentId))
            .get();

          if (
            !excerpt ||
            !document ||
            citation.sourceId !== selectedCitationIdentity(selected.input).source_id
          )
            return invalid();

          return {
            version_id: row.version_id,
            marker: BigInt(citation.marker),
            ...selectedCitationIdentity(selected.input),
            document_id: selected.snapshotId,
            block_id: excerpt.blockId,
            range_start: BigInt(excerpt.start),
            range_end: BigInt(excerpt.end),
            source_name: selected.name,
            anchor: JSON.stringify(excerpt.anchor),
            quote: citation.quote
          };
        }

        function attachmentCitation(
          citation: (typeof publishReplyInputSchema.Type.citations)[number]
        ) {
          if (
            citation.input.kind !== 'source' ||
            citation.sourceId !== citation.input.sourceId ||
            citation.sourceId === null ||
            citation.selectedRange !== undefined
          )
            return invalid();

          const attachment = snapshot.messages
            .flatMap((message) => message.attachments)
            .find(
              (part) =>
                part.sourceId === citation.sourceId &&
                part.snapshotId === citation.documentId &&
                citation.input.kind === 'source' &&
                part.revision === citation.input.revision &&
                part.snapshotId === citation.input.snapshotId
            );

          const source = db.orm
            .select()
            .from(sources)
            .where(and(eq(sources.id, citation.sourceId)))
            .get();

          const document = db.orm
            .select()
            .from(content_snapshots)
            .where(
              and(
                eq(content_snapshots.id, citation.documentId),
                eq(content_snapshots.source_id, citation.sourceId)
              )
            )
            .get();

          const block = db.orm
            .select()
            .from(blocks)
            .where(
              and(
                eq(blocks.document_id, citation.documentId),
                eq(blocks.ordinal, BigInt(citation.blockOrdinal))
              )
            )
            .get();

          if (!attachment || !source || !document || !block || !block.text.includes(citation.quote))
            return invalid();

          const anchor = Schema.decodeUnknownSync(anchorSchema)(JSON.parse(block.anchor));

          return {
            version_id: row.version_id,
            marker: BigInt(citation.marker),
            source_id: citation.sourceId,
            authored_version_id: null,
            source_revision: attachment.revision,
            document_id: citation.documentId,
            block_id: block.editing_id,
            range_start: null,
            range_end: null,
            source_name: attachment.sourceName,
            anchor: JSON.stringify(anchor),
            quote: citation.quote
          };
        }

        const validated = input.citations.map((citation) =>
          citation.selectedRange !== undefined
            ? selectedCitation(citation)
            : attachmentCitation(citation)
        );

        function assertPublicationAttachments() {
          for (const item of snapshot.messages.flatMap((message) => message.attachments)) {
            if (
              !db.orm
                .select()
                .from(sources)
                .where(and(eq(sources.id, item.sourceId)))
                .get() ||
              !db.orm
                .select()
                .from(content_snapshots)
                .where(
                  and(
                    eq(content_snapshots.id, item.snapshotId),
                    eq(content_snapshots.source_id, item.sourceId)
                  )
                )
                .get()
            )
              invalid();
          }
        }

        function assertPublicationReplay() {
          const existing = db.orm
            .select()
            .from(citations)
            .where(eq(citations.version_id, row.version_id))
            .orderBy(asc(citations.marker))
            .all();

          const expected = [...validated].sort((a, b) => Number(a.marker - b.marker));

          if (
            saved.publication !== payload ||
            version!.text !== (saved.publicationText ?? input.text) ||
            existing.length !== expected.length ||
            existing.some((item, i) => !sameReceiptCitation(item, expected[i]!))
          )
            invalid();
        }

        if (version!.status === 'complete') {
          assertPublicationReplay();

          return row.version_id;
        }

        assertPendingPublication();

        /** Fences publication against unresolved attachments and changes to the captured selection. */
        function assertPendingPublication() {
          if ((snapshot.pendingAttachments?.length ?? 0) > 0 || [...publishedText].length > 100_000)
            invalid();

          if (
            version!.status !== 'pending' ||
            !replyVersionSelection(target!, version!, snapshot) ||
            !replyContextMatches(snapshot, note!)
          )
            invalid();
        }

        assertPublicationAttachments();

        db.orm
          .update(message_versions)
          .set({ text: publishedText, status: 'complete' })
          .where(eq(message_versions.id, row.version_id))
          .run();

        selectCompletedAnswer();

        /** Selects completed answers and conversions only when their selection policy permits it. */
        function selectCompletedAnswer() {
          if (
            snapshot.generation?.questionVersionId ||
            (snapshot.generation?.conversion &&
              target!.active_version_id === snapshot.generation.conversion.baseVersionId)
          )
            db.orm
              .update(messages)
              .set({ active_version_id: row.version_id })
              .where(eq(messages.id, target!.id))
              .run();
        }

        for (const citation of validated) db.orm.insert(citations).values(citation).run();

        db.orm
          .update(note_reply_requests)
          .set({
            snapshot: Schema.encodeSync(persistedCodec)({
              ...saved,
              publication: payload,
              publicationText: publishedText
            })
          })
          .where(eq(note_reply_requests.request_id, row.request_id))
          .run();
        db.orm
          .update(notes)
          .set({
            updated_at: unixSeconds(timestampClock),
            context_revision: sql`${notes.context_revision} + 1`
          })
          .where(eq(notes.id, note!.id))
          .run();

        return row.version_id;
      }
    })
  };
}
