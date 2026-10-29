export * from '@study/theme';
import type { ThemeStore } from '@study/theme';

/** Apply at the document root, where palette and derived CSS tokens are defined. */
export function applyThemeToDocument(store: ThemeStore, document: Document): () => void {
  const element = document.documentElement;
  const original = new Map<string, { value: string; priority: string }>();
  const wasDark = element.classList.contains('dark');
  const originalScheme = {
    value: element.style.getPropertyValue('color-scheme'),
    priority: element.style.getPropertyPriority('color-scheme')
  };
  let active = new Set<string>();

  function restore(key: string) {
    const previous = original.get(key);

    if (previous?.value) element.style.setProperty(key, previous.value, previous.priority);
    else element.style.removeProperty(key);
  }

  function apply() {
    const snapshot = store.getSnapshot();
    const next = new Set(Object.keys(snapshot.colors).map((key) => `--${key}`));

    for (const key of active) if (!next.has(key)) restore(key);

    for (const [key, value] of Object.entries(snapshot.colors)) {
      const property = `--${key}`;

      if (!original.has(property))
        original.set(property, {
          value: element.style.getPropertyValue(property),
          priority: element.style.getPropertyPriority(property)
        });

      if (value !== undefined) element.style.setProperty(property, value);
    }

    active = next;
    element.classList.toggle('dark', snapshot.appearance === 'dark');
    element.style.colorScheme = snapshot.appearance;
  }

  apply();

  const unsubscribe = store.subscribe(apply);

  return () => {
    unsubscribe();

    for (const key of active) restore(key);

    element.classList.toggle('dark', wasDark);

    if (originalScheme.value)
      element.style.setProperty('color-scheme', originalScheme.value, originalScheme.priority);
    else element.style.removeProperty('color-scheme');
  };
}

/** Connect an explicitly supplied media query without accessing browser globals. */
export function observeSystemAppearance(
  store: ThemeStore,
  media: Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'>
): () => void {
  const update = (event: Pick<MediaQueryListEvent, 'matches'>) =>
    store.setSystemAppearance(event.matches ? 'dark' : 'light');

  update(media);
  media.addEventListener('change', update);

  return () => media.removeEventListener('change', update);
}
