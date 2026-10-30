import type { ProjectId, MaterialId, MaterialVersionId } from '@study/contracts/ids';
import { materialKindSchema } from '@study/contracts/materials/schemas';
import { searchInputSchema } from '@study/contracts/system/rpc';
import { searchHitSchema } from '@study/contracts/system/schemas';
import { eq, sql } from '@study/db';
import * as schema from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeQuery } from '#server/platform/definitions/define-store';

import { makeSearch } from './search.ts';

type SearchHit = ReturnType<ReturnType<typeof makeSearch>['search']>[number];

export const SystemStore = defineStore({
  name: 'study/SystemStore',
  entity: { singular: 'search', plural: 'searches' },
  make: ({ db, clock }) => {
    const { search } = makeSearch({ db, clock });

    function presentProject(
      target: Extract<SearchHit['target'], { type: 'project' }>
    ): (typeof searchHitSchema.Type)[] {
      const p = db.orm
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, target.id))
        .get();

      return p
        ? [
            {
              kind: 'project',
              title: p.name,
              at: p.updated_at,
              target: { type: 'project', id: p.id }
            }
          ]
        : [];
    }

    function presentConversation(
      hit: SearchHit,
      target: Extract<SearchHit['target'], { type: 'session' | 'message' }>
    ): (typeof searchHitSchema.Type)[] {
      const msg =
        target.type === 'message'
          ? db.orm.select().from(schema.messages).where(eq(schema.messages.id, target.id)).get()
          : undefined;
      const id = target.type === 'session' ? target.id : msg?.session_id;
      const session =
        id === undefined
          ? undefined
          : db.orm.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get();

      return session
        ? [
            {
              kind: msg ? 'message' : 'session',
              title: session.title,
              excerpt: hit.text,
              at: msg?.created_at ?? session.updated_at,
              target: {
                type: 'session',
                projectId: session.project_id,
                sessionId: session.id
              }
            }
          ]
        : [];
    }

    function presentSource(
      hit: SearchHit,
      target: Extract<SearchHit['target'], { type: 'source' | 'passage' }>
    ): (typeof searchHitSchema.Type)[] {
      const source = db.orm
        .select()
        .from(schema.sources)
        .where(eq(schema.sources.id, target.type === 'source' ? target.id : target.sourceId))
        .get();

      if (!source) return [];

      const project =
        source.project_id === null
          ? undefined
          : db.orm
              .select()
              .from(schema.projects)
              .where(eq(schema.projects.id, source.project_id))
              .get();

      return [
        {
          kind: 'source',
          title: source.name,
          context: project?.name,
          excerpt: hit.text,
          fileKind: source.kind,
          at: source.created_at,
          target: {
            type: 'source',
            sourceId: source.id,
            anchor: target.type === 'passage' ? target.anchor : undefined
          }
        }
      ];
    }

    function presentMaterial(
      hit: SearchHit,
      target: Extract<SearchHit['target'], { type: 'material' | 'question' }>
    ): (typeof searchHitSchema.Type)[] {
      const rows = db.orm.all(
        sql`SELECT m.id AS material_id,m.project_id,m.kind AS material_kind,m.title,m.updated_at,v.id AS version_id,q.id AS question_id FROM materials m JOIN material_versions v ON v.material_id=m.id AND v.status='published' AND v.number=(SELECT max(h.number) FROM material_versions h WHERE h.material_id=m.id AND h.status='published') LEFT JOIN material_quiz_questions q ON q.version_id=v.id WHERE m.archived_at IS NULL AND ((${target.type}='material' AND m.id=${target.id}) OR (${target.type}='question' AND q.id=${target.id})) LIMIT 1`
      );
      const row = rows[0];

      if (!row) return [];

      const projectId = BigInt(row.project_id as number | bigint) as ProjectId;
      const materialId = BigInt(row.material_id as number | bigint) as MaterialId;
      const versionId = BigInt(row.version_id as number | bigint) as MaterialVersionId;

      return [
        {
          kind: target.type,
          title: row.title as string,
          excerpt: hit.text,
          at: BigInt(row.updated_at as number | bigint),
          target:
            target.type === 'material'
              ? {
                  type: 'material',
                  projectId,
                  materialId,
                  versionId,
                  materialKind: Schema.decodeUnknownSync(materialKindSchema)(row.material_kind)
                }
              : {
                  type: 'question',
                  projectId,
                  materialId,
                  versionId,
                  questionId: target.id
                }
        }
      ];
    }

    return {
      queries: {
        searches: storeQuery({
          role: 'collection',
          input: searchInputSchema,
          output: Schema.Array(searchHitSchema),
          run: (input) =>
            search(input.query, {
              projectId: input.project ?? undefined,
              kinds: input.kinds,
              limit: input.limit
            }).flatMap((hit): (typeof searchHitSchema.Type)[] => {
              const target = hit.target;

              if (target.type === 'project') return presentProject(target);

              if (target.type === 'session' || target.type === 'message')
                return presentConversation(hit, target);

              if (target.type === 'source' || target.type === 'passage')
                return presentSource(hit, target);

              if (target.type === 'material' || target.type === 'question')
                return presentMaterial(hit, target);

              return [];
            })
        })
      },
      mutations: {}
    };
  }
});

export const HealthStore = defineStore({
  name: 'study/SystemHealthStore',
  entity: { singular: 'health', plural: 'healths' },
  make: ({ db }) => ({
    queries: {
      health: storeQuery({
        role: 'required',
        input: Schema.Void,
        output: Schema.Boolean,
        run: () => {
          db.orm.select().from(schema.projects).limit(1).all();

          return true;
        }
      })
    },
    mutations: {}
  })
});
