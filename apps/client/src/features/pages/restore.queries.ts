import { RegistryContext, useAtom } from '@effect/atom-react';
import type { restoreSchema, Page, PageVersion } from '@study/contracts';
import { rpc, useIndependentMutation } from '@study/contracts/react';
import { Effect } from 'effect';
import { Atom } from 'effect/reactivity';
import { useContext } from 'react';

import { toStudyError } from '#client/lib/study-client/errors.ts';

type Input = typeof restoreSchema.Type;

const attempts = Atom.family((_key: string) =>
  Atom.make<Input | undefined>(undefined).pipe(Atom.keepAlive)
);

/** Keep the same explicit idempotency key after an uncertain response. */
export function usePageRestore(page: Page, version: PageVersion, onRestored: () => void) {
  const atom = attempts(`${page.id}:${version.id}`);
  const registry = useContext(RegistryContext);
  const [, setAttempt] = useAtom(atom);

  return useIndependentMutation((_input: void) =>
    Effect.tryPromise({
      try: async () => {
        if (page.headVersionId === null) throw new Error('Page has no current version');

        const input = registry.get(atom) ?? {
          pageId: page.id,
          expectedVersionId: page.headVersionId,
          restoreVersionId: version.id,
          key: crypto.randomUUID()
        };

        setAttempt(input);
        const outcome = await rpc.pages.restore.call(input);

        setAttempt(undefined);

        if (outcome.outcome === 'saved') onRestored();

        return outcome;
      },
      catch: toStudyError
    })
  );
}
