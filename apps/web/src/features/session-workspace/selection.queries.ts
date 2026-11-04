import { selectionReferenceKey } from '@study/contracts/conversations/context';
import type { selectionReferenceSchema } from '@study/contracts/conversations/context';
import { queryOptions } from '@tanstack/react-query';

import { selectedContent } from '#web/lib/study-client/selected-content.ts';

export function selectedContentOptions(input: typeof selectionReferenceSchema.Type) {
  return queryOptions({
    queryKey: [
      input.kind === 'document' ? 'documents' : 'sources',
      'selected-input',
      selectionReferenceKey(input)
    ],
    queryFn: ({ signal }) => selectedContent(input, signal)
  });
}
