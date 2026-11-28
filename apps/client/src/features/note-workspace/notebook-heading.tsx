import { Notebook } from '@study/ui';

import { useI18n } from '#client/lib/i18n.tsx';

export function NotebookHeading() {
  const { t } = useI18n();

  return (
    <Notebook.NotesHeading>
      <Notebook.PageHeading>
        <h1>{t('NoteNotesTitle')}</h1>
        <p>{t('NoteNotesHelp')}</p>
      </Notebook.PageHeading>
    </Notebook.NotesHeading>
  );
}
