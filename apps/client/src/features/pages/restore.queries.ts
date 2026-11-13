import type { restoreSchema } from '@study/contracts/pages/editing';
import type { Page, PageVersion } from '@study/contracts/pages/types';
import type { QueryClient } from '@tanstack/react-query';

import { request } from '#client/lib/study-client/request.ts';

export function restorePageOptions(cache: QueryClient, page: Page, version: PageVersion) {
  const attemptKey = ['page-restore-attempt', String(page.id), String(version.id)];

  cache.setQueryDefaults(['page-restore-attempt'], { gcTime: Infinity });

  return {
    mutationFn: async () => {
      const input = cache.getQueryData<typeof restoreSchema.Type>(attemptKey) ?? {
        pageId: page.id,
        expectedVersionId: page.headVersionId!,
        restoreVersionId: version.id,
        key: crypto.randomUUID()
      };

      cache.setQueryData(attemptKey, input);

      return request((rpc) => rpc['pages.restore'](input));
    }
  };
}
