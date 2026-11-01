import { JsonEditor, ConfirmDialog } from '@study/ui/json-editor';
import { parseTheme, serializeTheme } from '@study/ui/theme';
import type { ThemeFile } from '@study/ui/theme';
import { useState } from 'react';

import { useI18n } from '../../lib/i18n';
import type { AppearanceModel } from './use-page';

type Editor = { type: 'import' } | { type: 'create' | 'edit'; theme: ThemeFile };

export function ThemeEditor({
  editor,
  model,
  onClose
}: {
  editor: Editor;
  model: AppearanceModel;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [json, setJson] = useState(editor.type === 'import' ? '' : serializeTheme(editor.theme));
  const [error, setError] = useState(false);
  const title = t(
    editor.type === 'import' ? 'AddTheme' : editor.type === 'edit' ? 'EditTheme' : 'CreateTheme'
  );

  async function save() {
    setError(false);

    try {
      const parsed = parseTheme(json);
      const contents = serializeTheme(
        editor.type === 'edit' ? { ...parsed, id: editor.theme.id } : parsed
      );

      await (editor.type === 'edit' ? model.saveTheme(contents) : model.importTheme(contents));
      onClose();
    } catch {
      setError(true);
    }
  }

  async function readFile(file?: File) {
    if (!file) return;

    try {
      if (file.size > 65536) {
        setError(true);

        return;
      }

      const contents = await file.text();

      parseTheme(contents);
      setJson(contents);
      setError(false);
    } catch {
      setError(true);
    }
  }

  return (
    <JsonEditor
      labels={{
        title,
        description: t('ThemeJsonHint'),
        close: t('Close'),
        cancel: t('Cancel'),
        confirm: t(model.pending ? 'Saving' : 'Save'),
        file: t('ChooseThemeFile'),
        field: t('ThemeJson')
      }}
      value={json}
      error={error ? t('ThemeImportFailed') : undefined}
      pending={model.pending}
      onChange={(value) => {
        setJson(value);
        setError(false);
      }}
      onFile={(file) => {
        void readFile(file);
      }}
      onSave={() => {
        void save();
      }}
      onClose={onClose}
    />
  );
}

function DeleteTheme({
  theme,
  model,
  onClose
}: {
  theme: ThemeFile;
  model: AppearanceModel;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);

  return (
    <ConfirmDialog
      labels={{
        title: t('DeleteTheme'),
        description: `${theme.name} — ${t('DeleteThemeHint')}`,
        close: t('Close'),
        cancel: t('Cancel'),
        confirm: t('DeleteTheme')
      }}
      pending={model.pending}
      error={failed ? t('AppearanceFailed') : undefined}
      onClose={onClose}
      onConfirm={() => {
        void model.deleteTheme(theme.id).then(onClose, () => setFailed(true));
      }}
    />
  );
}

ThemeEditor.Delete = DeleteTheme;
