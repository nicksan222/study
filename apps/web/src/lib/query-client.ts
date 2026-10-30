import { QueryClient } from '@tanstack/react-query';

export function createStudyQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: false },
      mutations: { retry: false }
    }
  });
}
