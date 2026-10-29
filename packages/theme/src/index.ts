import { color as parseColor } from '@csstools/css-color-parser';
import { parseComponentValue } from '@csstools/css-parser-algorithms';
import { tokenize } from '@csstools/css-tokenizer';

/** Headless theme overrides. Unspecified colors fall back to the application CSS. */
export const themeColorKeys = [
  'canvas',
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'border',
  'input',
  'ring',
  'sidebar',
  'sidebar-foreground',
  'sidebar-muted-foreground',
  'sidebar-control-surface',
  'sidebar-row-hover',
  'sidebar-row-active',
  'sidebar-row-selected',
  'sidebar-border',
  'error',
  'error-foreground',
  'error-surface',
  'destructive',
  'destructive-foreground',
  'success',
  'success-foreground',
  'warning',
  'warning-foreground',
  'warning-surface',
  'info',
  'info-foreground',
  'surface-raised',
  'app-chrome-background',
  'toolbar-background',
  'toolbar-foreground',
  'toolbar-border',
  'toolbar-control',
  'toolbar-control-foreground',
  'toolbar-control-hover',
  'placeholder',
  'secondary-label',
  'icon-muted',
  'sidebar-stage-fade',
  'code-background',
  'code-foreground',
  'media-overlay',
  'media-foreground',
  'control-on-destructive',
  'text-muted',
  'update-surface',
  'message-surface',
  'message-foreground',
  'message-action',
  'message-action-foreground',
  'message-action-hover',
  'search-match-background',
  'search-match-foreground',
  'search-match-active-background',
  'search-match-active-foreground',
  'terminal-background',
  'terminal-foreground',
  'terminal-cursor',
  'terminal-selection',
  'terminal-scrollbar',
  'terminal-scrollbar-hover'
] as const;

export type ThemeColorKey = (typeof themeColorKeys)[number];

export type ThemeColors = Readonly<Partial<Record<ThemeColorKey, string>>>;

export type ResolvedAppearance = 'light' | 'dark';

export type Appearance = ResolvedAppearance | 'system';

export interface ThemeDefinition {
  readonly colors?: ThemeColors;
  readonly light?: ThemeColors;
  readonly dark?: ThemeColors;
}

export interface ThemeSnapshot {
  readonly appearance: ResolvedAppearance;
  readonly colors: ThemeColors;
}

export function resolveTheme(
  theme: ThemeDefinition,
  appearance: Appearance,
  systemAppearance: ResolvedAppearance = 'light'
): ThemeSnapshot {
  const resolved = appearance === 'system' ? systemAppearance : appearance;

  return Object.freeze({
    appearance: resolved,
    colors: Object.freeze({ ...definedColors(theme.colors), ...definedColors(theme[resolved]) })
  });
}

export interface ThemeStore {
  getSnapshot(): ThemeSnapshot;
  subscribe(listener: () => void): () => void;
  setTheme(theme: ThemeDefinition): void;
  setAppearance(appearance: Appearance): void;
  setSystemAppearance(appearance: ResolvedAppearance): void;
}

export function createThemeStore(
  options: {
    theme?: ThemeDefinition;
    appearance?: Appearance;
    systemAppearance?: ResolvedAppearance;
  } = {}
): ThemeStore {
  let theme = copyTheme(options.theme ?? {});
  let appearance = options.appearance ?? 'system';
  let systemAppearance = options.systemAppearance ?? 'light';
  let snapshot = resolveTheme(theme, appearance, systemAppearance);
  const listeners = new Set<() => void>();

  function update() {
    const next = resolveTheme(theme, appearance, systemAppearance);
    const keys = Object.keys(next.colors) as ThemeColorKey[];

    if (
      snapshot.appearance === next.appearance &&
      keys.length === Object.keys(snapshot.colors).length &&
      keys.every((key) => snapshot.colors[key] === next.colors[key])
    )
      return;

    snapshot = next;

    for (const listener of Array.from(listeners)) listener();
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    setTheme(value) {
      theme = copyTheme(value);
      update();
    },
    setAppearance(value) {
      appearance = value;
      update();
    },
    setSystemAppearance(value) {
      systemAppearance = value;
      update();
    }
  };
}

function definedColors(colors: ThemeColors = {}): ThemeColors {
  return Object.fromEntries(Object.entries(colors).filter(([, value]) => value !== undefined));
}

function copyTheme(theme: ThemeDefinition): ThemeDefinition {
  return { colors: { ...theme.colors }, light: { ...theme.light }, dark: { ...theme.dark } };
}

/** Portable, versioned theme file. Omitted roles use the application palette. */
export interface ThemeFile extends ThemeDefinition {
  readonly version: 1;
  readonly id: string;
  readonly name: string;
}

export class ThemeFileError extends Error {}

function invalid(): never {
  throw new ThemeFileError('Invalid theme file');
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid();

  return value as Record<string, unknown>;
}

function colors(value: unknown): ThemeColors {
  const input = object(value);
  const result: Partial<Record<ThemeColorKey, string>> = {};

  for (const [key, raw] of Object.entries(input)) {
    if (!themeColorKeys.includes(key as ThemeColorKey) || typeof raw !== 'string') invalid();

    const color = raw.trim();
    const node = parseComponentValue(tokenize({ css: color }));

    if (color.length > 128 || !node || !parseColor(node)) invalid();

    result[key as ThemeColorKey] = color;
  }

  return result;
}

export function parseTheme(json: string): ThemeFile {
  if (json.length > 65536) invalid();

  let value: unknown;

  try {
    value = JSON.parse(json);
  } catch {
    return invalid();
  }

  const input = object(value);

  if (
    Object.keys(input).some(
      (key) => !['version', 'id', 'name', 'colors', 'light', 'dark'].includes(key)
    )
  )
    invalid();

  if (
    input.version !== 1 ||
    typeof input.id !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(input.id) ||
    typeof input.name !== 'string' ||
    !input.name.trim() ||
    input.name.length > 128 ||
    Array.from(input.name).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
    )
  )
    invalid();

  const result: ThemeFile = {
    version: 1,
    id: input.id,
    name: input.name.trim(),
    ...(input.colors === undefined ? {} : { colors: colors(input.colors) }),
    ...(input.light === undefined ? {} : { light: colors(input.light) }),
    ...(input.dark === undefined ? {} : { dark: colors(input.dark) })
  };

  return result;
}

export function serializeTheme(theme: ThemeFile): string {
  return JSON.stringify(parseTheme(JSON.stringify(theme)), null, 2);
}

export const defaultThemeId = 't3-code';

export function renderThemeCss(theme: ThemeFile): string {
  const block = (selector: string, values: ThemeColors) =>
    `${selector} {\n${Object.entries(values)
      .map(([key, value]) => `  --${key}: ${value};`)
      .join('\n')}\n}`;

  return `/* Generated from the T3 Code database theme. */\n${block(':root', resolveTheme(theme, 'light').colors)}\n\n${block(':root.dark', resolveTheme(theme, 'dark').colors)}\n`;
}
