import { test } from '@study/testing';

import { workflowLabel } from './workflow-label';

test.unit.stable('labels versioned workflow identities from the runtime', ({ expect }) => {
  expect(workflowLabel('conversation-reply/v1')).toBe('workspace.task.conversation-reply');
  expect(workflowLabel('document-transform/v2')).toBe('workspace.task.document-transform');
  expect(workflowLabel('unknown/v1')).toBe('workspace.task.other');
});
