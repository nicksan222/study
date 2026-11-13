import { StudyError } from '@study/contracts/errors';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';

export type SignInBrowser = {
  open: (url: string) => Promise<boolean>;
  close: () => void;
};

/** Reserve web popups during the user gesture; native hosts use the system browser. */
export function prepareSignInBrowser(): SignInBrowser {
  if (isTauri())
    return {
      open: async (url) => {
        await openUrl(url);

        return true;
      },
      close: () => {}
    };

  const popup = window.open('about:blank', '_blank');

  if (popup) popup.opener = null;

  return {
    open: async (url) => {
      if (!popup || popup.closed) return false;

      popup.location.replace(url);

      return true;
    },
    close: () => popup?.close()
  };
}

/** Existing native capabilities; browser development uses the same RPC application. */
export function hostCapabilities() {
  const native = isTauri();

  return { updates: native, diagnostics: native };
}

export async function rpcBaseUrl(): Promise<string> {
  if (isTauri()) {
    const connection = await invoke<{ baseUrl: string }>('server_connection');

    return connection.baseUrl;
  }

  return window.location.origin;
}

/** Custom-scheme origins need a hierarchical base for internal router rewrites. */
export function routerOrigin(): string | undefined {
  return typeof window !== 'undefined' &&
    (window.origin === 'tauri://localhost' || window.location.protocol === 'tauri:')
    ? 'http://localhost'
    : undefined;
}

/** Use the browser's reachable forwarded port, independent of the server's private listener. */
export function browserSignInCallbackUrl(origin: string): string {
  const url = new URL(origin);

  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new StudyError(
      'unsupported',
      'ChatGPT sign-in requires Study on an HTTP loopback origin'
    );

  url.hostname = '127.0.0.1';

  return new URL('/auth/callback', url).href;
}

export function signInOptions(): { callbackUrl?: string } {
  return isTauri() ? {} : { callbackUrl: browserSignInCallbackUrl(window.location.origin) };
}

export const desktopUpdateStatus = () =>
  invoke<{ version: string; supported: boolean }>('desktop_update_status');

export const checkDesktopUpdate = () => invoke<string | null>('check_for_update');

export const installDesktopUpdate = (expectedVersion: string) =>
  invoke<void>('install_update', { expectedVersion });

export const diagnosticLog = () => invoke<string>('diagnostic_log');
