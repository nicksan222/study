import * as schema from '@study/db/schema';
import { and, eq } from 'drizzle-orm';

import { source as opSource } from '#backend/procedures/sources/source';
import {
  documentOf as opDocumentOf,
  sourceOfDocument
} from '#backend/procedures/sources/source-document';
import type { ProjectId } from '#backend/shared/ids';
import type { SourceId } from '#backend/shared/ids';
import type { Citation } from '#backend/shared/sources/citations';

import type { BackendContext } from './context.ts';

/** Numbered excerpts and immutable citation snapshots for one generation. */
export class Evidence {
  private readonly store: BackendContext;
  private readonly project: ProjectId;
  private readonly entries = new Map<number, Citation & { inputVersionId?: bigint }>();
  private readonly loaded = new Map<
    SourceId,
    {
      id: string;
      name: string;
      text: string;
    }
  >();
  private readonly used = new Set<number>();
  private next = 1;
  private remaining = 100000;

  constructor(store: BackendContext, project: ProjectId, previous: readonly Citation[] = []) {
    this.store = store;
    this.project = project;

    for (const citation of previous) {
      this.entries.set(citation.marker, structuredClone(citation));
      this.next = Math.max(this.next, citation.marker + 1);
    }
  }

  source(id: SourceId) {
    const cached = this.loaded.get(id);

    if (cached) return cached;

    const requested = opSource(this.store, id);
    const found = opDocumentOf(this.store, id);

    if (!requested || requested.projectId !== this.project || !found) return null;

    const sourceId = sourceOfDocument(this.store, found.id);
    const source = sourceId === null ? null : opSource(this.store, sourceId);

    if (!source || source.projectId !== this.project) return null;

    const inputVersion = this.store.db.orm
      .select({ id: schema.material_versions.id })
      .from(schema.material_document_versions)
      .innerJoin(
        schema.material_versions,
        eq(schema.material_versions.id, schema.material_document_versions.version_id)
      )
      .where(
        and(
          eq(schema.material_document_versions.document_id, found.id),
          eq(schema.material_versions.status, 'published')
        )
      )
      .get();
    const doc = found.document;

    const text: string[] = [];

    for (const block of doc.blocks) {
      if (this.remaining <= 0) break;

      const quote = block.text.trim().slice(0, Math.min(this.remaining, 8000));

      if (!quote) continue;

      this.remaining -= quote.length;
      const marker = this.next++;

      this.entries.set(marker, {
        marker,
        sourceId: source.id,
        ...(inputVersion ? { inputVersionId: inputVersion.id } : {}),
        sourceName: source.name,
        anchor: structuredClone(block.anchor),
        quote
      });
      text.push(`[${marker}] ${quote}`);
    }

    if (!text.length) return null;

    const value = {
      id: String(id),
      name: source.name,
      text: text.join('\n\n')
    };

    this.loaded.set(id, value);

    return value;
  }

  references(markers: readonly number[]) {
    return [...new Set(markers)].filter((marker) => {
      if (!this.entries.has(marker)) return false;

      this.used.add(marker);

      return true;
    });
  }

  text(value: string) {
    const clean = value.replace(/ *\[([0-9+,; ]+)\]/g, (_all, group: string) => {
      const markers = this.references(
        group
          .split(/[,; ]+/)
          .filter(Boolean)
          .map(Number)
      );

      return markers.length ? ` [${markers.join(', ')}]` : '';
    });

    return {
      value: clean,
      citations: this.citations
    };
  }

  get citations() {
    return [...this.entries.values()]
      .filter((c) => this.used.has(c.marker))
      .map((c) => structuredClone(c));
  }
}
