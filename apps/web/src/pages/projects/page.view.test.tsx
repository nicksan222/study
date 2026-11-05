import { testStable } from '@study/testing/vitest';
import { render, screen } from '@testing-library/react';
import { expect } from 'vite-plus/test';

import { LanguageProvider } from '#web/lib/i18n.tsx';

import { PageView } from './page.view';

testStable.each(['english', 'italian'] as const)(
  'keeps the unselected workspace quiet in %s',
  (locale) => {
    render(
      <LanguageProvider locale={locale}>
        <PageView />
      </LanguageProvider>
    );
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  }
);
