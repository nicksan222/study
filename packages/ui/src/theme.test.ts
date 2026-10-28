import assert from 'node:assert/strict';

import { test } from 'vite-plus/test';

import {
  createThemeStore,
  applyThemeToDocument,
  resolveTheme,
  observeSystemAppearance
} from './theme.ts';

test('resolves appearance and merges common and variant overrides', () => {
  const theme = {
    colors: { background: 'red', foreground: 'white' },
    dark: { background: 'black' }
  } as const;

  assert.deepEqual(resolveTheme(theme, 'system', 'dark'), {
    appearance: 'dark',
    colors: { background: 'black', foreground: 'white' }
  });
  assert.equal(resolveTheme(theme, 'light', 'dark').appearance, 'light');
});

test('store snapshots are immutable, stable, and notify only on changes', () => {
  const colors = { background: 'red' };
  const store = createThemeStore({
    theme: { colors },
    appearance: 'system',
    systemAppearance: 'light'
  });
  const initial = store.getSnapshot();

  colors.background = 'blue';
  assert.equal(initial.colors.background, 'red');
  assert.ok(Object.isFrozen(initial.colors));
  let calls = 0;
  const unsubscribe = store.subscribe(() => calls++);

  store.setSystemAppearance('light');
  assert.equal(store.getSnapshot(), initial);
  store.setSystemAppearance('dark');
  assert.equal(calls, 1);
  assert.equal(store.getSnapshot().appearance, 'dark');
  unsubscribe();
  store.setAppearance('light');
  assert.equal(calls, 1);
});

test('DOM adapter removes stale variables when themes change and cleans up', () => {
  const element = document.documentElement;
  const store = createThemeStore({
    theme: { light: { background: 'red', foreground: 'white' }, dark: { background: 'black' } },
    appearance: 'light'
  });
  const cleanup = applyThemeToDocument(store, document);

  assert.equal(element.style.getPropertyValue('--foreground'), 'white');
  store.setAppearance('dark');
  assert.equal(element.style.getPropertyValue('--foreground'), '');
  assert.equal(element.style.getPropertyValue('--background'), 'black');
  assert.equal(element.style.colorScheme, 'dark');
  assert.ok(element.classList.contains('dark'));
  cleanup();
  store.setAppearance('light');
  assert.equal(element.style.getPropertyValue('--background'), '');
});

test('system appearance observer updates store and removes listener', () => {
  let listener: ((event: { matches: boolean }) => void) | undefined;
  const media = {
    matches: true,
    addEventListener(_type: string, fn: typeof listener) {
      listener = fn;
    },
    removeEventListener(_type: string, fn: typeof listener) {
      if (listener === fn) listener = undefined;
    }
  };
  const store = createThemeStore();
  const cleanup = observeSystemAppearance(store, media as unknown as MediaQueryList);

  assert.equal(store.getSnapshot().appearance, 'dark');
  listener?.({ matches: false });
  assert.equal(store.getSnapshot().appearance, 'light');
  cleanup();
  assert.equal(listener, undefined);
});

test('undefined overrides inherit common colors or release the previous override', () => {
  assert.deepEqual(
    resolveTheme({ colors: { background: 'red' }, dark: { background: undefined } }, 'dark').colors,
    { background: 'red' }
  );
  const element = document.documentElement;
  const store = createThemeStore({ theme: { colors: { background: 'red' } } });
  const cleanup = applyThemeToDocument(store, document);

  store.setTheme({ colors: { background: undefined } });
  assert.equal(element.style.getPropertyValue('--background'), '');
  assert.deepEqual(store.getSnapshot().colors, {});
  cleanup();
});

test('document adapter restores existing inline declarations and priorities', () => {
  const element = document.documentElement;

  element.style.setProperty('--background', 'blue', 'important');
  element.style.setProperty('color-scheme', 'light dark', 'important');
  element.classList.add('dark');
  const store = createThemeStore({ appearance: 'light', theme: { colors: { background: 'red' } } });
  const cleanup = applyThemeToDocument(store, document);

  assert.equal(element.style.getPropertyValue('--background'), 'red');
  cleanup();
  assert.equal(element.style.getPropertyValue('--background'), 'blue');
  assert.equal(element.style.getPropertyPriority('--background'), 'important');
  assert.equal(element.style.getPropertyValue('color-scheme'), 'light dark');
  assert.equal(element.style.getPropertyPriority('color-scheme'), 'important');
  assert.ok(element.classList.contains('dark'));
  element.style.removeProperty('--background');
  element.style.removeProperty('color-scheme');
  element.classList.remove('dark');
});
