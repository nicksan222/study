/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Maintains durable external item identities and destination publication receipts.   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Prevents duplicate imports and tracks deleted destinations.                            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Receipts are committed atomically with feature publication in caller transactions.       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { noteIdSchema, pageIdSchema } from '@study/contracts/ids';
import { integrationImportIdSchema } from '@study/contracts/integrations/schemas';
import { eq } from '@study/db';
import { integration_receipts } from '@study/db/schema';
import { Option, Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';

const receiptSchema = Schema.Struct({
  identity: Schema.String,
  fingerprint: Schema.String,
  importId: integrationImportIdSchema,
  noteId: Schema.NullOr(noteIdSchema),
  pageId: Schema.NullOr(pageIdSchema)
});

export const IntegrationReceiptsStore = defineStore({
  name: 'study/IntegrationReceiptsStore',
  entity: { singular: 'integrationReceipt', plural: 'integrationReceipts' },
  make: ({ db }) => ({
    queries: {
      findIntegrationReceipt: storeQuery({
        role: 'optional',
        input: Schema.String,
        output: Schema.Option(receiptSchema),
        run: (identity) => {
          const row = db.orm
            .select()
            .from(integration_receipts)
            .where(eq(integration_receipts.identity, identity))
            .get();

          return row
            ? Option.some({
                identity: row.identity,
                fingerprint: row.fingerprint,
                importId: row.import_id,
                noteId: row.note_id,
                pageId: row.page_id
              })
            : Option.none();
        }
      })
    },
    mutations: {
      retain: storeMutation({
        input: receiptSchema,
        output: Schema.Void,
        run: (receipt) => {
          db.orm
            .insert(integration_receipts)
            .values({
              identity: receipt.identity,
              fingerprint: receipt.fingerprint,
              import_id: receipt.importId,
              note_id: receipt.noteId,
              page_id: receipt.pageId
            })
            .onConflictDoUpdate({
              target: integration_receipts.identity,
              set: { page_id: receipt.pageId, fingerprint: receipt.fingerprint }
            })
            .run();
        }
      })
    }
  })
});
