import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

import { workflowLabel } from './workflow-label';

testStable('labels versioned workflow identities from the runtime', () => {
  expect(workflowLabel('conversation-reply/v1')).toBe('workspace.task.conversation-reply');
  expect(workflowLabel('document-transform/v2')).toBe('workspace.task.document-transform');
  expect(workflowLabel('unknown/v1')).toBe('workspace.task.other');
});
