import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void) {
  const media = window.matchMedia('(max-width: 600px)');

  media.addEventListener('change', onChange);

  return () => media.removeEventListener('change', onChange);
}

function snapshot() {
  return window.matchMedia('(max-width: 600px)').matches;
}

/** Shares the notebook's phone breakpoint without replacing explicit layout choices. */
export function usePhoneLayout() {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
