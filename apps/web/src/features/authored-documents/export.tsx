import type { StudyDocumentVersion } from '@study/contracts/documents/types';
import { Button } from '@study/ui/button';
import { SelectControl } from '@study/ui/select-control';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { exportOmissionLabels } from '#web/lib/export-labels.ts';
import { useI18n } from '#web/lib/i18n.tsx';
import { useWorkspacePreferences } from '#web/lib/study-client/workspace-preferences.queries.ts';

import { ContentReadError } from '../document-presentation';
import { versionExportOptions } from './export.queries';
import type { Format } from './export.queries';

export function VersionExport({ version }: { version: StudyDocumentVersion }) {
  const { t } = useI18n();
  const preferences = useWorkspacePreferences();
  const [selected, setSelected] = useState<Format>();
  const format =
    selected ??
    (preferences.defaultExportFormat === 'markdown' || preferences.defaultExportFormat === 'html'
      ? preferences.defaultExportFormat
      : 'canonical_json');
  const output = useMutation(versionExportOptions(version, format));

  return (
    <>
      <SelectControl
        label={t('ExportFormat')}
        value={format}
        disabled={output.isPending}
        options={[
          { value: 'canonical_json', label: t('ExportDocumentJson') },
          { value: 'markdown', label: t('ExportMarkdown') },
          { value: 'html', label: t('ExportHtml') }
        ]}
        onValueChange={(value) => {
          if (value === 'canonical_json' || value === 'markdown' || value === 'html')
            setSelected(value);
        }}
      />
      <Button variant="ghost" disabled={output.isPending} onClick={() => output.mutate()}>
        {t('ExportDownload')}
      </Button>
      {output.error && <ContentReadError error={output.error} retry={() => output.mutate()} />}
      {output.data && output.data.length > 0 && (
        <p role="status">
          {[...new Set(output.data.map((item) => item.code))]
            .map((code) => t(exportOmissionLabels[code]))
            .join(' ')}
        </p>
      )}
    </>
  );
}
