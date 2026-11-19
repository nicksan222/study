import '@fontsource-variable/inter';
import '@study/ui/styles.css';
import '@study/client/styles.css';
import { LanguageProvider } from '@study/client/companion';
import { createRpcTransport } from '@study/client/transport';
import { createRoot } from 'react-dom/client';

import { MobileCapture } from './capture';
import { Phone, importInvitation } from './phone';

const initialError = location.hash ? importInvitation(location.href) : undefined;

if (location.hash) {
  history.replaceState(null, '', location.pathname + location.search);
}

createRoot(document.getElementById('root')!).render(
  <LanguageProvider locale={navigator.language.startsWith('it') ? 'italian' : 'english'}>
    <Phone
      initialError={initialError}
      renderApp={(open) => <MobileCapture transport={createRpcTransport(open)} />}
    />
  </LanguageProvider>
);
