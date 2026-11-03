import { resolveTheme } from '@study/ui/theme';
import type { Appearance, ThemeDefinition, ThemeColors } from '@study/ui/theme';
import { Moon, Sun } from 'lucide-react';
import type { CSSProperties } from 'react';

function previewColor(
  colors: ThemeColors,
  keys: readonly (keyof ThemeColors)[],
  fallback: string
): string {
  return keys.map((key) => colors[key]).find((value) => value !== undefined) ?? fallback;
}

function paletteStyle(theme: ThemeDefinition, appearance: 'light' | 'dark'): CSSProperties {
  const { colors } = resolveTheme(theme, appearance);

  return {
    '--preview-canvas': previewColor(colors, ['canvas', 'background'], 'var(--background)'),
    '--preview-sidebar': previewColor(colors, ['sidebar'], 'var(--sidebar)'),
    '--preview-surface': previewColor(colors, ['surface-raised', 'card'], 'var(--card)'),
    '--preview-accent': previewColor(colors, ['accent'], 'var(--accent)'),
    '--preview-message': previewColor(colors, ['message-surface', 'muted'], 'var(--muted)'),
    '--preview-action': previewColor(colors, ['message-action', 'primary'], 'var(--primary)'),
    '--preview-foreground': previewColor(colors, ['foreground'], 'var(--foreground)'),
    '--preview-border': previewColor(colors, ['border'], 'var(--border)')
  } as CSSProperties;
}

export function ThemeSwatches({
  theme,
  selected = false
}: {
  theme: ThemeDefinition;
  selected?: boolean;
}) {
  return (
    <>
      {(['light', 'dark'] as const).map((appearance) => (
        <span
          key={appearance}
          className="theme-swatch-frame"
          data-selected={selected || undefined}
          data-appearance={appearance}
          aria-hidden="true"
          style={paletteStyle(theme, appearance)}
        >
          <span className="theme-swatch">
            <span />
          </span>
          {selected && (
            <span className="theme-swatch-badge">
              {appearance === 'light' ? <Sun /> : <Moon />}
            </span>
          )}
        </span>
      ))}
    </>
  );
}

export function ThemeWireframe({
  theme,
  appearance
}: {
  theme: ThemeDefinition;
  appearance: Appearance;
}) {
  const modes = appearance === 'system' ? (['light', 'dark'] as const) : [appearance];

  return (
    <span className="theme-wireframe" aria-hidden="true">
      {modes.map((mode) => (
        <span
          key={mode}
          className="theme-wireframe-pane"
          data-clip={appearance === 'system' ? mode : undefined}
          style={paletteStyle(theme, mode)}
        >
          <span className="theme-wireframe-sidebar" />
          <span className="theme-wireframe-header">
            <span />
            <span />
          </span>
          <span className="theme-wireframe-search" />
          <span className="theme-wireframe-nav-active" />
          <span className="theme-wireframe-nav-row" />
          <span className="theme-wireframe-nav-row-secondary" />
          <span className="theme-wireframe-message" />
          <span className="theme-wireframe-line" />
          <span className="theme-wireframe-line-secondary" />
          <span className="theme-wireframe-composer">
            <span />
            <span />
          </span>
        </span>
      ))}
    </span>
  );
}
