import { test } from '@study/testing';

import {
  createThemeStore,
  applyThemeToDocument,
  resolveTheme,
  observeSystemAppearance
} from './theme.ts';

test.unit.stable(
  'resolves appearance and merges common and variant overrides',
  ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    const theme = {
      colors: { background: 'red', foreground: 'white' },
      dark: { background: 'black' }
    } as const;

    expect(resolveTheme(theme, 'system', 'dark')).toStrictEqual({
      appearance: 'dark',
      colors: { background: 'black', foreground: 'white' }
    });
    assert.strictEqual(resolveTheme(theme, 'light', 'dark').appearance, 'light');
  }
);

test.unit.stable(
  'store snapshots are immutable, stable, and notify only on changes',
  ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const colors = { background: 'red' };
    const store = createThemeStore({
      theme: { colors },
      appearance: 'system',
      systemAppearance: 'light'
    });
    const initial = store.getSnapshot();

    colors.background = 'blue';
    assert.strictEqual(initial.colors.background, 'red');
    assert.ok(Object.isFrozen(initial.colors));
    let calls = 0;
    const unsubscribe = store.subscribe(() => calls++);

    store.setSystemAppearance('light');
    assert.strictEqual(store.getSnapshot(), initial);
    store.setSystemAppearance('dark');
    assert.strictEqual(calls, 1);
    assert.strictEqual(store.getSnapshot().appearance, 'dark');
    unsubscribe();
    store.setAppearance('light');
    assert.strictEqual(calls, 1);
  }
);

test.unit.stable(
  'DOM adapter removes stale variables when themes change and cleans up',
  ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const element = document.documentElement;
    const store = createThemeStore({
      theme: { light: { background: 'red', foreground: 'white' }, dark: { background: 'black' } },
      appearance: 'light'
    });
    const cleanup = applyThemeToDocument(store, document);

    assert.strictEqual(element.style.getPropertyValue('--foreground'), 'white');
    store.setAppearance('dark');
    assert.strictEqual(element.style.getPropertyValue('--foreground'), '');
    assert.strictEqual(element.style.getPropertyValue('--background'), 'black');
    assert.strictEqual(element.style.colorScheme, 'dark');
    assert.ok(element.classList.contains('dark'));
    cleanup();
    store.setAppearance('light');
    assert.strictEqual(element.style.getPropertyValue('--background'), '');
  }
);

test.unit.stable(
  'system appearance observer updates store and removes listener',
  ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

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

    assert.strictEqual(store.getSnapshot().appearance, 'dark');
    listener?.({ matches: false });
    assert.strictEqual(store.getSnapshot().appearance, 'light');
    cleanup();
    assert.strictEqual(listener, undefined);
  }
);

test.unit.stable(
  'undefined overrides inherit common colors or release the previous override',
  ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(
      resolveTheme({ colors: { background: 'red' }, dark: { background: undefined } }, 'dark')
        .colors
    ).toStrictEqual({ background: 'red' });
    const element = document.documentElement;
    const store = createThemeStore({ theme: { colors: { background: 'red' } } });
    const cleanup = applyThemeToDocument(store, document);

    store.setTheme({ colors: { background: undefined } });
    assert.strictEqual(element.style.getPropertyValue('--background'), '');
    expect(store.getSnapshot().colors).toStrictEqual({});
    cleanup();
  }
);

test.unit.stable(
  'document adapter restores existing inline declarations and priorities',
  ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const element = document.documentElement;

    element.style.setProperty('--background', 'blue', 'important');
    element.style.setProperty('color-scheme', 'light dark', 'important');
    element.classList.add('dark');
    const store = createThemeStore({
      appearance: 'light',
      theme: { colors: { background: 'red' } }
    });
    const cleanup = applyThemeToDocument(store, document);

    assert.strictEqual(element.style.getPropertyValue('--background'), 'red');
    cleanup();
    assert.strictEqual(element.style.getPropertyValue('--background'), 'blue');
    assert.strictEqual(element.style.getPropertyPriority('--background'), 'important');
    assert.strictEqual(element.style.getPropertyValue('color-scheme'), 'light dark');
    assert.strictEqual(element.style.getPropertyPriority('color-scheme'), 'important');
    assert.ok(element.classList.contains('dark'));
    element.style.removeProperty('--background');
    element.style.removeProperty('color-scheme');
    element.classList.remove('dark');
  }
);
