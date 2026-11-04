import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { screen } from '@testing-library/react';
import { expect } from 'vite-plus/test';

import { renderPage } from '#web/test/render-page.tsx';

testStable('renders background activity instead of an empty page', async () => {
  renderPage('/pipelines', 'english');
  expect(await screen.findByText('Background work · updates every 5 seconds')).toBeInTheDocument();
  expect(await screen.findByText(catalogs.english['workspace.activityEmpty'])).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
});
