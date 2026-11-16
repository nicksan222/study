import { test } from '@study/testing';

import { LanguageProvider } from '#client/lib/i18n.tsx';

import { PageView } from './page.view';

test.stable.each(['english', 'italian'] as const)(
  'keeps the unselected workspace quiet in %s',
  (locale) => {
    test.render(
      <LanguageProvider locale={locale}>
        <PageView />
      </LanguageProvider>
    );
    test.expect(test.screen.queryByRole('heading')).not.toBeInTheDocument();
    test.expect(test.screen.queryByRole('textbox')).toBeNull();
    test.expect(test.screen.queryByRole('button')).toBeNull();
    test.expect(test.screen.queryByRole('heading', { level: 1 })).toBeNull();
  }
);
