import { z } from 'zod';

import { publicProcedure, idInput } from '#backend/runtime/trpc';
import { StudyError } from '#backend/shared/errors/index';
import type { SourceId } from '#backend/shared/ids';

import { documentOf as dbDocumentOf } from './source-document.ts';
import {
  source as dbSource,
  readSourceBounded as dbReadSourceBounded,
  readSourcePrefix as dbReadSourcePrefix
} from './source.ts';

export const run = publicProcedure
  .input(
    z.object({
      id: idInput
    })
  )
  .query(({ ctx, input }) => {
    const source = dbSource(ctx.store, input.id as SourceId);

    if (!source) throw new StudyError('not_found', 'Source missing');

    if (
      source.kind === 'image' &&
      ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(source.mime)
    ) {
      const bytes = dbReadSourceBounded(ctx.store, source.id, 8 * 1024 * 1024);

      return bytes
        ? {
            type: 'picture' as const,
            bytes
          }
        : {
            type: 'unavailable' as const
          };
    }

    const document = dbDocumentOf(ctx.store, source.id)?.document;
    const text = document?.blocks.map((b) => b.text).join('\n\n');

    if (text)
      return {
        type: 'text' as const,
        text: text.slice(0, 100000)
      };

    if (['text', 'code', 'note', 'web'].includes(source.kind))
      return {
        type: 'text' as const,
        text: new TextDecoder().decode(dbReadSourcePrefix(ctx.store, source.id, 100000))
      };

    return {
      type: 'unavailable' as const
    };
  });
