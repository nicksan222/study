import { test } from '@study/testing';

import {
  createThemeStore,
  applyThemeToDocument,
  resolveTheme,
  observeSystemAppearance
} from './theme.ts';

test.stable('resolves appearance and merges common and variant overrides', () => {
  const theme = {
    colors: { background: 'red', foreground: 'white' },
    dark: { background: 'black' }
  } as const;

  test.expect(resolveTheme(theme, 'system', 'dark')).toStrictEqual({
    appearance: 'dark',
    colors: { background: 'black', foreground: 'white' }
  });
  test.assert.strictEqual(resolveTheme(theme, 'light', 'dark').appearance, 'light');
});

test.stable('store snapshots are immutable, stable, and notify only on changes', () => {
  const colors = { background: 'red' };
  const store = createThemeStore({
    theme: { colors },
    appearance: 'system',
    systemAppearance: 'light'
  });
  const initial = store.getSnapshot();

  colors.background = 'blue';
  test.assert.strictEqual(initial.colors.background, 'red');
  test.assert.ok(Object.isFrozen(initial.colors));
  let calls = 0;
  const unsubscribe = store.subscribe(() => calls++);

  store.setSystemAppearance('light');
  test.assert.strictEqual(store.getSnapshot(), initial);
  store.setSystemAppearance('dark');
  test.assert.strictEqual(calls, 1);
  test.assert.strictEqual(store.getSnapshot().appearance, 'dark');
  unsubscribe();
  store.setAppearance('light');
  test.assert.strictEqual(calls, 1);
});

test.stable('DOM adapter removes stale variables when themes change and cleans up', () => {
  const element = document.documentElement;
  const store = createThemeStore({
    theme: { light: { background: 'red', foreground: 'white' }, dark: { background: 'black' } },
    appearance: 'light'
  });
  const cleanup = applyThemeToDocument(store, document);

  test.assert.strictEqual(element.style.getPropertyValue('--foreground'), 'white');
  store.setAppearance('dark');
  test.assert.strictEqual(element.style.getPropertyValue('--foreground'), '');
  test.assert.strictEqual(element.style.getPropertyValue('--background'), 'black');
  test.assert.strictEqual(element.style.colorScheme, 'dark');
  test.assert.ok(element.classList.contains('dark'));
  cleanup();
  store.setAppearance('light');
  test.assert.strictEqual(element.style.getPropertyValue('--background'), '');
});

test.stable('system appearance observer updates store and removes listener', () => {
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

  test.assert.strictEqual(store.getSnapshot().appearance, 'dark');
  listener?.({ matches: false });
  test.assert.strictEqual(store.getSnapshot().appearance, 'light');
  cleanup();
  test.assert.strictEqual(listener, undefined);
});

test.stable('undefined overrides inherit common colors or release the previous override', () => {
  test
    .expect(
      resolveTheme({ colors: { background: 'red' }, dark: { background: undefined } }, 'dark')
        .colors
    )
    .toStrictEqual({ background: 'red' });
  const element = document.documentElement;
  const store = createThemeStore({ theme: { colors: { background: 'red' } } });
  const cleanup = applyThemeToDocument(store, document);

  store.setTheme({ colors: { background: undefined } });
  test.assert.strictEqual(element.style.getPropertyValue('--background'), '');
  test.expect(store.getSnapshot().colors).toStrictEqual({});
  cleanup();
});

test.stable('document adapter restores existing inline declarations and priorities', () => {
  const element = document.documentElement;

  element.style.setProperty('--background', 'blue', 'important');
  element.style.setProperty('color-scheme', 'light dark', 'important');
  element.classList.add('dark');
  const store = createThemeStore({ appearance: 'light', theme: { colors: { background: 'red' } } });
  const cleanup = applyThemeToDocument(store, document);

  test.assert.strictEqual(element.style.getPropertyValue('--background'), 'red');
  cleanup();
  test.assert.strictEqual(element.style.getPropertyValue('--background'), 'blue');
  test.assert.strictEqual(element.style.getPropertyPriority('--background'), 'important');
  test.assert.strictEqual(element.style.getPropertyValue('color-scheme'), 'light dark');
  test.assert.strictEqual(element.style.getPropertyPriority('color-scheme'), 'important');
  test.assert.ok(element.classList.contains('dark'));
  element.style.removeProperty('--background');
  element.style.removeProperty('color-scheme');
  element.classList.remove('dark');
});
