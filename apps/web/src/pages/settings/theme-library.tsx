import { Appearance } from '@study/contracts/settings/types';
import { Button } from '@study/ui/button';
import { downloadFile } from '@study/ui/download';
import { IconButton } from '@study/ui/icon-button';
import { Settings } from '@study/ui/settings';
import { defaultThemeId, serializeTheme } from '@study/ui/theme';
import type { ThemeFile } from '@study/ui/theme';
import { ThemeSwatches, ThemeWireframe } from '@study/ui/theme-preview';
import { Copy, Download, Paintbrush, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { useI18n } from '../../lib/i18n';
import { ThemeEditor } from './theme-editor';
import type { AppearanceModel } from './use-page';

/** Switches between system, light and dark appearance preferences. */
export function ColorScheme({ model }: { model: AppearanceModel }) {
  const { t } = useI18n();
  const data = model.data!;
  const mode =
    data.settings.appearance === Appearance.SYSTEM
      ? 'system'
      : data.settings.appearance === Appearance.LIGHT
        ? 'light'
        : 'dark';
  const theme = data.themes.find((item) => item.id === (data.selected ?? defaultThemeId)) ?? {};

  return (
    <Settings.Section variant="color-scheme" title={t('ColorScheme')}>
      <Settings.ChoiceGroup label={t('ColorScheme')}>
        {(['system', 'light', 'dark'] as const).map((value) => (
          <Settings.Choice
            key={value}
            label={t(
              value === 'system' ? 'SystemAppearance' : value === 'light' ? 'Light' : 'Dark'
            )}
            selected={mode === value}
            disabled={model.pending}
            onSelect={() => model.setAppearance(value)}
          >
            <ThemeWireframe theme={theme} appearance={value} />
          </Settings.Choice>
        ))}
      </Settings.ChoiceGroup>
    </Settings.Section>
  );
}

type Editor = { type: 'import' } | { type: 'create' | 'edit'; theme: ThemeFile };

function downloadTheme(theme: ThemeFile) {
  downloadFile(`${theme.id}.json`, new Blob([serializeTheme(theme)], { type: 'application/json' }));
}

/** Lists built-in and custom themes with selection, import and editing actions. */
export function ThemeLibrary({ model, search = '' }: { model: AppearanceModel; search?: string }) {
  const { t } = useI18n();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [removing, setRemoving] = useState<ThemeFile | null>(null);
  const fresh = (theme?: ThemeFile): ThemeFile => ({
    ...theme,
    version: 1,
    id: crypto.randomUUID(),
    name: theme ? `${theme.name} (${t('ThemeCopy')})` : t('UntitledTheme')
  });
  const action = (label: string, icon: React.ReactNode, onClick: () => void) => (
    <IconButton label={label} disabled={model.pending} onClick={onClick}>
      {icon}
    </IconButton>
  );

  const order = [
    'tokyo-night',
    'catppuccin',
    'rose-pine',
    'nord',
    't3-code',
    'grove',
    'ocean',
    'ember',
    'iris'
  ];
  const themes = model
    .data!.themes.filter((theme) =>
      theme.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
    )
    .toSorted(
      (a, b) =>
        (order.indexOf(a.id) < 0 ? order.length : order.indexOf(a.id)) -
        (order.indexOf(b.id) < 0 ? order.length : order.indexOf(b.id))
    );

  return (
    <Settings.Section
      variant="theme-library"
      title={t('Themes')}
      actions={
        <>
          <Button
            size="xs"
            variant="outline"
            disabled={model.pending}
            onClick={() => setEditor({ type: 'create', theme: fresh() })}
          >
            <Paintbrush aria-hidden="true" />
            {t('CreateTheme')}
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={model.pending}
            onClick={() => setEditor({ type: 'import' })}
          >
            <Plus aria-hidden="true" />
            {t('AddTheme')}
          </Button>
        </>
      }
    >
      {themes.length === 0 && <Settings.Empty>{t('SearchNoResults')}</Settings.Empty>}
      <Settings.Grid>
        {themes.map((theme) => (
          <Settings.ThemeCard
            key={theme.id}
            name={theme.name}
            selected={(model.data!.selected ?? defaultThemeId) === theme.id}
            disabled={model.pending}
            onSelect={() => model.selectTheme(theme.id)}
            preview={
              <ThemeSwatches
                theme={theme}
                selected={(model.data!.selected ?? defaultThemeId) === theme.id}
              />
            }
            actions={
              <>
                {action(`${t('DuplicateTheme')}: ${theme.name}`, <Copy aria-hidden="true" />, () =>
                  setEditor({ type: 'create', theme: fresh(theme) })
                )}
                {!theme.builtin && (
                  <>
                    {action(`${t('EditTheme')}: ${theme.name}`, <Pencil aria-hidden="true" />, () =>
                      setEditor({ type: 'edit', theme })
                    )}
                    {action(
                      `${t('ExportTheme')}: ${theme.name}`,
                      <Download aria-hidden="true" />,
                      () => downloadTheme(theme)
                    )}
                    {action(
                      `${t('DeleteTheme')}: ${theme.name}`,
                      <Trash2 aria-hidden="true" />,
                      () => setRemoving(theme)
                    )}
                  </>
                )}
              </>
            }
          />
        ))}
      </Settings.Grid>
      {editor && (
        <ThemeEditor
          key={editor.type === 'import' ? 'import' : editor.theme.id}
          editor={editor}
          model={model}
          onClose={() => setEditor(null)}
        />
      )}
      {removing && (
        <ThemeEditor.Delete theme={removing} model={model} onClose={() => setRemoving(null)} />
      )}
    </Settings.Section>
  );
}
