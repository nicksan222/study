import type { exportFormatSchema } from '@study/contracts/materials/export';
import type { MaterialVersionDetailDto } from '@study/contracts/materials/schemas';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { MaterialLibrary } from '@study/ui/material-library';
import { SelectControl } from '@study/ui/select-control';
import { Download } from 'lucide-react';
import { useState } from 'react';

import { useI18n } from '../../lib/i18n';
import { useWorkspacePreferences } from '../../lib/study-client/workspace-preferences.queries';
import { availableExportFormats, exportReaderVersion } from './reader-export.queries';

type Format = typeof exportFormatSchema.Type;

const formatLabels = {
  markdown: 'ExportMarkdown',
  html: 'ExportHtml',
  aid_json: 'ExportAidJson',
  csv: 'ExportCsv'
} as const;

export function ReaderExport({ version }: { version: MaterialVersionDetailDto }) {
  const { t } = useI18n();
  const preferences = useWorkspacePreferences();
  const formats = availableExportFormats(version);
  const [selected, setSelected] = useState<Format>();
  const [status, setStatus] = useState<'idle' | 'busy' | 'failed' | 'omissions'>('idle');
  const preferred = selected ?? preferences.defaultExportFormat;
  const format = formats.find((item) => item === preferred) ?? formats[0];

  if (!format) return null;

  return (
    <MaterialLibrary.ExportActions>
      <SelectControl
        label={t('ExportFormat')}
        value={format}
        options={formats.map((item) => ({ value: item, label: t(formatLabels[item]) }))}
        disabled={status === 'busy'}
        onValueChange={(value) => {
          const valid = formats.find((item) => item === value);

          if (valid) setSelected(valid);
        }}
      />
      <Button
        variant="ghost"
        disabled={status === 'busy'}
        aria-label={t('ExportDownload')}
        onClick={async () => {
          setStatus('busy');

          try {
            const omissions = await exportReaderVersion(version.id, format);

            setStatus(omissions.length ? 'omissions' : 'idle');
          } catch {
            setStatus('failed');
          }
        }}
      >
        <Download size={16} aria-hidden="true" />
        {t('ExportDownload')}
      </Button>
      {status === 'failed' && (
        <ErrorState title={t('ErrorStateTitle')} description={t('ExportFailed')} />
      )}
      {status === 'omissions' && (
        <MaterialLibrary.ExportStatus role="status">
          {t('ExportOmissions')}
        </MaterialLibrary.ExportStatus>
      )}
    </MaterialLibrary.ExportActions>
  );
}
