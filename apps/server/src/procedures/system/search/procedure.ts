import { message as opMessage } from '#server/procedures/conversations/operations/messages';
import { session as opSession } from '#server/procedures/conversations/operations/session';
import { project as opProject } from '#server/procedures/projects/operations/read-projects';
import { source as opSource } from '#server/procedures/sources/operations/source';
import { search as opSearch } from '#server/procedures/system/operations/search';
import { publicProcedure } from '#server/runtime/trpc';
import type { Anchor } from '#server/shared/sources/document';
import type { SourceKind } from '#server/shared/sources/sniff';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

type SearchView = {
  kind: 'project' | 'session' | 'message' | 'source';
  title: string;
  at: bigint;
  context?: string;
  excerpt?: string;
  fileKind?: SourceKind;
  target:
    | { type: 'project'; id: bigint }
    | { type: 'session'; projectId: bigint; sessionId: bigint }
    | { type: 'source'; sourceId: bigint; anchor?: Anchor };
};

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ ctx, input }) => {
    const store = ctx.store;
    const hits = opSearch(store, input.query, {
      projectId: input.project ?? undefined,
      kinds: input.kinds
        ? [...input.kinds]
        : ['project', 'session', 'message', 'source', 'passage'],
      limit: input.limit || 30
    });

    return {
      semantic: false,
      hits: hits.flatMap((hit): SearchView[] => {
        const target = hit.target;

        if (target.type === 'project') {
          const p = opProject(store, target.id);

          return p
            ? [
                {
                  kind: 'project',
                  title: p.name,
                  at: p.updatedAt,
                  target: {
                    type: 'project',
                    id: p.id
                  }
                }
              ]
            : [];
        }

        if (target.type === 'session' || target.type === 'message') {
          const msg = target.type === 'message' ? opMessage(store, target.id) : null;
          const sessionId = target.type === 'session' ? target.id : msg?.sessionId;
          const session = sessionId ? opSession(store, sessionId) : null;

          return session
            ? [
                {
                  kind: msg ? 'message' : 'session',
                  title: session.title,
                  excerpt: hit.text,
                  at: msg?.createdAt ?? session.updatedAt,
                  target: {
                    type: 'session',
                    projectId: session.projectId,
                    sessionId: session.id
                  }
                }
              ]
            : [];
        }

        if (target.type === 'source' || target.type === 'passage') {
          const source = opSource(store, target.type === 'source' ? target.id : target.sourceId);

          return source
            ? [
                {
                  kind: 'source',
                  title: source.name,
                  context: source.projectName ?? undefined,
                  excerpt: hit.text,
                  fileKind: source.kind,
                  at: source.createdAt,
                  target: {
                    type: 'source',
                    sourceId: source.id,
                    anchor: target.type === 'passage' ? target.anchor : undefined
                  }
                }
              ]
            : [];
        }

        return [];
      })
    };
  });
