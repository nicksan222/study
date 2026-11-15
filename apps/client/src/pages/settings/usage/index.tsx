import type { UsageQuery } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { RefreshIcon } from '@study/icons';
import {
  RetryButton,
  IconButton,
  Loading,
  SelectControl,
  Settings,
  Toggle,
  ToggleGroup,
  Usage
} from '@study/ui';
import { useState } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

import { UsageReportView } from './report';

export function UsageSettings() {
  const { t } = useI18n();
  const [days, setDays] = useState<UsageQuery['days']>(30);
  const [provider, setProvider] = useState('');
  const [group, setGroup] = useState('models');
  const query = rpc.settings.usage.useQuery({ days, ...(provider ? { provider } : {}) });
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
            <RefreshIcon aria-hidden="true" />
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
