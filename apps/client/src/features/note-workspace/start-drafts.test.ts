import { testStable } from '@study/testing/vitest';
import { AtomRegistry } from 'effect/reactivity';
import { expect } from 'vite-plus/test';

import {
  openStartDraft,
  dismissStartDraft,
  finishStartDraft,
  startDraftKey,
  startDrafts,
  startDraft,
  startFiles
} from './start-drafts.queries';

testStable('reuses one draft per subject and retains independent unassigned content', () => {
  const cache = AtomRegistry.make();

  openStartDraft(cache, '1');
  cache.set(startDraft(startDraftKey('1')), 'Math notes');
  openStartDraft(cache, '2');
  cache.set(startDraft(startDraftKey('2')), 'History notes');
  openStartDraft(cache);
  openStartDraft(cache, '1');
  expect(cache.get(startDrafts)).toEqual(['unassigned', '2', '1']);
  expect(cache.get(startDraft(startDraftKey('1')))).toBe('Math notes');
  expect(cache.get(startDraft(startDraftKey('2')))).toBe('History notes');
  dismissStartDraft(cache, '1');
  expect(cache.get(startDraft(startDraftKey('1')))).toBe('');
  expect(cache.get(startDraft(startDraftKey('2')))).toBe('History notes');
  expect(cache.get(startDrafts)).toEqual(['unassigned', '2']);
  cache.dispose();
});

testStable(
  'confirmation clears only submitted text and file occurrences, preserving newer work',
  () => {
    const cache = AtomRegistry.make();
    const submitted = new File(['notes'], 'notes.txt');
    const later = new File(['new'], 'new.txt');

    openStartDraft(cache, '1');
    cache.set(startDraft(startDraftKey('1')), 'Newer notes');
    cache.set(startFiles(startDraftKey('1')), [submitted, submitted, later]);
    finishStartDraft(cache, {
      draftKey: startDraftKey('1'),
      filesKey: startDraftKey('1'),
      text: 'Original notes',
      files: [submitted]
    });
    expect(cache.get(startDraft(startDraftKey('1')))).toBe('Newer notes');
    expect(cache.get(startFiles(startDraftKey('1')))).toEqual([submitted, later]);
    expect(cache.get(startDrafts)).toEqual(['1']);
    finishStartDraft(cache, {
      draftKey: startDraftKey('1'),
      filesKey: startDraftKey('1'),
      text: 'Newer notes',
      files: [submitted, later]
    });
    expect(cache.get(startDrafts)).toEqual([]);
    cache.dispose();
  }
);
