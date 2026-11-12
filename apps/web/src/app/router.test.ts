import { testStable } from '@study/testing/vitest';
import { createMemoryHistory, redirect } from '@tanstack/react-router';
import { afterEach, expect, vi } from 'vite-plus/test';
import type {} from 'vite-plus/test/jsdom';

import { createAppRouter } from './router';

const originalUrl = window.location.href;

afterEach(() => {
  vi.unstubAllGlobals();
  jsdom.reconfigure({ url: originalUrl });
});

testStable.each([
  { url: 'tauri://localhost', origin: 'tauri://localhost', calculationOrigin: 'http://localhost' },
  { url: 'tauri://localhost', origin: 'null', calculationOrigin: 'http://localhost' },
  {
    url: 'http://tauri.localhost',
    origin: 'http://tauri.localhost',
    calculationOrigin: 'http://tauri.localhost'
  },
  {
    url: 'https://tauri.localhost',
    origin: 'https://tauri.localhost',
    calculationOrigin: 'https://tauri.localhost'
  },
  {
    url: 'https://example.com',
    origin: 'https://example.com',
    calculationOrigin: 'https://example.com'
  }
])(
  'loads startup redirects with internal paths at $url with origin $origin',
  async ({ url, origin, calculationOrigin }) => {
    jsdom.reconfigure({ url: `${url}/` });
    vi.stubGlobal('origin', origin);

    const history = createMemoryHistory({ initialEntries: ['/'] });
    const router = createAppRouter(history);

    try {
      expect(router.origin).toBe(calculationOrigin);
      expect(router.buildLocation({ to: '/home' }).publicHref).toBe('/home');
      await router.load();
      expect(router.state.location.pathname).toBe('/notes');
      expect(router.state.status).toBe('idle');
      expect(router.state.matches.every((match) => match.status === 'success')).toBe(true);
    } finally {
      router.options.context.queryClient.clear();
    }
  }
);

testStable('preserves project identity, navigation history, and external URL safety', async () => {
  vi.stubGlobal('origin', 'tauri://localhost');

  const history = createMemoryHistory({ initialEntries: ['/home?project=9007199254740993'] });
  const router = createAppRouter(history);
  const unsubscribe = history.subscribe(() => void router.load());

  try {
    expect(history.location.href).toBe('/projects/9007199254740993/home');
    await router.load();
    expect(router.state.location.publicHref).toBe('/projects/9007199254740993/notes');
    expect(router.state.location.search.project).toBe('9007199254740993');
    const link = router.buildLocation({
      to: '/projects',
      search: { project: '9007199254740993' }
    });

    expect(link.publicHref).toBe('/projects/9007199254740993');
    expect(link.external).toBe(false);
    expect(router.protocolAllowlist.has('tauri:')).toBe(false);
    expect(router.protocolAllowlist.has('javascript:')).toBe(false);
    expect(() => router.resolveRedirect(redirect({ href: 'javascript:alert(1)' }))).toThrow();
    expect(() =>
      router.resolveRedirect(redirect({ href: 'tauri://localhost/projects' }))
    ).toThrow();
    await router.navigate({ to: '/notes', search: { project: '2' } });
    expect(history.location.href).toBe('/projects/2/notes');
    history.back();
    await vi.waitFor(() => {
      expect(router.state.location.publicHref).toBe('/projects/9007199254740993/notes');
      expect(router.state.status).toBe('idle');
      expect(router.state.matches.every((match) => match.status === 'success')).toBe(true);
    });
    history.forward();
    await vi.waitFor(() => {
      expect(router.state.location.publicHref).toBe('/projects/2/notes');
      expect(router.state.status).toBe('idle');
      expect(router.state.matches.every((match) => match.status === 'success')).toBe(true);
    });
  } finally {
    unsubscribe();
    router.options.context.queryClient.clear();
  }
});

testStable.each([
  { zoom: '', reduced: false, enabled: false },
  { zoom: '100%', reduced: false, enabled: true },
  { zoom: '125%', reduced: false, enabled: false },
  { zoom: '100%', reduced: true, enabled: false }
])(
  'uses navigation snapshots=$enabled at zoom=$zoom, reduced motion=$reduced',
  async ({ zoom, reduced, enabled }) => {
    const originalZoom = document.documentElement.style.zoom;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const nativeTransition = vi.fn((update: () => Promise<void>) => ({
      updateCallbackDone: update()
    }));

    vi.spyOn(window, 'matchMedia').mockReturnValue({ ...media, matches: reduced });

    const previousTransition = document.startViewTransition;

    document.startViewTransition =
      nativeTransition as unknown as typeof document.startViewTransition;
    document.documentElement.style.zoom = zoom;

    const router = createAppRouter(createMemoryHistory({ initialEntries: ['/notes'] }));

    try {
      await router.load();
      nativeTransition.mockClear();

      const update = vi.fn(async () => {});

      await router.startViewTransition(update);
      expect(update).toHaveBeenCalledOnce();
      expect(nativeTransition).toHaveBeenCalledTimes(enabled ? 1 : 0);
    } finally {
      document.startViewTransition = previousTransition;
      document.documentElement.style.zoom = originalZoom;
      router.options.context.queryClient.clear();
    }
  }
);
