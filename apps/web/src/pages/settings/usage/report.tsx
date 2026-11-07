import type { UsageQuery, UsageReport } from '@study/contracts/settings/usage';
import { Settings } from '@study/ui/settings';
import { Toggle, ToggleGroup } from '@study/ui/toggle-group';
import { Usage, UsageChart } from '@study/ui/usage';

import { useI18n } from '#web/lib/i18n.tsx';

export function UsageReportView({
  report,
  days,
  group,
  setGroup
}: {
  report: UsageReport;
  days: UsageQuery['days'];
  group: string;
  setGroup: (value: string) => void;
}) {
  const { t, number, date } = useI18n();
  const compact = (value: number) =>
    number(value, { notation: 'compact', maximumFractionDigits: 1 });
  const total = report.totals.input + report.totals.output;
  const rows = breakdownRows(report, group);
  const sorted = [...rows].sort((a, b) =>
    group === 'days' ? b.key.localeCompare(a.key) : b.input + b.output - a.input - a.output
  );
  const buckets = new Map(report.days.map((day) => [day.key, day.input + day.output]));
  const now = new Date(report.generatedAt);
  const points = Array.from({ length: days + 1 }, (_, index) => {
    const day = new Date(now);

    day.setUTCDate(day.getUTCDate() - days + index);
    const key = day.toISOString().slice(0, 10);

    return {
      label: date(Date.parse(key) / 1000, { month: 'short', day: 'numeric', timeZone: 'UTC' }),
      value: buckets.get(key) ?? 0
    };
  });

  return (
    <>
      {report.totals.incomplete > 0 && <Settings.Status>{t('UsageIncomplete')}</Settings.Status>}
      {report.totals.requests === 0 ? (
        <Settings.Status>{t('UsageEmpty')}</Settings.Status>
      ) : (
        <>
          <Usage.Overview>
            <Usage.Summary>
              <Usage.Value title={number(total)}>{compact(total)}</Usage.Value>
              <Usage.Caption>{t('UsageProcessed')}</Usage.Caption>
              <Usage.Caption>
                {t('UsageActivity', {
                  requests: number(report.totals.requests),
                  runs: number(report.totals.runs)
                })}
              </Usage.Caption>
            </Usage.Summary>
            <UsageChart title={t('UsageDaily')} points={points} format={compact} />
          </Usage.Overview>
          <Usage.Totals>
            {(
              [
                [
                  'UsageInput',
                  report.totals.input - report.totals.cacheRead - report.totals.cacheWrite
                ],
                ['UsageCacheRead', report.totals.cacheRead],
                ['UsageCacheWrite', report.totals.cacheWrite],
                ['UsageOutput', report.totals.output],
                ['UsageReasoning', report.totals.reasoning],
                [
                  'UsageCacheRate',
                  report.totals.input ? report.totals.cacheRead / report.totals.input : 0
                ]
              ] as const
            ).map(([key, value]) => (
              <div key={key}>
                <dt>{t(key)}</dt>
                <dd title={number(value)}>
                  {key === 'UsageCacheRate'
                    ? number(value, { style: 'percent', maximumFractionDigits: 1 })
                    : compact(value)}
                </dd>
              </div>
            ))}
          </Usage.Totals>
          <ToggleGroup
            aria-label={t('UsageBreakdown')}
            value={[group]}
            onValueChange={(values) => {
              if (values[0]) setGroup(values[0]);
            }}
          >
            <Toggle value="models">{t('UsageModels')}</Toggle>
            <Toggle value="agents">{t('UsageAgents')}</Toggle>
            <Toggle value="days">{t('UsageByDay')}</Toggle>
          </ToggleGroup>
          <Usage.Scroll>
            <Usage.Table>
              <caption>{t('UsageBreakdown')}</caption>
              <thead>
                <tr>
                  <th scope="col">
                    {t(
                      group === 'models'
                        ? 'UsageModels'
                        : group === 'agents'
                          ? 'UsageAgents'
                          : 'UsageByDay'
                    )}
                  </th>
                  <th scope="col">{t('UsageRequests')}</th>
                  <th scope="col">{t('UsageTokens')}</th>
                  <th scope="col">{t('UsageShare')}</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => (
                  <tr key={`${row.provider}/${row.key}`}>
                    <td>
                      {group === 'days'
                        ? date(Date.parse(row.key) / 1000, {
                            month: 'short',
                            day: 'numeric',
                            timeZone: 'UTC'
                          })
                        : row.key}
                      {row.provider && <Usage.Caption>{row.provider}</Usage.Caption>}
                    </td>
                    <td>{number(row.requests)}</td>
                    <td title={number(row.input + row.output)}>
                      {compact(row.input + row.output)}
                    </td>
                    <td>
                      {number(total ? (row.input + row.output) / total : 0, {
                        style: 'percent',
                        maximumFractionDigits: 1
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Usage.Table>
          </Usage.Scroll>
        </>
      )}
      <Usage.Note>{t('UsageExplanation')}</Usage.Note>
    </>
  );
}

function breakdownRows(report: UsageReport, group: string) {
  if (group === 'models') return report.models;

  if (group === 'agents') return report.agents;

  return report.days.map((day) => ({ ...day, provider: '' }));
}
