import { Button } from '@study/ui/button';
import { DiagnosticText } from '@study/ui/diagnostic-text';
import { downloadFile } from '@study/ui/download';
import { SearchField } from '@study/ui/search-field';
import { SelectControl } from '@study/ui/select-control';
import { Settings } from '@study/ui/settings';
import { Usage } from '@study/ui/usage';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { hostCapabilities } from '#client/lib/host.ts';
import { useI18n } from '#client/lib/i18n.tsx';

import { diagnosticLogQueryOptions } from './analytics.queries';

/** Keep continuation lines, such as panic backtraces, with their tracing event. */
export function diagnosticEntries(snapshot: string) {
  const entries: string[] = [];

  for (const line of snapshot.split(/(?<=\n)/)) {
    if (!line) continue;

    if (/^\d{4}-\d\d-\d\dT.*\b(?:TRACE|DEBUG|INFO|WARN|ERROR)\b/.test(line) || !entries.length) {
      entries.push(line);
    } else {
      entries[entries.length - 1] += line;
    }
  }

  return entries;
}

/** Presents desktop diagnostic snapshots with local filters and complete snapshot export. */
export function AnalyticsSettings() {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState('');
  const diagnostics = hostCapabilities().diagnostics;
  const query = useQuery(diagnosticLogQueryOptions());
  const entries = diagnosticEntries(query.data ?? '');
  const filtered = entries.filter((entry) => {
    const severity = entry.split('\n', 1)[0].match(/\b(TRACE|DEBUG|INFO|WARN|ERROR)\b/)?.[1];

    return (
      (!level || severity === level) &&
      entry.toLocaleLowerCase().includes(search.toLocaleLowerCase())
    );
  });

  return (
    <Settings.Section title={t('AnalyticsTitle')}>
      <p>{t('AnalyticsDescription')}</p>
      {!diagnostics ? (
        <Settings.Status>{t('AnalyticsDesktop')}</Settings.Status>
      ) : (
        <>
          <Usage.Toolbar>
            <SearchField
              aria-label={t('AnalyticsSearch')}
              placeholder={t('AnalyticsSearch')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <SelectControl
              label={t('AnalyticsLevel')}
              value={level}
              onValueChange={setLevel}
              options={[
                { value: '', label: t('AnalyticsAll') },
                { value: 'TRACE', label: t('AnalyticsTrace') },
                { value: 'DEBUG', label: t('AnalyticsDebug') },
                { value: 'INFO', label: t('AnalyticsInfo') },
                { value: 'WARN', label: t('AnalyticsWarning') },
                { value: 'ERROR', label: t('AnalyticsErrorLevel') }
              ]}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              {t('AnalyticsRefresh')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!query.data}
              onClick={() =>
                downloadFile(
                  'diagnostics.log',
                  new Blob([query.data ?? ''], { type: 'text/plain;charset=utf-8' })
                )
              }
            >
              {t('AnalyticsExport')}
            </Button>
          </Usage.Toolbar>
          {query.isPending && <Settings.Status>{t('AnalyticsLoading')}</Settings.Status>}
          {query.isError && <Settings.Status>{t('AnalyticsError')}</Settings.Status>}
          {query.data !== undefined && (
            <>
              <p>{t('AnalyticsCount', { shown: filtered.length, total: entries.length })}</p>
              {entries.length === 0 ? (
                <Settings.Status>{t('AnalyticsEmpty')}</Settings.Status>
              ) : filtered.length === 0 ? (
                <Settings.Status>{t('AnalyticsNoMatches')}</Settings.Status>
              ) : (
                <DiagnosticText>{filtered.join('')}</DiagnosticText>
              )}
            </>
          )}
        </>
      )}
    </Settings.Section>
  );
}
