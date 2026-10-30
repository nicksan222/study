import type { StudyError } from '@study/contracts/errors';
import type { Effect } from 'effect';
import { useCallback, useEffect, useRef, useState } from 'react';

import { runOperation } from './runtime';
import type { Outcome } from './runtime';

export function useAction() {
  const request = useRef<AbortController | undefined>(undefined);
  const mounted = useRef(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);

  const run = useCallback(
    async <A>(operation: Effect.Effect<A, StudyError>): Promise<Outcome<A>> => {
      if (!mounted.current || request.current) return { status: 'cancelled' };

      const controller = new AbortController();

      request.current = controller;
      setPending(true);
      const outcome = await runOperation(operation, controller.signal);

      if (request.current === controller) request.current = undefined;

      if (!mounted.current || controller.signal.aborted) return { status: 'cancelled' };

      setPending(false);

      return outcome;
    },
    []
  );

  return { run, pending };
}
