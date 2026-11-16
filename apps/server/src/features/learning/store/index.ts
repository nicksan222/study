/** @file Composes learning persistence with canonical typed store declarations. */

import { defineStore } from '@study/server';

import { makeAttemptStore } from './attempts.ts';
import { makeCardStore } from './cards.ts';
import { makeGradingSnapshotStore } from './grading.ts';
import { makeReviewStore } from './reviews.ts';

export const AttemptStore = defineStore({
  name: 'study/LearningAttemptStore',
  entity: { singular: 'attempt', plural: 'attempts' },
  make: (resources) => makeAttemptStore(resources)
});

export const CardStore = defineStore({
  name: 'study/LearningCardStore',
  entity: { singular: 'card', plural: 'cards' },
  make: (resources) => makeCardStore(resources)
});

export const GradingSnapshotStore = defineStore({
  name: 'study/LearningGradingSnapshotStore',
  entity: { singular: 'gradingSnapshot', plural: 'gradingSnapshots' },
  make: (resources) => makeGradingSnapshotStore(resources)
});

export const ReviewStore = defineStore({
  name: 'study/LearningReviewStore',
  entity: { singular: 'review', plural: 'reviews' },
  make: (resources) => makeReviewStore(resources)
});
