import type { SourceId } from '@study/contracts/ids';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { request } from '#web/lib/study-client/request.ts';

const modelOptions = () =>
  queryOptions({
    queryKey: ['transcription-model'],
    queryFn: ({ signal }) => request((rpc) => rpc['sources.transcriptionModelStatus']({}), signal),
    staleTime: 30_000
  });

export function useTranscriptionModel() {
  const cache = useQueryClient();
  const query = useQuery(modelOptions());
  const install = useMutation({
    mutationFn: () => request((rpc) => rpc['sources.installTranscriptionModel']({})),
    onSuccess: (value) => cache.setQueryData(modelOptions().queryKey, value)
  });

  return { query, install };
}

export function useSourceTranscription(id: SourceId) {
  const cache = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const current = await request((rpc) => rpc['sources.sourceProcessing']({ id }));

      return request((rpc) =>
        rpc['sources.requestSourceProcessing']({ id, expectedRevision: current.revision })
      );
    },
    onSuccess: () =>
      Promise.all([
        cache.invalidateQueries({ queryKey: ['sources', 'current-extraction', String(id)] }),
        cache.invalidateQueries({ queryKey: ['source-transcription', String(id)] })
      ])
  });
}

export const audioCapabilityOptions = (mime: string) =>
  queryOptions({
    queryKey: ['audio-capability', mime],
    queryFn: ({ signal }) =>
      request((rpc) => rpc['sources.importCapability']({ kind: 'audio', mime }), signal),
    staleTime: 30_000
  });

export function useTranscriptionState(id: SourceId) {
  const processing = useQuery({
    queryKey: ['source-transcription', String(id)],
    queryFn: ({ signal }) => request((rpc) => rpc['sources.sourceProcessing']({ id }), signal),
    refetchInterval: 3000
  });
  const execution = useQuery({
    queryKey: ['source-transcription-execution', processing.data?.requestId],
    queryFn: ({ signal }) =>
      request(
        (rpc) =>
          rpc['workflows.executions']({ correlationId: processing.data!.requestId!, limit: 1 }),
        signal
      ),
    enabled: !!processing.data?.requestId,
    refetchInterval: 3000
  });
  const last = execution.data?.items[0];

  return {
    active: !!last && ['running', 'cancelling'].includes(last.status),
    failed: last?.outcome === 'failure'
  };
}
