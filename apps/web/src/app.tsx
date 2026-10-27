import { RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';

import { LanguageProvider } from './i18n';
import { createAppRouter } from './router';

export function App() {
  const [router] = useState(createAppRouter);

  return (
    <LanguageProvider locale="english">
      <RouterProvider router={router} />
    </LanguageProvider>
  );
}
