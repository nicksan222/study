/** @file Composes recordings persistence with canonical typed store declarations. */

import { defineStore } from '#server/platform/definitions/define-store';

import { makeRecordingPostSnapshotStore, makeRecordingPostStore } from './posts.ts';
import { makeRecordingStore } from './recordings.ts';

export const RecordingPostSnapshotStore = defineStore({
  name: 'study/RecordingPostSnapshotStore',
  entity: { singular: 'recordingPostSnapshot', plural: 'recordingPostSnapshots' },
  make: (resources) => makeRecordingPostSnapshotStore(resources)
});

export const RecordingPostStore = defineStore({
  name: 'study/RecordingPostStore',
  entity: { singular: 'recordingPost', plural: 'recordingPosts' },
  make: (resources) => makeRecordingPostStore(resources)
});

export const RecordingStore = defineStore({
  name: 'study/RecordingStore',
  entity: { singular: 'recording', plural: 'recordings' },
  make: (resources) => makeRecordingStore(resources)
});
