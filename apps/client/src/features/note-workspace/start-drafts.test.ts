import { test } from '@study/testing';
import { AtomRegistry } from 'effect/reactivity';

import {
  openStartDraft,
  dismissStartDraft,
  finishStartDraft,
  startDraftKey,
  startDrafts,
  startDraft,
  startFiles
} from './start-drafts.queries';

test.stable('reuses one draft per subject and retains independent unassigned content', () => {
  const cache = AtomRegistry.make();

  openStartDraft(cache, '1');
  cache.set(startDraft(startDraftKey('1')), 'Math notes');
  openStartDraft(cache, '2');
  cache.set(startDraft(startDraftKey('2')), 'History notes');
  openStartDraft(cache);
  openStartDraft(cache, '1');
  test.expect(cache.get(startDrafts)).toEqual(['unassigned', '2', '1']);
  test.expect(cache.get(startDraft(startDraftKey('1')))).toBe('Math notes');
  test.expect(cache.get(startDraft(startDraftKey('2')))).toBe('History notes');
  dismissStartDraft(cache, '1');
  test.expect(cache.get(startDraft(startDraftKey('1')))).toBe('');
  test.expect(cache.get(startDraft(startDraftKey('2')))).toBe('History notes');
  test.expect(cache.get(startDrafts)).toEqual(['unassigned', '2']);
  cache.dispose();
});

test.stable(
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
    test.expect(cache.get(startDraft(startDraftKey('1')))).toBe('Newer notes');
    test.expect(cache.get(startFiles(startDraftKey('1')))).toEqual([submitted, later]);
    test.expect(cache.get(startDrafts)).toEqual(['1']);
    finishStartDraft(cache, {
      draftKey: startDraftKey('1'),
      filesKey: startDraftKey('1'),
      text: 'Newer notes',
      files: [submitted, later]
    });
    test.expect(cache.get(startDrafts)).toEqual([]);
    cache.dispose();
  }
);
