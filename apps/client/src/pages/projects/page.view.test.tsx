import { test } from '@study/testing';

import { LanguageProvider } from '#client/lib/i18n.tsx';

import { PageView } from './page.view';

test.stable.for(['english', 'italian'] as const)(
  'keeps the unselected workspace quiet in %s',
  (locale, { render, expect, screen }) => {
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
