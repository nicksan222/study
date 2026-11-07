import { sql, defineTable, text, integer, blob, check, index } from '../schema-builder.ts';

/** Derived search data is rebuildable from canonical feature records. */
export const semantic_search_entries = defineTable({
  role: 'internal',
  reason: 'Derived local embeddings are accessed only through scoped semantic retrieval.'
})(
  'semantic_search_entries',
  {
    key: text().primaryKey(),
    kind: text().notNull(),
    target: text().notNull(),
    fingerprint: text().notNull(),
    model: text().notNull(),
    dimensions: integer().notNull(),
    title: text().notNull(),
    text: text().notNull(),
    embedding: blob({ mode: 'buffer' }).notNull()
  },
  (t) => [
    index('semantic_search_model_idx').on(t.model, t.kind),
    check('semantic_search_target_json', sql`json_valid(${t.target})`),
    check(
      'semantic_search_vector_size',
      sql`${t.dimensions}>0 AND length(${t.embedding})=${t.dimensions}*4`
    )
  ]
);
