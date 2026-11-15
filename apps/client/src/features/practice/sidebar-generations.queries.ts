import { RegistryContext, useAtomValue } from '@effect/atom-react';
import { rpc } from '@study/contracts/react';
import { Atom } from 'effect/reactivity';
import { useContext } from 'react';

const generationRetry = Atom.family((_requestId: string) =>
  Atom.make<{ key: string; acknowledged: boolean } | null>(null).pipe(Atom.keepAlive)
);

/** An uncertain transport receipt retains its intent across navigation and caller remounts. */
export function useGenerationRetry(requestId: string) {
  const registry = useContext(RegistryContext);
  const atom = generationRetry(requestId);
  const attempt = useAtomValue(atom);
  const operation = rpc.materials.retryMaterialGeneration.useMutation();
  const execution = rpc.workflows.executions.useQuery(
    attempt ? { correlationId: requestId, eventId: attempt.key, limit: 30 } : undefined
  );
  const admitted = execution.data?.items[0];
  const failed = admitted?.outcome === 'failure';
  const waiting = !!attempt && !failed && (attempt.acknowledged || !!admitted);

  return {
    isPending: operation.isPending || waiting,
    isError: operation.isError && !admitted,
    retry() {
      if (operation.isPending || waiting) return;

      const key = attempt && !failed ? attempt.key : crypto.randomUUID();

      registry.set(atom, { key, acknowledged: false });
      void operation.mutate({ requestId, retryId: key }).then(
        () => registry.set(atom, { key, acknowledged: true }),
        () => {}
      );
    }
  };
}
