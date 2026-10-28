import {
  readSourceBounded,
  readSourcePrefix,
  source
} from '#backend/procedures/sources/operations/source';
import { documentOf } from '#backend/procedures/sources/operations/source-document';
import { publicProcedure } from '#backend/runtime/trpc';
import { StudyError } from '#backend/shared/errors/index';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ ctx, input }) => {
    const found = source(ctx.store, input.id);

    if (!found) throw new StudyError('not_found', 'Source missing');

    if (
      found.kind === 'image' &&
      ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(found.mime)
    ) {
      const bytes = readSourceBounded(ctx.store, found.id, 8 * 1024 * 1024);

      return bytes ? { type: 'picture' as const, bytes } : { type: 'unavailable' as const };
    }

    const document = documentOf(ctx.store, found.id)?.document;
    const text = document?.blocks.map((block) => block.text).join('\n\n');

    if (text) return { type: 'text' as const, text: text.slice(0, 100000) };

    if (['text', 'code', 'note', 'web'].includes(found.kind))
      return {
        type: 'text' as const,
        text: new TextDecoder().decode(readSourcePrefix(ctx.store, found.id, 100000))
      };

    return { type: 'unavailable' as const };
  });
