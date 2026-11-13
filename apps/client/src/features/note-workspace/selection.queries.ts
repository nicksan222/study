import { selectionReferenceKey } from '@study/contracts/notes/context';
import type { selectionReferenceSchema } from '@study/contracts/notes/context';
import { queryOptions } from '@tanstack/react-query';

import { selectedContent } from '#client/lib/study-client/selected-content.ts';

export function selectedContentOptions(input: typeof selectionReferenceSchema.Type) {
  return queryOptions({
    queryKey: [
      input.kind === 'page' ? 'pages' : 'sources',
      'selected-input',
      selectionReferenceKey(input)
    ],
    queryFn: ({ signal }) => selectedContent(input, signal)
  });
}
