import { test } from '@study/testing';

import type * as __StudyMockType0 from '#client/lib/host.ts';

function createNative(mock: test.Mock) {
  return {
    enabled: false,
    invoke: mock.fn(),
    openUrl: mock.fn()
  };
}

let native: ReturnType<typeof createNative>;

let browserSignInCallbackUrl: typeof __StudyMockType0.browserSignInCallbackUrl;

let checkDesktopUpdate: typeof __StudyMockType0.checkDesktopUpdate;

let desktopUpdateStatus: typeof __StudyMockType0.desktopUpdateStatus;

let diagnosticLog: typeof __StudyMockType0.diagnosticLog;

let hostCapabilities: typeof __StudyMockType0.hostCapabilities;

let installDesktopUpdate: typeof __StudyMockType0.installDesktopUpdate;

let prepareSignInBrowser: typeof __StudyMockType0.prepareSignInBrowser;

let rpcBaseUrl: typeof __StudyMockType0.rpcBaseUrl;

let signInOptions: typeof __StudyMockType0.signInOptions;

test.beforeEach(async ({ mock }) => {
  native = createNative(mock);
  mock('@tauri-apps/api/core', () => ({ isTauri: () => native.enabled, invoke: native.invoke }));
  mock('@tauri-apps/plugin-opener', () => ({ openUrl: native.openUrl }));
  const __studyMockModule0 = await import('./host');

  browserSignInCallbackUrl = __studyMockModule0.browserSignInCallbackUrl;
  checkDesktopUpdate = __studyMockModule0.checkDesktopUpdate;
  desktopUpdateStatus = __studyMockModule0.desktopUpdateStatus;
  diagnosticLog = __studyMockModule0.diagnosticLog;
  hostCapabilities = __studyMockModule0.hostCapabilities;
  installDesktopUpdate = __studyMockModule0.installDesktopUpdate;
  prepareSignInBrowser = __studyMockModule0.prepareSignInBrowser;
  rpcBaseUrl = __studyMockModule0.rpcBaseUrl;
  signInOptions = __studyMockModule0.signInOptions;
});

test.beforeEach(() => {
  native.enabled = false;
  native.invoke.mockReset();
  native.openUrl.mockReset().mockResolvedValue(undefined);
});

test.stable(
  'browser RPC uses its reachable origin and exposes no native capabilities',
  async () => {
    test.expect(await rpcBaseUrl()).toBe(window.location.origin);
    test.expect(hostCapabilities()).toEqual({ updates: false, diagnostics: false });
    test.expect(native.invoke).not.toHaveBeenCalled();
  }
);

test.stable(
  'desktop RPC discovers the private server and exposes native capabilities',
  async () => {
    native.enabled = true;
    native.invoke.mockResolvedValue({ baseUrl: 'http://127.0.0.1:43891' });
    test.expect(await rpcBaseUrl()).toBe('http://127.0.0.1:43891');
    test.expect(native.invoke).toHaveBeenCalledExactlyOnceWith('server_connection');
    test.expect(hostCapabilities()).toEqual({ updates: true, diagnostics: true });
  }
);

test.stable(
  'desktop discovery propagates failure rather than using the browser origin',
  async () => {
    native.enabled = true;
    native.invoke.mockRejectedValue(new Error('server unavailable'));
    await test.expect(rpcBaseUrl()).rejects.toThrow('server unavailable');
  }
);

for (const [origin, expected] of [
  ['http://localhost:5173', 'http://127.0.0.1:5173/auth/callback'],
  ['http://127.0.0.1:43891', 'http://127.0.0.1:43891/auth/callback'],
  ['http://[::1]:8080', 'http://127.0.0.1:8080/auth/callback'],
  ['http://localhost', 'http://127.0.0.1/auth/callback']
])
  test.stable(`browser callback preserves the reachable port for ${origin}`, () => {
    test.expect(browserSignInCallbackUrl(origin!)).toBe(expected);
  });

for (const origin of ['https://host.example', 'http://192.168.1.2:5173', 'https://localhost:5173'])
  test.stable(`unsupported browser origin fails before OAuth: ${origin}`, () => {
    test
      .expect(() => browserSignInCallbackUrl(origin))
      .toThrow(test.expect.objectContaining({ kind: 'unsupported' }));
  });

test.stable('only browser sign-in overrides the native callback listener', () => {
  test.expect(signInOptions()).toEqual({
    callbackUrl: browserSignInCallbackUrl(window.location.origin)
  });
  native.enabled = true;
  test.expect(signInOptions()).toEqual({});
});

test.stable(
  'browser sign-in reserves a detached popup synchronously before authorization',
  async () => {
    const popup = {
      location: { replace: test.vi.fn() },
      close: test.vi.fn(),
      closed: false,
      opener: window
    };
    const open = test.vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    const browser = prepareSignInBrowser();

    test.expect(open).toHaveBeenCalledExactlyOnceWith('about:blank', '_blank');
    test.expect(popup.opener).toBeNull();
    test.expect(popup.location.replace).not.toHaveBeenCalled();
    test.expect(await browser.open('https://auth.example')).toBe(true);
    test.expect(popup.location.replace).toHaveBeenCalledWith('https://auth.example');
    browser.close();
    test.expect(popup.close).toHaveBeenCalledOnce();
  }
);

test.stable('blocked or closed sign-in popups report recovery without navigating', async () => {
  const popup = {
    location: { replace: test.vi.fn() },
    close: test.vi.fn(),
    closed: true,
    opener: window
  };

  test.vi
    .spyOn(window, 'open')
    .mockReturnValueOnce(null)
    .mockReturnValueOnce(popup as unknown as Window);
  const blocked = prepareSignInBrowser();

  test.expect(await blocked.open('https://auth.example')).toBe(false);
  blocked.close();
  const closed = prepareSignInBrowser();

  test.expect(await closed.open('https://auth.example')).toBe(false);
  test.expect(popup.location.replace).not.toHaveBeenCalled();
});

test.stable('desktop sign-in opens the system browser and propagates launch failures', async () => {
  native.enabled = true;
  const open = test.vi.spyOn(window, 'open');
  const browser = prepareSignInBrowser();

  test.expect(open).not.toHaveBeenCalled();
  test.expect(await browser.open('https://auth.example')).toBe(true);
  test.expect(native.openUrl).toHaveBeenCalledExactlyOnceWith('https://auth.example');
  native.openUrl.mockRejectedValueOnce(new Error('No browser'));
  await test.expect(browser.open('https://auth.example')).rejects.toThrow('No browser');
  browser.close();
});

test.stable(
  'desktop operations preserve native commands and the selected update version',
  async () => {
    native.enabled = true;
    native.invoke
      .mockResolvedValueOnce({ version: '1.0.0', supported: true })
      .mockResolvedValueOnce('1.0.1')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('snapshot');
    test.expect(await desktopUpdateStatus()).toEqual({ version: '1.0.0', supported: true });
    test.expect(await checkDesktopUpdate()).toBe('1.0.1');
    await installDesktopUpdate('1.0.1');
    test.expect(await diagnosticLog()).toBe('snapshot');
    test
      .expect(native.invoke.mock.calls)
      .toEqual([
        ['desktop_update_status'],
        ['check_for_update'],
        ['install_update', { expectedVersion: '1.0.1' }],
        ['diagnostic_log']
      ]);
  }
);
