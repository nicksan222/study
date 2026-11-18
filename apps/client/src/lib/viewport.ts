import { useCallback, useSyncExternalStore } from 'react';

/** Phone layouts keep the platform's scale even when a desktop zoom was saved. */
export const phoneViewportQuery = '(pointer: coarse) and (max-width: 1024px)';

const narrowLayoutQuery = `(max-width: 640px), ${phoneViewportQuery}`;

function useViewport(query: string) {
  const subscribe = useCallback(
    (listener: () => void) => {
      const media = window.matchMedia(query);

      media.addEventListener('change', listener);

      return () => media.removeEventListener('change', listener);
    },
    [query]
  );
  const matches = useCallback(() => window.matchMedia(query).matches, [query]);

  return useSyncExternalStore(subscribe, matches, () => false);
}

export function useNarrowLayout() {
  return useViewport(narrowLayoutQuery);
}

export function usePhoneViewport() {
  return useViewport(phoneViewportQuery);
}
