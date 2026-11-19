import '@fontsource-variable/inter';
import '@study/ui/styles.css';
import '@study/client/styles.css';
import { createRoot } from 'react-dom/client';

import { MobileApp } from './app/app';
import { mobileModules } from './app/modules';
import { importInvitation } from './features/pairing/invitations';

const initialError = location.hash ? importInvitation(location.href) : undefined;

if (location.hash) {
  history.replaceState(null, '', location.pathname + location.search);
}

createRoot(document.getElementById('root')!).render(
  <MobileApp modules={mobileModules(initialError)} />
);
