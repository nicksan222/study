import { catalogs } from '@study/localization';
import { screen } from '@testing-library/react';
import { expect, it } from 'vite-plus/test';

import { renderPage } from '../../test/render-page';

it('renders background activity instead of an empty page', async () => {
  renderPage('/pipelines', 'english');
  expect(await screen.findByText('Background work · updates every 5 seconds')).toBeInTheDocument();
  expect(await screen.findByText(catalogs.english['workspace.activityEmpty'])).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
});
