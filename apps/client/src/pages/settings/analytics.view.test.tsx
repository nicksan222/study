import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import type * as UiModule from '@study/ui';

import type * as __StudyMockType0 from '#client/lib/host.ts';
import type * as __StudyMockType1 from '#client/lib/i18n.tsx';
import type * as __StudyMockType2 from '#client/pages/settings/analytics.tsx';

let diagnosticLog: typeof __StudyMockType0.diagnosticLog;

let hostCapabilities: typeof __StudyMockType0.hostCapabilities;

let LanguageProvider: typeof __StudyMockType1.LanguageProvider;

let AnalyticsSettings: typeof __StudyMockType2.AnalyticsSettings;

let downloadFile: typeof UiModule.downloadFile;

test.beforeEach(async ({ mock }) => {
  mock('#client/lib/host.ts', () => ({
    diagnosticLog: mock.fn(),
    hostCapabilities: mock.fn()
  }));
  mock('@study/ui', async (load) => {
    const actual = await load<typeof UiModule>();

    return { ...actual, downloadFile: mock.fn() };
  });
  downloadFile = (await import('@study/ui')).downloadFile;
  const __studyMockModule0 = await import('#client/lib/host.ts');

  diagnosticLog = __studyMockModule0.diagnosticLog;
  hostCapabilities = __studyMockModule0.hostCapabilities;
  const __studyMockModule1 = await import('#client/lib/i18n.tsx');

  LanguageProvider = __studyMockModule1.LanguageProvider;
  const __studyMockModule2 = await import('./analytics');

  AnalyticsSettings = __studyMockModule2.AnalyticsSettings;
});

const snapshot =
  '2026-01-01T00:00:00Z ERROR panic\n  stack: Needle\n2026-01-01T00:00:01Z INFO ready\n';

function setup(locale: 'english' | 'italian' = 'english') {
  const view = test.render(
    <LanguageProvider locale={locale}>
      <AnalyticsSettings />
    </LanguageProvider>
  );

  return () => {
    view.unmount();
  };
}

test.stable('searches continuation context and exports the entire snapshot', async () => {
  test.vi.mocked(hostCapabilities).mockReturnValue({ updates: true, diagnostics: true });
  test.vi.mocked(diagnosticLog).mockResolvedValue(snapshot);
  const cleanup = setup();

  try {
    const user = test.userEvent.setup();

    test.expect(await test.screen.findByText(/stack: Needle/)).toBeInTheDocument();
    await user.click(test.screen.getByRole('combobox', { name: 'Severity' }));
    await user.click(await test.screen.findByRole('option', { name: 'Error' }));
    test.expect(test.screen.queryByText(/INFO ready/)).not.toBeInTheDocument();
    await user.type(test.screen.getByRole('searchbox', { name: 'Search logs' }), 'needle');
    test.expect(test.screen.getByText(/ERROR panic/)).toHaveTextContent('stack: Needle');
    test.expect(test.screen.queryByText(/INFO ready/)).not.toBeInTheDocument();
    test.expect(test.screen.getByText('Showing 1 of 2 events')).toBeInTheDocument();
    await user.click(test.screen.getByRole('button', { name: 'Export snapshot' }));
    const [name, blob] = test.vi.mocked(downloadFile).mock.calls.at(-1)!;

    test.expect(name).toBe('diagnostics.log');
    test.expect(await (blob as Blob).text()).toBe(snapshot);
    await user.clear(test.screen.getByRole('searchbox', { name: 'Search logs' }));
    await user.type(test.screen.getByRole('searchbox', { name: 'Search logs' }), 'missing');
    test.expect(test.screen.getByText('No events match these filters.')).toBeInTheDocument();
  } finally {
    cleanup();
  }
});

test.stable.each(['english', 'italian'] as const)('shows browser fallback in %s', (locale) => {
  test.vi.mocked(hostCapabilities).mockReturnValue({ updates: false, diagnostics: false });
  test.vi.mocked(diagnosticLog).mockClear();
  const cleanup = setup(locale);

  try {
    test.expect(test.screen.getByText(catalogs[locale].AnalyticsDesktop)).toBeInTheDocument();
    test.expect(diagnosticLog).not.toHaveBeenCalled();
  } finally {
    cleanup();
  }
});

test.stable('shows loading, error and recovers to empty on refresh', async () => {
  test.vi.mocked(hostCapabilities).mockReturnValue({ updates: true, diagnostics: true });
  let reject!: (reason: Error) => void;

  test.vi
    .mocked(diagnosticLog)
    .mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        })
    )
    .mockResolvedValueOnce('');
  const cleanup = setup();

  try {
    test.expect(test.screen.getByText('Loading logs…')).toBeInTheDocument();
    test.expect(test.screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
    await test.waitFor(() => test.expect(diagnosticLog).toHaveBeenCalled());
    reject(new Error('unavailable'));
    test
      .expect(await test.screen.findByText('Could not load logs. Try refreshing.'))
      .toBeInTheDocument();
    await test.userEvent.click(test.screen.getByRole('button', { name: 'Refresh' }));
    await test.waitFor(() =>
      test.expect(test.screen.getByText('No diagnostic events yet.')).toBeInTheDocument()
    );
    test.expect(test.screen.getByRole('button', { name: 'Export snapshot' })).toBeDisabled();
  } finally {
    cleanup();
  }
});
