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

function setup(
  { render }: Pick<test.Context, 'render'>,
  locale: 'english' | 'italian' = 'english'
) {
  const view = render(
    <LanguageProvider locale={locale}>
      <AnalyticsSettings />
    </LanguageProvider>
  );

  return () => {
    view.unmount();
  };
}

test.stable(
  'searches continuation context and exports the entire snapshot',
  async ({ vi, userEvent, expect, screen, render }) => {
    vi.mocked(hostCapabilities).mockReturnValue({ updates: true, diagnostics: true });
    vi.mocked(diagnosticLog).mockResolvedValue(snapshot);
    const cleanup = setup({ render });

    try {
      const user = userEvent.setup();

      expect(await screen.findByText(/stack: Needle/)).toBeInTheDocument();
      await user.click(screen.getByRole('combobox', { name: 'Severity' }));
      await user.click(await screen.findByRole('option', { name: 'Error' }));
      expect(screen.queryByText(/INFO ready/)).not.toBeInTheDocument();
      await user.type(screen.getByRole('searchbox', { name: 'Search logs' }), 'needle');
      expect(screen.getByText(/ERROR panic/)).toHaveTextContent('stack: Needle');
      expect(screen.queryByText(/INFO ready/)).not.toBeInTheDocument();
      expect(screen.getByText('Showing 1 of 2 events')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Export snapshot' }));
      const [name, blob] = vi.mocked(downloadFile).mock.calls.at(-1)!;

      expect(name).toBe('diagnostics.log');
      expect(await (blob as Blob).text()).toBe(snapshot);
      await user.clear(screen.getByRole('searchbox', { name: 'Search logs' }));
      await user.type(screen.getByRole('searchbox', { name: 'Search logs' }), 'missing');
      expect(screen.getByText('No events match these filters.')).toBeInTheDocument();
    } finally {
      cleanup();
    }
  }
);

test.stable.for(['english', 'italian'] as const)(
  'shows browser fallback in %s',
  (locale, { vi, expect, screen, render }) => {
    vi.mocked(hostCapabilities).mockReturnValue({ updates: false, diagnostics: false });
    vi.mocked(diagnosticLog).mockClear();
    const cleanup = setup({ render }, locale);

    try {
      expect(screen.getByText(catalogs[locale].AnalyticsDesktop)).toBeInTheDocument();
      expect(diagnosticLog).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  }
);

test.stable(
  'shows loading, error and recovers to empty on refresh',
  async ({ vi, expect, screen, waitFor, userEvent, render }) => {
    vi.mocked(hostCapabilities).mockReturnValue({ updates: true, diagnostics: true });
    let reject!: (reason: Error) => void;

    vi.mocked(diagnosticLog)
      .mockImplementationOnce(
        () =>
          new Promise((_, fail) => {
            reject = fail;
          })
      )
      .mockResolvedValueOnce('');
    const cleanup = setup({ render });

    try {
      expect(screen.getByText('Loading logs…')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
      await waitFor(() => expect(diagnosticLog).toHaveBeenCalled());
      reject(new Error('unavailable'));
      expect(await screen.findByText('Could not load logs. Try refreshing.')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
      await waitFor(() =>
        expect(screen.getByText('No diagnostic events yet.')).toBeInTheDocument()
      );
      expect(screen.getByRole('button', { name: 'Export snapshot' })).toBeDisabled();
    } finally {
      cleanup();
    }
  }
);
