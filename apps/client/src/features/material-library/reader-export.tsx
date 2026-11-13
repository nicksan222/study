import type { exportFormatSchema, exportOmissionSchema } from '@study/contracts/materials/export';
import type { MaterialVersionDetailDto } from '@study/contracts/materials/schemas';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { MaterialLibrary } from '@study/ui/material-library';
import { SelectControl } from '@study/ui/select-control';
import { Download } from 'lucide-react';
import { useState } from 'react';

import { exportOmissionLabels } from '#client/lib/export-labels.ts';
import { useI18n } from '#client/lib/i18n.tsx';
import { useWorkspacePreferences } from '#client/lib/study-client/workspace-preferences.queries.ts';

import { availableExportFormats, exportReaderVersion } from './reader-export.queries';

type Format = typeof exportFormatSchema.Type;

type Omission = typeof exportOmissionSchema.Type;

const formatLabels = {
  markdown: 'ExportMarkdown',
  html: 'ExportHtml',
  aid_json: 'ExportAidJson',
  csv: 'ExportCsv'
} as const;

/** Downloads a supported format and reports the exact omissions returned by its serializer. */
export function ReaderExport({ version }: { version: MaterialVersionDetailDto }) {
  const { t } = useI18n();
  const preferences = useWorkspacePreferences();
  const formats = availableExportFormats();
  const [omissions, setOmissions] = useState<readonly Omission[]>([]);
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
            const result = await exportReaderVersion(version.id, format);

            setOmissions(result);

            setStatus(result.length ? 'omissions' : 'idle');
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
          {[...new Set(omissions.map((item) => item.code))]
            .map((code) => t(exportOmissionLabels[code]))
            .join(' ')}
        </MaterialLibrary.ExportStatus>
      )}
    </MaterialLibrary.ExportActions>
  );
}
