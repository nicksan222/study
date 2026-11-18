import { useSyncExternalStore } from 'react';

/** Phone layouts keep the platform's scale even when a desktop zoom was saved. */
export const mobileViewportQuery = '(max-width: 640px), (pointer: coarse) and (max-width: 1024px)';

function subscribe(listener: () => void) {
  const media = window.matchMedia(mobileViewportQuery);

  media.addEventListener('change', listener);

  return () => media.removeEventListener('change', listener);
}

function isMobileViewport() {
  return window.matchMedia(mobileViewportQuery).matches;
}

export function useMobileViewport() {
  return useSyncExternalStore(subscribe, isMobileViewport, () => false);
}
