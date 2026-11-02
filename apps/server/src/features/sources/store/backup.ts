/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Validates original source bytes and managed image retention roots inside supported │
 * │ backup snapshots.                                                                        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks original hashes, byte lengths and exact managed image revision roots.           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Sources owns asset interpretation; snapshot validation performs no extraction or         │
 * │ external reads.                                                                          │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createHash } from 'node:crypto';

import { StudyError } from '@study/contracts/errors';
import { decodeBlockContent } from '@study/contracts/sources/document';
import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
import type { StoreResources } from '#server/platform/definitions/define-store';

function invalid(): never {
  throw new StudyError('invalid_input', 'Backup assets are incomplete');
}

function makeAssetValidation({ db }: StoreResources) {
  function original(source: typeof s.sources.$inferSelect) {
    const blob = db.orm
      .select()
      .from(s.source_blobs)
      .where(eq(s.source_blobs.source_id, source.id))
      .get();

    if (!blob) {
      const retired = db.orm
        .get(sql`SELECT 1 FROM material_imports i JOIN material_deletion_members d ON d.material_id=i.material_id WHERE i.source_id=${source.id}
        UNION ALL SELECT 1 FROM source_material_deletion_assets a JOIN material_deletions d ON d.material_id=a.deletion_id WHERE a.source_id=${source.id} AND d.status='completed' LIMIT 1`);

      if (
        !retired ||
        source.name !== '-' ||
        source.uri !== null ||
        source.size_bytes !== 1n ||
        !Buffer.from(source.sha256).equals(Buffer.alloc(32))
      )
        invalid();

      return;
    }

    if (
      BigInt(blob.bytes.length) !== source.size_bytes ||
      !createHash('sha256').update(blob.bytes).digest().equals(Buffer.from(source.sha256))
    )
      invalid();
  }

  function image(block: typeof s.blocks.$inferSelect) {
    const content = decodeBlockContent(block.content);

    if (content.type !== 'image') return;

    const root = db.orm
      .select()
      .from(s.document_assets)
      .where(eq(s.document_assets.document_id, block.document_id))
      .all()
      .find((row) => row.block_id === block.editing_id);

    if (!root || root.source_id !== content.sourceId || root.revision !== BigInt(content.revision))
      invalid();

    const asset = db.orm
      .select()
      .from(s.source_snapshots)
      .where(
        sql`${s.source_snapshots.source_id}=${root.source_id} AND ${s.source_snapshots.revision}=${root.revision}`
      )
      .get();

    if (!asset || asset.kind !== 'image' || !asset.mime.toLowerCase().startsWith('image/'))
      invalid();
  }

  function revision(blob: typeof s.source_snapshots.$inferSelect) {
    if (!blob.bytes.length) invalid();

    const current = db.orm
      .select()
      .from(s.source_processing)
      .where(eq(s.source_processing.source_id, blob.source_id))
      .get();

    if (current?.revision !== blob.revision) return;

    const bytes = db.orm
      .select()
      .from(s.source_blobs)
      .where(eq(s.source_blobs.source_id, blob.source_id))
      .get()?.bytes;

    if (bytes && !Buffer.from(bytes).equals(Buffer.from(blob.bytes))) invalid();
  }

  return { original, image, revision };
}

export const SourceBackupStore = defineStore({
  name: 'study/SourceBackupStore',
  entity: { singular: 'backupAsset', plural: 'backupAssets' },
  make: (resources) => {
    const { db } = resources;

    const validate = makeAssetValidation(resources);

    return {
      queries: {
        backupAsset: storeQuery({
          role: 'required',
          input: Schema.Void,
          output: Schema.Boolean,
          run: () => {
            for (const source of db.orm.select().from(s.sources).all()) validate.original(source);

            for (const block of db.orm.select().from(s.blocks).all()) validate.image(block);

            for (const blob of db.orm.select().from(s.source_snapshots).all())
              validate.revision(blob);

            return true;
          }
        })
      },
      mutations: {}
    };
  }
});
