import { isTauri } from '@tauri-apps/api/core';
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
