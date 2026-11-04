import { testStable } from '@study/testing/vitest';
import { QueryClient } from '@tanstack/react-query';
import { expect } from 'vite-plus/test';

import {
  openStartDraft,
  dismissStartDraft,
  finishStartDraft,
  startDraftKey,
  startDraftsOptions
} from './start-drafts.queries';

testStable('reuses one draft per subject and retains independent unassigned content', () => {
  const cache = new QueryClient();

  openStartDraft(cache, '1');
  cache.setQueryData(startDraftKey('1'), 'Math notes');
  openStartDraft(cache, '2');
  cache.setQueryData(startDraftKey('2'), 'History notes');
  openStartDraft(cache);
  openStartDraft(cache, '1');
  expect(cache.getQueryData(startDraftsOptions().queryKey)).toEqual(['unassigned', '2', '1']);
  expect(cache.getQueryData(startDraftKey('1'))).toBe('Math notes');
  expect(cache.getQueryData(startDraftKey('2'))).toBe('History notes');
  dismissStartDraft(cache, '1');
  expect(cache.getQueryData(startDraftKey('1'))).toBe('');
  expect(cache.getQueryData(startDraftKey('2'))).toBe('History notes');
  expect(cache.getQueryData(startDraftsOptions().queryKey)).toEqual(['unassigned', '2']);
  cache.clear();
});

testStable(
  'confirmation clears only submitted text and file occurrences, preserving newer work',
  () => {
    const cache = new QueryClient();
    const submitted = new File(['notes'], 'notes.txt');
    const later = new File(['new'], 'new.txt');

    openStartDraft(cache, '1');
    cache.setQueryData(startDraftKey('1'), 'Newer notes');
    cache.setQueryData([...startDraftKey('1'), 'files'], [submitted, submitted, later]);
    finishStartDraft(cache, {
      draftKey: startDraftKey('1'),
      filesKey: [...startDraftKey('1'), 'files'],
      text: 'Original notes',
      files: [submitted]
    });
    expect(cache.getQueryData(startDraftKey('1'))).toBe('Newer notes');
    expect(cache.getQueryData([...startDraftKey('1'), 'files'])).toEqual([submitted, later]);
    expect(cache.getQueryData(startDraftsOptions().queryKey)).toEqual(['1']);
    finishStartDraft(cache, {
      draftKey: startDraftKey('1'),
      filesKey: [...startDraftKey('1'), 'files'],
      text: 'Newer notes',
      files: [submitted, later]
    });
    expect(cache.getQueryData(startDraftsOptions().queryKey)).toEqual([]);
    cache.clear();
  }
);
