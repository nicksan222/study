import { defaultAppearancePreferences } from '@study/contracts';
import { interfaceControlLabels } from '@study/localization';
import { InterfaceControls, Settings } from '@study/ui';

import { useI18n } from '#client/lib/i18n.tsx';
import { usePhoneViewport } from '#client/lib/viewport.ts';

import type { AppearanceModel } from './use-page';

const noteWidths = [
  { value: 'full', label: 'AppearanceNoteWidthFull' },
  { value: 'wide', label: 'AppearanceNoteWidthWide' },
  { value: 'comfortable', label: 'AppearanceNoteWidthComfortable' }
] as const;

const editorDocks = [
  { value: 'side', label: 'AppearanceNoteEditorDockSide' },
  { value: 'bottom', label: 'AppearanceNoteEditorDockBottom' }
] as const;

/** Edits appearance and zoom through persisted preference actions. */
export function InterfaceSettings({ model }: { model: AppearanceModel }) {
  const { t } = useI18n();
  const showZoom = !usePhoneViewport();
  const preferences = model.data!.preferences ?? defaultAppearancePreferences;

  return (
    <InterfaceControls
      title={t('InterfaceSettings')}
      disabled={model.pending}
      showZoom={showZoom}
      labels={interfaceControlLabels(t)}
      values={{ ...preferences, zoom: model.data!.settings.zoomPercent }}
      defaults={{ ...defaultAppearancePreferences, zoom: 100 }}
      onCommit={(key, value) => {
        if (key === 'zoom') model.setZoom(value);
        else model.setPreferences({ ...preferences, [key]: value });
      }}
    />
  );
}

export function NoteAppearanceSettings({ model }: { model: AppearanceModel }) {
  const { t } = useI18n();
  const preferences = model.data!.preferences;

  return (
    <Settings.Section title={t('AppearanceNotes')}>
      <Settings.Group>
        <Settings.SelectRow
          title={t('AppearanceNoteWidth')}
          description={t('AppearanceNoteWidthDescription')}
          value={preferences.noteWidth}
          options={noteWidths.map(({ value, label }) => ({ value, label: t(label) }))}
          disabled={model.pending}
          onValueChange={(value) => {
            const width = noteWidths.find((option) => option.value === value);

            if (width) model.setPreferences({ ...preferences, noteWidth: width.value });
          }}
        />
        <Settings.ToggleRow
          title={t('AppearanceNoteComposer')}
          description={t('AppearanceNoteComposerDescription')}
          checked={preferences.showNoteComposer}
          disabled={model.pending}
          onCheckedChange={(showNoteComposer) =>
            model.setPreferences({ ...preferences, showNoteComposer })
          }
        />
        <Settings.SelectRow
          title={t('AppearanceNoteEditorDock')}
          description={t('AppearanceNoteEditorDockDescription')}
          value={preferences.noteEditorDock}
          options={editorDocks.map(({ value, label }) => ({ value, label: t(label) }))}
          disabled={model.pending}
          onValueChange={(value) => {
            const dock = editorDocks.find((option) => option.value === value);

            if (dock) model.setPreferences({ ...preferences, noteEditorDock: dock.value });
          }}
        />
      </Settings.Group>
    </Settings.Section>
  );
}
