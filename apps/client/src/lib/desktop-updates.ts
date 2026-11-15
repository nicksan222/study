import { RegistryContext, useAtomValue } from '@effect/atom-react';
import { Atom } from 'effect/reactivity';
import { useContext } from 'react';

import { useNativeAction, useNativeAsync } from './effect/native.ts';
import { checkDesktopUpdate, hostCapabilities, installDesktopUpdate } from './host.ts';

const installation = Atom.make(false).pipe(Atom.keepAlive);

export function useDesktopUpdate() {
  return useNativeAsync(checkDesktopUpdate, hostCapabilities().updates);
}

/** A shared native installation fence prevents duplicate explicit downloads across mounted controls. */
export function useDesktopInstallation() {
  const registry = useContext(RegistryContext);
  const installing = useAtomValue(installation);
  const action = useNativeAction(async (version: string) => {
    if (registry.get(installation)) return;

    registry.set(installation, true);

    try {
      await installDesktopUpdate(version);
    } finally {
      registry.set(installation, false);
    }
  });

  return { ...action, isPending: installing };
}
