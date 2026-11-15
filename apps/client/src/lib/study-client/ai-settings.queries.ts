import { rpc } from '@study/contracts/react';

/** Shares the same canonical live endpoints with account settings and model readiness. */
export function useAiConfiguration() {
  const status = rpc.auth.status.useQuery({});
  const providers = rpc.auth.providers.useQuery({});
  const settings = rpc.settings.llmSettings.useQuery({});
  const queries = [status, providers, settings];

  return {
    data:
      status.data && providers.data && settings.data
        ? { status: status.data, providers: providers.data, settings: settings.data }
        : undefined,
    isPending: queries.some((query) => query.isPending),
    isError: queries.some((query) => query.isError),
    stale: queries.some((query) => query.stale),
    refetch: () => queries.forEach((query) => query.refetch())
  };
}
