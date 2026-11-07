import type { UsageQuery } from '@study/contracts/settings/usage';
import { queryOptions } from '@tanstack/react-query';

import { request } from '#web/lib/study-client/request.ts';

export const usageQueryOptions = (days: UsageQuery['days'], provider: string) =>
  queryOptions({
    queryKey: ['ai-usage', days, provider],
    queryFn: ({ signal }) =>
      request(
        (client) => client['settings.usage']({ days, ...(provider ? { provider } : {}) }),
        signal
      ),
    refetchInterval: 30000
  });
