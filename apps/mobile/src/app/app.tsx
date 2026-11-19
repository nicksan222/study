import { LanguageProvider } from '@study/client/companion';
import { ClientExtensions } from '@study/client/extensions';
import type { ClientModule } from '@study/client/extensions';

import { CapturePage } from '../pages/capture/page';

export function MobileApp({ modules }: { modules: readonly ClientModule[] }) {
  return (
    <LanguageProvider locale={navigator.language.startsWith('it') ? 'italian' : 'english'}>
      <ClientExtensions modules={modules}>
        <CapturePage />
      </ClientExtensions>
    </LanguageProvider>
  );
}
