/** @file Composes learning application operations behind the feature boundary. */

import { defineService } from '@study/server';
import type { Transaction } from '@study/server';

import { PracticeBackupStore } from '#server/features/learning/store/practice-backup';

import { prepareMaterialDeletion, scrubMaterialDeletion } from './material-deletion.ts';
import {
  inspectMaterialHistory,
  prepareMaterialHistory,
  scrubMaterialHistory
} from './material-history.ts';
import { learningPracticeOperations } from './practice.ts';
import { learningQuizOperations } from './quizzes.ts';
import { learningReviewOperations } from './reviews.ts';

export const Learning = defineService(
  'study/Learning',
  function* () {
    return {
      ...(yield* learningPracticeOperations()),
      ...(yield* learningQuizOperations()),
      ...(yield* learningReviewOperations())
    };
  },
  {
    validateBackup: (tx: Transaction) => tx.store(PracticeBackupStore).backupQuiescent(undefined),
    prepareMaterialHistory,
    scrubMaterialHistory,
    inspectMaterialHistory,
    prepareMaterialDeletion,
    scrubMaterialDeletion
  }
);
