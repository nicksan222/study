import type { UsageQuery } from '@study/contracts/settings/usage';
import { RetryButton } from '@study/ui/action-button';
import { IconButton } from '@study/ui/icon-button';
import { Loading } from '@study/ui/loading';
import { SelectControl } from '@study/ui/select-control';
import { Settings } from '@study/ui/settings';
import { Toggle, ToggleGroup } from '@study/ui/toggle-group';
import { Usage } from '@study/ui/usage';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import { UsageReportView } from './report';
import { usageQueryOptions } from './usage.queries';

export function UsageSettings() {
  const { t } = useI18n();
  const [days, setDays] = useState<UsageQuery['days']>(30);
  const [provider, setProvider] = useState('');
  const [group, setGroup] = useState('models');
  const query = useQuery(usageQueryOptions(days, provider));
  const report = query.data;

  return (
    <Settings.Section title={t('UsageTitle')}>
      <Usage.Root>
        <Usage.Toolbar>
          <SelectControl
            label={t('UsageProvider')}
            value={provider}
            onValueChange={setProvider}
            options={[
              { value: '', label: t('UsageAllProviders') },
              ...[...new Set([...(report?.providers ?? []), ...(provider ? [provider] : [])])].map(
                (value) => ({ value, label: value })
              )
            ]}
          />
          <ToggleGroup
            aria-label={t('UsagePeriod')}
            value={[String(days)]}
            onValueChange={(values) => {
              const next = Number(values[0]);

              if (next === 1 || next === 7 || next === 30 || next === 90) setDays(next);
            }}
          >
            {([1, 7, 30, 90] as const).map((value) => (
              <Toggle key={value} value={String(value)}>
                {value === 1 ? t('UsagePastDay') : t('UsageDays', { count: value })}
              </Toggle>
            ))}
          </ToggleGroup>
          <IconButton
            variant="ghost"
            size="icon-sm"
            label={t('UsageRefresh')}
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw aria-hidden="true" />
          </IconButton>
        </Usage.Toolbar>
        {query.isPending && <Loading label={t('UsageLoading')} layout="panel" />}
        {query.isError && (
          <Settings.Status
            action={
              <RetryButton
                variant="outline"
                size="sm"
                label={t('Retry')}
                onClick={() => void query.refetch()}
              />
            }
          >
            {t('UsageError')}
          </Settings.Status>
        )}
        {report && (
          <UsageReportView report={report} days={days} group={group} setGroup={setGroup} />
        )}
      </Usage.Root>
    </Settings.Section>
  );
}
