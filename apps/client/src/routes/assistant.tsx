import { createFileRoute } from '@tanstack/react-router';

import { loadAssistant } from '#client/features/assistant/index.ts';

import { Page } from '../pages/assistant/page';

export const Route = createFileRoute('/assistant')({
  staticData: { header: 'workspace', title: 'Assistant', section: 'assistant', scope: 'global' },
  loader: loadAssistant,
  component: Page
});
