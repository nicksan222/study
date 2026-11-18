import '@fontsource-variable/inter';
import '@study/ui/styles.css';
import '@study/client/styles.css';
import { LanguageProvider } from '@study/client/companion';
import { createRpcTransport } from '@study/client/transport';
import { createRoot } from 'react-dom/client';

import { MobileCapture } from './capture';
import { Phone, rememberInvitation } from './phone';

if (location.hash) {
  try {
    rememberInvitation(location.href);
  } catch {
    // The pairing form also accepts the original invitation link.
  }

  history.replaceState(null, '', location.pathname + location.search);
}

createRoot(document.getElementById('root')!).render(
  <LanguageProvider locale={navigator.language.startsWith('it') ? 'italian' : 'english'}>
    <Phone renderApp={(open) => <MobileCapture transport={createRpcTransport(open)} />} />
  </LanguageProvider>
);
